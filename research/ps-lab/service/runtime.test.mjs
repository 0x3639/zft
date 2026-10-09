import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config, transport, secrets } from "./test-support.mjs";
import { statusConfig } from "./status-test-support.mjs";
import {
  initializeService,
  openService,
  readPins,
  acknowledgeRestore,
  READY,
  DATABASE,
} from "./runtime.mjs";
import { loadReferenceCustody } from "./reference-custody.mjs";
import { backupService, restoreService } from "./backup.mjs";
import {
  ServiceLock,
  inspectLock,
  reclaimDeadLock,
  LOCK,
  publish,
} from "./files.mjs";
import { Client } from "../local/client.mjs";
import { asset } from "../local/test-support.mjs";
import * as p from "../local/profile.mjs";
import { openServiceStore } from "./store.mjs";
function directories(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "zft-runtime-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const make = (n) => {
    const d = join(root, n);
    fs.mkdirSync(d, { mode: 0o700 });
    return d;
  };
  return { root, make };
}
const options = {
  loadCustody: ({ directory, keySha256 }) =>
    loadReferenceCustody(directory, keySha256, { ...config, transport }),
  statusTransport: statusConfig.transport,
  now: () => 1000,
};
async function setup(t) {
  const d = directories(t),
    dir = d.make("state"),
    ready = await initializeService(dir, secrets, {
      ...config,
      transport,
      status: statusConfig,
    });
  return {
    ...d,
    dir,
    ready,
    open: () => openService(dir, ready.sha256, options),
  };
}
async function mint(s, c) {
  const d = c.prepareIssue(await s.issuer.session("issue"), asset),
    b = c.backup(d),
    pending = p.parse(b, 300000);
  c.acknowledge(d, p.hash(b));
  const response = await s.issuer.submit(pending.wire, pending.capability);
  c.accept(d, response);
  return { d, ...pending, response };
}
test("runtime initializes explicitly, defaults suspended and holds an exclusive local lock", async (t) => {
  const f = await setup(t),
    s = await f.open();
  try {
    assert.equal(s.issuer.policy().enabled, 0);
    await assert.rejects(s.issuer.session("issue"));
    await assert.rejects(f.open(), { code: "EEXIST" });
    assert.equal(inspectLock(f.dir).dead, false);
    assert.throws(() => reclaimDeadLock(f.dir, inspectLock(f.dir).sha256));
  } finally {
    s.close();
  }
  assert(!fs.existsSync(join(f.dir, LOCK)));
  await assert.rejects(
    initializeService(f.dir, secrets, {
      ...config,
      transport,
      status: statusConfig,
    }),
  );
});
test("runtime refuses changed ready/key pins, missing store and failed custody without initialization", async (t) => {
  const f = await setup(t);
  await assert.rejects(openService(f.dir, "00".repeat(32), options));
  await assert.rejects(
    openService(f.dir, f.ready.sha256, {
      ...options,
      loadCustody: () => {
        throw new Error("denied");
      },
    }),
  );
  assert(!fs.existsSync(join(f.dir, LOCK)));
  fs.renameSync(join(f.dir, DATABASE), join(f.dir, "saved"));
  await assert.rejects(f.open());
  assert(!fs.existsSync(join(f.dir, DATABASE)));
});
test("stopped encrypted backup restores exact responses and remains suspended pending explicit review", async (t) => {
  const f = await setup(t),
    s = await f.open(),
    c = new Client(join(f.root, "client.db"), config.manifest);
  t.after(() => c.close());
  s.issuer.setEnabled(true);
  const m = await mint(s, c);
  await assert.rejects(
    backupService(f.dir, f.ready.sha256, f.make("busy"), { transport }),
    { code: "EEXIST" },
  );
  s.close();
  const out = f.make("out"),
    result = await backupService(f.dir, f.ready.sha256, out, { transport }),
    target = f.make("restore");
  assert.equal(result.sequence, 1);
  const path = join(out, "service-backup.enc.json");
  assert(!fs.readFileSync(path, "utf8").includes(m.response));
  await restoreService(
    path,
    target,
    {
      sha256: result.sha256,
      recordId: result.recordId,
      readyDigest: result.readyDigest,
      sequence: 1,
    },
    { transport },
  );
  let restored = await openService(target, result.readyDigest, options);
  assert.equal(restored.issuer.recover(m.d, m.capability), m.response);
  assert.equal(restored.issuer.policy().restore_required, 1);
  assert.throws(() => restored.issuer.setEnabled(true), /restore review/);
  restored.close();
  assert.throws(() =>
    acknowledgeRestore(target, result.readyDigest, {
      backupSha256: result.sha256,
      minimumSequence: 2,
      fencingEvidence: "fixture-fence",
    }),
  );
  acknowledgeRestore(target, result.readyDigest, {
    backupSha256: result.sha256,
    minimumSequence: 1,
    fencingEvidence: "fixture fence assertion, not production evidence",
  });
  restored = await openService(target, result.readyDigest, options);
  assert.equal(restored.issuer.policy().enabled, 0);
  restored.issuer.setEnabled(true);
  assert.equal(restored.issuer.recover(m.d, m.capability), m.response);
  restored.close();
});
test("backup and restore reject selected digest/sequence changes and denied unwrap without ready marker", async (t) => {
  const f = await setup(t),
    out = f.make("out"),
    b = await backupService(f.dir, f.ready.sha256, out, { transport }),
    path = join(out, "service-backup.enc.json"),
    selection = {
      sha256: b.sha256,
      recordId: b.recordId,
      readyDigest: b.readyDigest,
      sequence: b.sequence,
    };
  for (const [name, selected, tr] of [
    ["digest", { ...selection, sha256: "00".repeat(32) }, transport],
    ["sequence", { ...selection, sequence: 1 }, transport],
    [
      "denied",
      selection,
      () => {
        throw new Error("private provider detail");
      },
    ],
  ]) {
    const target = f.make(name);
    await assert.rejects(
      restoreService(path, target, selected, { transport: tr }),
    );
    assert(!fs.existsSync(join(target, READY)));
  }
  await assert.rejects(
    backupService(f.dir, f.ready.sha256, out, { transport }),
  );
});
test("failed restore before ready remains incomplete and cannot serve or be adopted", async (t) => {
  const f = await setup(t),
    out = f.make("out"),
    b = await backupService(f.dir, f.ready.sha256, out, { transport }),
    target = f.make("restore"),
    selection = {
      sha256: b.sha256,
      recordId: b.recordId,
      readyDigest: b.readyDigest,
      sequence: b.sequence,
    };
  await assert.rejects(
    restoreService(join(out, "service-backup.enc.json"), target, selection, {
      transport,
      boundary: () => {
        throw new Error("lost");
      },
    }),
  );
  assert(!fs.existsSync(join(target, READY)));
  await assert.rejects(openService(target, b.readyDigest, options));
  await assert.rejects(
    restoreService(join(out, "service-backup.enc.json"), target, selection, {
      transport,
    }),
  );
});
test("publication retains final after uncertain acknowledgement and never overwrites", (t) => {
  const { make } = directories(t),
    dir = make("publish");
  assert.throws(
    () =>
      publish(dir, "test.json", Buffer.from("ciphertext"), (stage) => {
        if (stage === "after-file-publication") throw new Error();
      }),
    (e) =>
      e.code === "ERR_PS_FILE_UNCERTAIN" && e.sha256 === p.hash("ciphertext"),
  );
  assert.equal(fs.readFileSync(join(dir, "test.json"), "utf8"), "ciphertext");
  assert.throws(() => publish(dir, "test.json", Buffer.from("replacement")));
  assert.equal(fs.readFileSync(join(dir, "test.json"), "utf8"), "ciphertext");
});

