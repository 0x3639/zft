import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  chmodSync,
  renameSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import {
  initializePersistent,
  persistentConfig,
  PersistentLab,
  recoverPersistentLock,
  LIMITS,
} from "./persistent.mjs";
import { PersistentBrowserIssuer } from "./persistent-api.mjs";
import { PresentationApi } from "./presentation-api.mjs";
import { startBrowserLab } from "./browser-server.mjs";
import { Client } from "./client.mjs";
import { showingChallenge } from "./state.mjs";
import { PRESENTATION } from "./presentation.mjs";
import * as p from "./profile.mjs";
const image = p.bytes(
  JSON.parse(readFileSync(new URL("./image-fixtures.json", import.meta.url)))
    .images[0].pngHex,
);
async function fixture(t) {
  const parent = realpathSync(
    mkdtempSync(join(tmpdir(), "zft-persistent-test-")),
  );
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const listener = createServer();
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const dir = join(parent, "state"),
    root = join(parent, "build");
  mkdirSync(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    "<html><head><title>ZFT</title></head><body></body></html>",
  );
  const pins = initializePersistent(dir, port);
  return { parent, dir, root, pins, port };
}
function client(f, issuer) {
  return new Client(join(f.parent, "client.db"), issuer.pinned.manifest);
}
function mint(c, issuer) {
  const d = c.prepareIssue(issuer.session("issue"), image);
  c.acknowledge(d, p.hash(c.backup(d)));
  return { d, id: c.submit(d, issuer), pending: p.parse(c.backup(d), 300000) };
}
function request(r, path, body, token = r.token) {
  return fetch(r.origin + path, {
    method: "POST",
    headers: {
      Connection: "close",
      Origin: r.origin,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: p.canonical(body),
  });
}
async function publicRecord(c, id, api) {
  const { context } = await api.dispatch({
    action: "prepare",
    wallet: "00".repeat(20),
    h: p.assetValue(image, c.pinned),
    chain_id: 0,
  });
  const showing = c.show(id, context.wallet, showingChallenge(context));
  const { receipt } = await api.dispatch({
    action: "observe",
    challenge: context.challenge,
    showing,
  });
  const wire = p.canonical({
    format: PRESENTATION,
    origin: api.origin,
    chain_id: 0,
    context,
    showing,
    receipt,
    image: p.hex(image),
    image_sha256: p.hash(image),
    wallet_signature: null,
  });
  return {
    ...(await api.dispatch({ action: "publish", wire })),
    wire,
    context,
    showing,
    receipt,
  };
}
function presentation(lab, now = () => Math.floor(Date.now() / 1000)) {
  return new PresentationApi(
    lab.issuer,
    join(lab.dir, "presentations.db"),
    "http://127.0.0.1:" + lab.config.port,
    { now, privateKey: lab.statusPrivateKey, durable: true },
  );
}

test("persistent initialization creates private random pinned identity without overwriting an existing directory", async (t) => {
  const f = await fixture(t),
    cfg = persistentConfig(f.dir);
  assert.equal(statSync(f.dir).mode & 0o777, 0o700);
  for (const file of [
    "private.json",
    "pins.json",
    "ready.json",
    "issuer.db",
    "presentations.db",
  ])
    assert.equal(statSync(join(f.dir, file)).mode & 0o777, 0o600);
  assert.deepEqual(cfg.pins, f.pins);
  const g = await fixture(t);
  assert.notEqual(f.pins.manifest.realm, g.pins.manifest.realm);
  assert.notEqual(f.pins.manifest.public_key, g.pins.manifest.public_key);
  assert.throws(() => initializePersistent(f.dir, f.port), /EEXIST/);
  assert.deepEqual(persistentConfig(f.dir).pins, f.pins);
});
test("persistent startup rejects missing database instead of silently creating a fresh registry", async (t) => {
  const f = await fixture(t);
  renameSync(join(f.dir, "issuer.db"), join(f.dir, "issuer.saved"));
  assert.throws(() => new PersistentLab(f.dir));
  assert(!existsSync(join(f.dir, "issuer.db")));
  assert(!existsSync(join(f.dir, "run.lock")));
});
test("persistent startup rejects unsafe permissions symlinks and changed private trust", async (t) => {
  const f = await fixture(t),
    key = join(f.dir, "private.json"),
    original = readFileSync(key);
  chmodSync(key, 0o644);
  assert.throws(() => new PersistentLab(f.dir), /private/);
  chmodSync(key, 0o600);
  renameSync(key, key + ".saved");
  symlinkSync(key + ".saved", key);
  assert.throws(() => new PersistentLab(f.dir));
  rmSync(key);
  renameSync(key + ".saved", key);
  const c = JSON.parse(original);
  c.realm = p.randomHex(32);
  writeFileSync(key, p.canonical(c));
  assert.throws(() => new PersistentLab(f.dir), /pins mismatch/);
  writeFileSync(key, original);
  assert(!existsSync(join(f.dir, "run.lock")));
});
test("persistent exclusive ownership rejects a second server and refuses to steal a live lock", async (t) => {
  const f = await fixture(t),
    lab = new PersistentLab(f.dir);
  try {
    assert.throws(() => new PersistentLab(f.dir), /EEXIST/);
    assert.throws(() => recoverPersistentLock(f.dir), /still running/);
  } finally {
    lab.close();
  }
  const reopened = new PersistentLab(f.dir);
  reopened.close();
  assert(!existsSync(join(f.dir, "run.lock")));
});
test("persistent issuer retains exact response, spent registry, private trust and browser identities across restart", async (t) => {
  const f = await fixture(t);
  let lab = new PersistentLab(f.dir),
    c = client(f, lab.issuer);
  const old = mint(c, lab.issuer);
  const swap = c.prepareCancel(lab.issuer.session("swap"), old.id);
  c.acknowledge(swap, p.hash(c.backup(swap)));
  const pending = p.parse(c.backup(swap), 300000),
    response = lab.issuer.submit(pending.wire, pending.capability),
    counts = lab.issuer.counts();
  c.close();
  lab.close();
  lab = new PersistentLab(f.dir);
  try {
    c = client(f, lab.issuer);
    assert.deepEqual(lab.pins, f.pins);
    assert.deepEqual(lab.issuer.counts(), counts);
    assert.equal(lab.issuer.recover(swap, pending.capability), response);
    const replacement = c.recover(swap, lab.issuer);
    assert.notEqual(replacement, old.id);
    assert.throws(() => c.export(old.id));
    assert.equal(lab.issuer.submit(pending.wire, pending.capability), response);
    assert.throws(() => lab.issuer.recover(swap, "00".repeat(32)));
    c.close();
  } finally {
    lab.close();
  }
});
test("persistent public observations and exact publication survive restart and remain historical", async (t) => {
  const f = await fixture(t);
  let lab = new PersistentLab(f.dir),
    api = presentation(lab, () => 1000);
  const c = client(f, lab.issuer),
    { id } = mint(c, lab.issuer),
    r = await publicRecord(c, id, api),
    pins = api.pins();
  c.close();
  api.close();
  lab.close();
  lab = new PersistentLab(f.dir);
  api = presentation(lab, () => 1061);
  try {
    await api.validateRecords();
    assert.deepEqual(api.pins(), pins);
    assert.equal(api.read(r.id).wire, r.wire);
    assert.equal(
      (
        await api.dispatch({
          action: "observe",
          challenge: r.context.challenge,
          showing: r.showing,
        })
      ).receipt,
      r.receipt,
    );
    await assert.rejects(
      () => api.dispatch({ action: "publish", wire: r.wire }),
      /expired/,
    );
    assert.equal(api.records.size, 1);
  } finally {
    api.close();
    lab.close();
  }
});
test("persistent publication startup rejects corrupted stored evidence", async (t) => {
  const f = await fixture(t),
    lab = new PersistentLab(f.dir),
    api = presentation(lab, () => 1000),
    c = client(f, lab.issuer);
  try {
    const { id } = mint(c, lab.issuer),
      r = await publicRecord(c, id, api);
    api.observer.db
      .prepare("UPDATE public_records SET wire=? WHERE id=?")
      .run("{}", r.id);
    await assert.rejects(() => api.validateRecords(), /hash/);
  } finally {
    c.close();
    api.close();
    lab.close();
  }
});
test("persistent admission limits preserve authorized replay and suspend survives restart", async (t) => {
  const f = await fixture(t);
  let lab = new PersistentLab(f.dir);
  const c = client(f, lab.issuer),
    old = mint(c, lab.issuer),
    response = lab.issuer.recover(old.d, old.pending.capability),
    api = new PersistentBrowserIssuer(lab);
  // Synthetic expired rows isolate total-session admission; they are not valid protocol vectors.
  const add = lab.issuer.db.prepare("INSERT INTO sessions VALUES (?,?,?,?)");
  for (let i = lab.issuer.counts().sessions; i < LIMITS.sessions; i++)
    add.run("bounded-" + i, "{}", "00", 0);
  assert.throws(
    () => api.dispatch({ action: "session", kind: "issue" }),
    /session cap/,
  );
  assert.equal(
    api.dispatch({
      action: "submit",
      wire: old.pending.wire,
      capability: old.pending.capability,
    }).response,
    response,
  );
  lab.issuer.setEnabled(false);
  c.close();
  lab.close();
  lab = new PersistentLab(f.dir);
  try {
    assert.throws(() => lab.issuer.session("issue"), /suspended/);
    assert.equal(
      new PersistentBrowserIssuer(lab).dispatch({
        action: "recover",
        digest: old.d,
        capability: old.pending.capability,
      }).response,
      response,
    );
  } finally {
    lab.close();
  }
});
test("persistent loopback restart retains origin and pins but rotates launch capability and disables Node custody API", async (t) => {
  const f = await fixture(t);
  let r = await startBrowserLab({
    product: true,
    productRoot: f.root,
    persistentDir: f.dir,
  });
  const oldToken = r.token,
    origin = r.origin,
    b = await (await request(r, "/issuer", { action: "bootstrap" })).json();
  assert.equal(b.mode.kind, "persistent-local");
  assert.equal((await request(r, "/api", { action: "state" })).status, 404);
  await r.close();
  r = await startBrowserLab({
    product: true,
    productRoot: f.root,
    persistentDir: f.dir,
  });
  try {
    assert.equal(r.origin, origin);
    assert.notEqual(r.token, oldToken);
    assert.equal(
      (await request(r, "/issuer", { action: "bootstrap" }, oldToken)).status,
      403,
    );
    assert.deepEqual(
      await (await request(r, "/issuer", { action: "bootstrap" })).json(),
      b,
    );
    assert.equal((await fetch(r.origin + "/client/")).status, 404);
  } finally {
    await r.close();
  }
});
test(
  "SIGKILL persistent server retains committed recovery and requires explicit dead-owner lock recovery",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = fork(
      fileURLToPath(new URL("./persistent-process.mjs", import.meta.url)),
      [],
      {
        env,
        execArgv: ["--experimental-sqlite"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    t.after(() => {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
    });
    const ready = once(child, "message");
    child.send({ dir: f.dir, root: f.root });
    const [r] = await ready;
    assert(!r.error);
    const boot = await (
        await request(r, "/issuer", { action: "bootstrap" })
      ).json(),
      c = new Client(join(f.parent, "kill-client.db"), boot.manifest);
    t.after(() => c.close());
    const { session } = await (
      await request(r, "/issuer", { action: "session", kind: "issue" })
    ).json();
    const d = c.prepareIssue(session, image);
    c.acknowledge(d, p.hash(c.backup(d)));
    const pending = p.parse(c.backup(d), 300000);
    const { response } = await (
      await request(r, "/issuer", {
        action: "submit",
        wire: pending.wire,
        capability: pending.capability,
      })
    ).json();
    assert(response);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    const [code, signal] = await exited;
    assert.equal(signal, "SIGKILL");
    assert.equal(code, null);
    assert.throws(() => new PersistentLab(f.dir), /EEXIST/);
    recoverPersistentLock(f.dir);
    const lab = new PersistentLab(f.dir);
    try {
      assert.equal(lab.issuer.recover(d, pending.capability), response);
      assert(c.recover(d, lab.issuer));
    } finally {
      lab.close();
    }
  },
);

test("persistent observation returns the committed receipt after interruption before API return", async (t) => {
  const f = await fixture(t),
    lab = new PersistentLab(f.dir);
  let api = presentation(lab, () => 1000);
  const c = client(f, lab.issuer);
  try {
    const { id } = mint(c, lab.issuer);
    const { context } = await api.dispatch({
      action: "prepare",
      wallet: "00".repeat(20),
      h: p.assetValue(image, c.pinned),
      chain_id: 0,
    });
    const showing = c.show(id, context.wallet, showingChallenge(context));
    api.observer.boundary = (name) => {
      if (name === "after-state-commit")
        throw new Error("lost observation return");
    };
    await assert.rejects(
      () =>
        api.dispatch({
          action: "observe",
          challenge: context.challenge,
          showing,
        }),
      /lost observation return/,
    );
    const original = api.observer.row(context.challenge).receipt;
    assert(original);
    api.close();
    api = presentation(lab, () => 1001);
    assert.equal(
      (
        await api.dispatch({
          action: "observe",
          challenge: context.challenge,
          showing,
        })
      ).receipt,
      original,
    );
    await assert.rejects(
      () =>
        api.dispatch({
          action: "observe",
          challenge: context.challenge,
          showing: showing + " ",
        }),
      /replay mismatch/,
    );
  } finally {
    c.close();
    api.close();
    lab.close();
  }
});
test("persistent operation cap rejects new work while exact authorized response remains recoverable", async (t) => {
  const f = await fixture(t),
    lab = new PersistentLab(f.dir),
    c = client(f, lab.issuer),
    api = new PersistentBrowserIssuer(lab);
  try {
    const old = mint(c, lab.issuer),
      response = lab.issuer.recover(old.d, old.pending.capability);
    const next = c.prepareCancel(lab.issuer.session("swap"), old.id),
      pending = p.parse(c.backup(next), 300000);
    // Synthetic rows test quota admission only, not cryptographic validity.
    for (let i = lab.issuer.counts().operations; i < LIMITS.operations; i++) {
      lab.issuer.db
        .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
        .run("quota-" + i, "{}", "00", 0);
      lab.issuer.db
        .prepare(
          "INSERT INTO operations (digest,session,recovery_hash,response) VALUES (?,?,?,?)",
        )
        .run("quota-" + i, "quota-" + i, "00", "synthetic");
    }
    assert.throws(
      () => api.dispatch({ action: "session", kind: "issue" }),
      /operation cap/,
    );
    assert.throws(
      () =>
        api.dispatch({
          action: "submit",
          wire: pending.wire,
          capability: pending.capability,
        }),
      /operation cap/,
    );
    assert.equal(
      api.dispatch({
        action: "submit",
        wire: old.pending.wire,
        capability: old.pending.capability,
      }).response,
      response,
    );
    assert.equal(lab.issuer.counts().operations, LIMITS.operations);
  } finally {
    c.close();
    lab.close();
  }
});
