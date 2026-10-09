import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import {
  initializePersistent,
  PersistentLab,
  persistentConfig,
} from "./persistent.mjs";
import {
  backupPersistent,
  restorePersistent,
  approveRestore,
  resumePersistent,
} from "./persistent-ops.mjs";
import { PersistentBrowserIssuer } from "./persistent-api.mjs";
import { Client } from "./client.mjs";
import { startBrowserLab } from "./browser-server.mjs";
import * as p from "./profile.mjs";
const image = p.bytes(
  JSON.parse(readFileSync(new URL("./image-fixtures.json", import.meta.url)))
    .images[0].pngHex,
);
async function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "zft-ops-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const n = createServer();
  await new Promise((r) => n.listen(0, "127.0.0.1", r));
  const port = n.address().port;
  await new Promise((r) => n.close(r));
  const dir = join(root, "issuer");
  initializePersistent(dir, port);
  const lab = new PersistentLab(dir),
    client = new Client(join(root, "client.db"), lab.manifest);
  const digest = client.prepareIssue(lab.issuer.session("issue"), image);
  client.acknowledge(digest, p.hash(client.backup(digest)));
  const id = client.submit(digest, lab.issuer),
    pending = p.parse(client.backup(digest), 300000),
    response = lab.issuer.recover(digest, pending.capability);
  client.close();
  lab.close();
  return {
    root,
    dir,
    digest,
    id,
    pending,
    response,
    backup: join(root, "backup"),
    restored: join(root, "restored"),
  };
}
test("offline backup records exact private files and a verifiable checkpoint without changing issuer state", async (t) => {
  const f = await fixture(t),
    before = readFileSync(join(f.dir, "issuer.db")),
    v = await backupPersistent(f.dir, f.backup);
  assert.equal(v.sequence, 1);
  assert.equal(v.counts.operations, 1);
  assert.equal(statSync(f.backup).mode & 0o777, 0o700);
  for (const name of [
    "private.json",
    "pins.json",
    "ready.json",
    "issuer.db",
    "presentations.db",
    "snapshot.json",
  ])
    assert.equal(statSync(join(f.backup, name)).mode & 0o777, 0o600);
  assert.deepEqual(readFileSync(join(f.dir, "issuer.db")), before);
  assert.deepEqual(readFileSync(join(f.backup, "issuer.db")), before);
  assert.equal(
    p.hash(readFileSync(join(f.backup, "snapshot.json"))),
    v.checkpoint,
  );
  await assert.rejects(() => backupPersistent(f.dir, f.backup), /EEXIST/);
  const lab = new PersistentLab(f.dir);
  lab.close();
});
test("restore is suspended and requires matching explicit review before new admission", async (t) => {
  const f = await fixture(t),
    b = await backupPersistent(f.dir, f.backup),
    r = await restorePersistent(f.backup, f.restored, b.checkpoint);
  assert.equal(r.enabled, false);
  assert.equal(r.reviewRequired, true);
  let lab = new PersistentLab(f.restored);
  try {
    assert.equal(
      lab.issuer.db.prepare("SELECT enabled FROM policy WHERE id=1").get()
        .enabled,
      0,
    );
    const api = new PersistentBrowserIssuer(lab);
    assert.equal(
      api.dispatch({
        action: "recover",
        digest: f.digest,
        capability: f.pending.capability,
      }).response,
      f.response,
    );
    lab.issuer.setEnabled(true);
    assert.throws(
      () => api.dispatch({ action: "session", kind: "issue" }),
      /restore review/,
    );
    lab.issuer.setEnabled(false);
  } finally {
    lab.close();
  }
  assert.throws(() => resumePersistent(f.restored), /restore review/);
  assert.throws(
    () => approveRestore(f.restored, "00".repeat(32)),
    /checkpoint/,
  );
  approveRestore(f.restored, b.checkpoint);
  lab = new PersistentLab(f.restored);
  try {
    assert.equal(lab.restoreReviewRequired, false);
    assert.throws(() => lab.issuer.session("issue"), /suspended/);
  } finally {
    lab.close();
  }
  resumePersistent(f.restored);
  lab = new PersistentLab(f.restored);
  try {
    assert(
      new PersistentBrowserIssuer(lab).dispatch({
        action: "session",
        kind: "swap",
      }).session,
    );
  } finally {
    lab.close();
  }
});
test("snapshot file tampering and wrong externally supplied checkpoint reject before creating destination", async (t) => {
  const f = await fixture(t),
    b = await backupPersistent(f.dir, f.backup);
  await assert.rejects(
    () => restorePersistent(f.backup, f.restored, "00".repeat(32)),
    /checkpoint/,
  );
  assert(!existsSync(f.restored));
  for (const name of [
    "private.json",
    "pins.json",
    "ready.json",
    "issuer.db",
    "presentations.db",
  ]) {
    const path = join(f.backup, name),
      original = readFileSync(path),
      changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1;
    writeFileSync(path, changed);
    await assert.rejects(
      () => restorePersistent(f.backup, f.restored, b.checkpoint),
      /digest/,
    );
    assert(!existsSync(f.restored));
    writeFileSync(path, original);
  }
});
test("snapshot signature is checked independently of its supplied content hash", async (t) => {
  const f = await fixture(t);
  await backupPersistent(f.dir, f.backup);
  const path = join(f.backup, "snapshot.json"),
    value = JSON.parse(readFileSync(path));
  value.signature = "00".repeat(64);
  const wire = p.canonical(value);
  writeFileSync(path, wire);
  await assert.rejects(
    () => restorePersistent(f.backup, f.restored, p.hash(wire)),
    /signature/,
  );
  assert(!existsSync(f.restored));
});
test("backup cannot run while issuer lock is held and a restore never overwrites an existing destination", async (t) => {
  const f = await fixture(t),
    lab = new PersistentLab(f.dir);
  try {
    await assert.rejects(() => backupPersistent(f.dir, f.backup), /EEXIST/);
  } finally {
    lab.close();
  }
  assert(!existsSync(f.backup));
  const b = await backupPersistent(f.dir, f.backup);
  mkdirSync(f.restored, { mode: 0o700 });
  writeFileSync(join(f.restored, "keep"), "user-owned");
  await assert.rejects(
    () => restorePersistent(f.backup, f.restored, b.checkpoint),
    /EEXIST/,
  );
  assert.equal(readFileSync(join(f.restored, "keep"), "utf8"), "user-owned");
});
test("interruption before restore readiness leaves an unservable incomplete destination", async (t) => {
  const f = await fixture(t),
    b = await backupPersistent(f.dir, f.backup);
  await assert.rejects(
    () =>
      restorePersistent(f.backup, f.restored, b.checkpoint, {
        boundary: (n) => {
          assert.equal(n, "before-restore-ready");
          throw new Error("simulated interruption");
        },
      }),
    /simulated interruption/,
  );
  assert(!existsSync(join(f.restored, "ready.json")));
  assert.throws(() => persistentConfig(f.restored));
  assert(!existsSync(join(f.restored, "run.lock")));
});
test("a valid older snapshot remains a rollback risk and restore review is never inferred from its signature", async (t) => {
  const f = await fixture(t),
    b = await backupPersistent(f.dir, f.backup);
  let lab = new PersistentLab(f.dir),
    c = new Client(join(f.root, "client.db"), lab.manifest);
  const d = c.prepareCancel(lab.issuer.session("swap"), f.id);
  c.acknowledge(d, p.hash(c.backup(d)));
  c.submit(d, lab.issuer);
  assert.equal(lab.issuer.counts().spent, 1);
  c.close();
  lab.close();
  await restorePersistent(f.backup, f.restored, b.checkpoint);
  lab = new PersistentLab(f.restored);
  try {
    assert.equal(lab.issuer.counts().spent, 0);
    assert.equal(lab.restoreReviewRequired, true);
    assert.throws(
      () =>
        new PersistentBrowserIssuer(lab).dispatch({
          action: "session",
          kind: "swap",
        }),
      /restore review/,
    );
  } finally {
    lab.close();
  }
});
test("restored loopback service exposes recovery but refuses new sessions and observations before review", async (t) => {
  const f = await fixture(t),
    b = await backupPersistent(f.dir, f.backup);
  await restorePersistent(f.backup, f.restored, b.checkpoint);
  const root = join(f.root, "build");
  mkdirSync(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    "<html><head></head><body></body></html>",
  );
  const r = await startBrowserLab({
    product: true,
    persistentDir: f.restored,
    productRoot: root,
  });
  const call = (path, body) =>
    fetch(r.origin + path, {
      method: "POST",
      headers: {
        Origin: r.origin,
        Authorization: "Bearer " + r.token,
        "Content-Type": "application/json",
      },
      body: p.canonical(body),
    });
  try {
    const boot = await (await call("/issuer", { action: "bootstrap" })).json();
    assert.equal(boot.mode.restoreReviewRequired, true);
    assert.equal(
      (await call("/issuer", { action: "session", kind: "issue" })).status,
      400,
    );
    assert.equal(
      (
        await call("/presentation", {
          action: "prepare",
          wallet: "00".repeat(20),
          h: f.pending.h,
          chain_id: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await (
          await call("/issuer", {
            action: "recover",
            digest: f.digest,
            capability: f.pending.capability,
          })
        ).json()
      ).response,
      f.response,
    );
  } finally {
    await r.close();
  }
});