test("wrapping rotation preserves committed recovery and pending sessions in a suspended new directory", async (t) => {
  const { rotateWrappingKey } = await import("./rotation.mjs");
  const f = await setup(t),
    s = await f.open(),
    c = new Client(join(f.root, "rotate-client.db"), config.manifest);
  t.after(() => c.close());
  s.issuer.setEnabled(true);
  const m = await mint(s, c);
  const pending = c.prepareCancel(
    await s.issuer.session("swap"),
    c.pending(m.d).credential_id,
  );
  c.acknowledge(pending, p.hash(c.backup(pending)));
  s.close();
  const source = fs.readFileSync(join(f.dir, DATABASE)),
    target = f.make("rotated"),
    rotated = await rotateWrappingKey(f.dir, f.ready.sha256, target, {
      oldTransport: transport,
      newTransport: transport,
      newKeyId: "public-test/rotated",
    });
  assert.deepEqual(
    fs.readFileSync(join(f.dir, DATABASE)),
    source,
    "source untouched",
  );
  const opts = {
    ...options,
    loadCustody: ({ directory, keySha256, pins }) =>
      loadReferenceCustody(directory, keySha256, {
        ...config,
        keyId: pins.wrapping_key_id,
        transport,
      }),
  };
  let r = await openService(target, rotated.readyDigest, opts);
  assert.equal(r.issuer.recover(m.d, m.capability), m.response);
  assert.throws(() => r.issuer.setEnabled(true), /restore review/);
  r.close();
  acknowledgeRestore(target, rotated.readyDigest, {
    backupSha256: rotated.checkpoint,
    minimumSequence: 1,
    fencingEvidence: "test rotation source fenced externally",
  });
  r = await openService(target, rotated.readyDigest, opts);
  try {
    r.issuer.setEnabled(true);
    const v = p.parse(c.backup(pending), 300000);
    const id = c.accept(pending, await r.issuer.submit(v.wire, v.capability));
    assert.doesNotThrow(() => c.export(id));
  } finally {
    r.close();
  }
});
test("denied wrapping rotation never publishes a ready destination or changes source", async (t) => {
  const { rotateWrappingKey } = await import("./rotation.mjs");
  const f = await setup(t),
    before = fs.readFileSync(join(f.dir, DATABASE)),
    target = f.make("denied");
  await assert.rejects(
    rotateWrappingKey(f.dir, f.ready.sha256, target, {
      oldTransport: transport,
      newTransport: () => {
        throw new Error("denied");
      },
      newKeyId: "public-test/rotated",
    }),
  );
  assert(!fs.existsSync(join(target, READY)));
  assert.deepEqual(fs.readFileSync(join(f.dir, DATABASE)), before);
});

test("wrapping rotation removes replaced encrypted-session bytes from destination database pages", async (t) => {
  const { rotateWrappingKey } = await import("./rotation.mjs"),
    d = directories(t),
    dir = d.make("long-wrap"),
    target = d.make("short-wrap");
  // Public test transport with authenticated core plus disposable opaque padding; old records use overflow pages.
  const padded = (request) => {
    if (request.operation === "wrap") {
      const result = transport(request);
      return {
        ...result,
        material: Buffer.concat([result.material, Buffer.alloc(3000, 0x97)]),
      };
    }
    return transport({
      ...request,
      material: request.material.subarray(0, -3000),
    });
  };
  const ready = await initializeService(dir, secrets, {
    ...config,
    transport: padded,
    status: statusConfig,
  });
  const live = await openService(dir, ready.sha256, {
    ...options,
    loadCustody: ({ directory, keySha256 }) =>
      loadReferenceCustody(directory, keySha256, {
        ...config,
        transport: padded,
      }),
  });
  live.issuer.setEnabled(true);
  await live.issuer.session("issue");
  await live.issuer.session("swap");
  live.close();
  const marker = Buffer.from("97".repeat(128));
  assert(
    fs.readFileSync(join(dir, DATABASE)).includes(marker),
    "fixture must retain recognizable old ciphertext bytes",
  );
  const result = await rotateWrappingKey(dir, ready.sha256, target, {
    oldTransport: padded,
    newTransport: transport,
    newKeyId: "public-test/short-wrap",
  });
  assert(
    !fs.readFileSync(join(target, DATABASE)).includes(marker),
    "rotated database must not retain replaced wrapped-key bytes",
  );
  assert(
    fs.readFileSync(join(dir, DATABASE)).includes(marker),
    "source remains preserved",
  );
  const pins = readPins(target, result.readyDigest),
    db = openServiceStore(
      join(target, DATABASE),
      pins.manifest,
      pins.configuration_id,
    );
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 2);
    assert.equal(
      db.prepare("SELECT restore_required FROM policy").get().restore_required,
      1,
    );
  } finally {
    db.close();
  }
});
