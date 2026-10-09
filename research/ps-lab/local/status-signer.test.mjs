import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, sign, verify, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdtempSync, realpathSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as p from "./profile.mjs";
import {
  stateManifest,
  StateIssuer,
  StateObserver,
  showingChallenge,
} from "./state.mjs";
import { fixture, secrets, realm, wallet, asset } from "./test-support.mjs";
import {
  initializePersistent,
  persistentConfig,
  statusKey,
} from "./persistent.mjs";
import { backupPersistent, restorePersistent } from "./persistent-ops.mjs";
import {
  StatusSigner,
  SIGN_REQUEST,
  SIGN_RESPONSE,
  SIGN_MESSAGE_BYTES,
} from "./status-signer.mjs";

const pair = generateKeyPairSync("ed25519");
const psManifest = p.manifest(realm, secrets);
const manifest = stateManifest(
  psManifest,
  pair.publicKey
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("hex"),
);
const keyId = "local-test/status-key-v1";
const message = p.utf8("public test transcript");
const error = (code) => (e) => {
  assert.equal(e.code, "ERR_PS_STATUS_SIGNER_" + code);
  assert.equal(e.message, "PS status signer " + code.toLowerCase());
  assert.equal(e.cause, undefined);
  return true;
};
function response(request, privateKey = pair.privateKey, patch = {}) {
  return p.canonical({
    format: SIGN_RESPONSE,
    key_id: request.key_id,
    algorithm: "Ed25519",
    message_type: "RAW",
    signature: sign(null, request.message, privateKey).toString("hex"),
    ...patch,
  });
}
function signer(transport = async (request) => response(request), extra = {}) {
  return new StatusSigner({ psManifest, manifest, keyId, transport, ...extra });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function block(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* Deliberate blocked-loop test, not a latency claim. */
  }
}

test("status signer validates pinned identity and bounded configuration before transport", () => {
  let calls = 0;
  const config = {
    psManifest,
    manifest,
    keyId,
    transport: () => {
      calls++;
    },
  };
  for (const extra of [
    { keyId: "" },
    { keyId: "bad\nkey" },
    { keyId: "x".repeat(2049) },
    { transport: null },
    { timeoutMs: 99 },
    { timeoutMs: 5001 },
    { timeoutMs: NaN },
    { manifest: { ...manifest, public_key: "00".repeat(32) } },
    { manifest: { ...manifest, realm: "00".repeat(32) } },
    { manifest: { ...manifest, status_key_id: "00".repeat(32) } },
    { manifest: { ...manifest, algorithm: "ECDSA" } },
    { manifest: { ...manifest, extra: true } },
  ])
    assert.throws(
      () => new StatusSigner({ ...config, ...extra }),
      error("CONFIG"),
    );
  assert.equal(calls, 0);
});

test("status signer signs exact raw bytes at both size boundaries", async () => {
  const s = signer(async (request, options) => {
    assert.equal(request.format, SIGN_REQUEST);
    assert.equal(request.key_id, keyId);
    assert.equal(request.algorithm, "Ed25519");
    assert.equal(request.message_type, "RAW");
    assert(options.signal instanceof AbortSignal);
    assert(Object.isFrozen(request));
    return response(request);
  });
  for (const length of [1, SIGN_MESSAGE_BYTES]) {
    const input = new Uint8Array(length).fill(7);
    const signature = await s.sign(input);
    assert.equal(signature, sign(null, input, pair.privateKey).toString("hex"));
    assert(verify(null, input, pair.publicKey, Buffer.from(signature, "hex")));
  }
});

test("status signer rejects oversized input before transport", async () => {
  let calls = 0;
  const s = signer((request) => {
    calls++;
    return response(request);
  });
  await assert.rejects(s.sign(new Uint8Array(4097)), error("INPUT"));
  assert.equal(calls, 0);
});

test("status signer rejects empty nonbyte and shared-memory input", async () => {
  let calls = 0;
  const s = signer((request) => {
    calls++;
    return response(request);
  });
  for (const input of [
    new Uint8Array(),
    "text",
    {},
    null,
    new DataView(new ArrayBuffer(4)),
    new Uint8Array(new SharedArrayBuffer(4)),
  ])
    await assert.rejects(s.sign(input), error("INPUT"));
  await assert.rejects(s.sign(message, { signal: {} }), error("INPUT"));
  assert.equal(calls, 0);
});

test("status signer snapshots caller input including exact view boundaries", async () => {
  const original = Buffer.from([99, 1, 2, 3, 99]);
  const input = original.subarray(1, 4);
  input[Symbol.iterator] = function* () {
    yield 8;
  }; // Copy the byte view, not a caller iterator.
  const s = signer(async (request) => {
    assert.deepEqual([...request.message], [1, 2, 3]);
    return response(request);
  });
  const pending = s.sign(input);
  original.fill(0);
  assert.equal(
    await pending,
    sign(null, Buffer.from([1, 2, 3]), pair.privateKey).toString("hex"),
  );
});

test("status signer transport mutation cannot replace verification bytes", async () => {
  const input = Uint8Array.from(message);
  const s = signer(async (request) => {
    request.message.fill(9);
    return response(request);
  });
  await assert.rejects(s.sign(input), error("RESPONSE"));
  assert.deepEqual(input, message);
});

test("status signer pins constructor values across caller mutation", async () => {
  const config = {
    psManifest: structuredClone(psManifest),
    manifest: structuredClone(manifest),
    keyId,
    transport: async (r) => response(r),
  };
  const s = new StatusSigner(config);
  config.keyId = "substituted";
  config.manifest.public_key = "00".repeat(32);
  config.transport = () => {
    throw Error("replacement must not run");
  };
  assert.equal(
    await s.sign(message),
    sign(null, message, pair.privateKey).toString("hex"),
  );
});

test("status signer rejects a substituted provider key identity", async () => {
  const s = signer(async (r) =>
    response(r, pair.privateKey, { key_id: "different-provider-key" }),
  );
  await assert.rejects(s.sign(message), error("RESPONSE"));
});

test("status signer rejects malformed alternate and oversized response envelopes", async () => {
  const variants = [
    (r) => response(r, pair.privateKey, { format: "other" }),
    (r) => response(r, pair.privateKey, { algorithm: "Ed25519ph" }),
    (r) => response(r, pair.privateKey, { message_type: "DIGEST" }),
    (r) => response(r, pair.privateKey, { extra: true }),
    (r) => response(r, pair.privateKey, { signature: "AA".repeat(64) }),
    (r) => response(r, pair.privateKey, { signature: "00".repeat(63) }),
    (r) => response(r, pair.privateKey, { signature: 4 }),
    (r) => " " + response(r),
    (r) => response(r).replace("{", '{"algorithm":"Ed25519",'),
    (r) => {
      const v = p.parse(response(r));
      delete v.signature;
      return p.canonical(v);
    },
    () => "x".repeat(4097),
    () => "{}",
    () => null,
    () => new Uint8Array(4),
  ];
  for (const bad of variants)
    await assert.rejects(
      signer(async (r) => bad(r)).sign(message),
      error("RESPONSE"),
    );
});

test("status signer verifies signatures against the exact pinned message and public key", async () => {
  const wrong = generateKeyPairSync("ed25519");
  const variants = [
    (r) => response(r, wrong.privateKey),
    (r) =>
      response(r, pair.privateKey, {
        signature: sign(
          null,
          Buffer.from("other message"),
          pair.privateKey,
        ).toString("hex"),
      }),
    (r) =>
      response(r, pair.privateKey, {
        signature: sign(
          null,
          createHash("sha512").update(r.message).digest(),
          pair.privateKey,
        ).toString("hex"),
      }),
    (r) => response(r, pair.privateKey, { signature: "00".repeat(64) }),
  ];
  for (const bad of variants)
    await assert.rejects(
      signer(async (r) => bad(r)).sign(message),
      error("RESPONSE"),
    );
});

test("status signer redacts denied synchronous and asynchronous failures without retry", async () => {
  for (const asynchronous of [false, true]) {
    let calls = 0;
    const s = signer((r) => {
      calls++;
      if (calls > 1) return response(r);
      const e = Object.assign(Error("private payload must not escape"), {
        secret: "test sentinel",
      });
      if (asynchronous) return Promise.reject(e);
      throw e;
    });
    await assert.rejects(s.sign(message), error("UNAVAILABLE"));
    assert.equal(calls, 1);
    assert.equal(
      await s.sign(message),
      sign(null, message, pair.privateKey).toString("hex"),
    );
    assert.equal(calls, 2, "caller explicitly requests the second attempt");
  }
});

test("status signer refuses concurrent work while one request is outstanding", async () => {
  const pending = deferred();
  let calls = 0,
    request;
  const s = signer((r) => {
    calls++;
    request = r;
    return pending.promise;
  });
  const first = s.sign(message);
  await tick();
  await assert.rejects(s.sign(message), error("BUSY"));
  assert.equal(calls, 1);
  pending.resolve(response(request));
  assert.equal(
    await first,
    sign(null, message, pair.privateKey).toString("hex"),
  );
});

test("status signer absolute deadline rejects late results and closes the adapter", async () => {
  let signal,
    request,
    calls = 0;
  const pending = deferred();
  const s = signer(
    (r, o) => {
      request = r;
      signal = o.signal;
      calls++;
      return pending.promise;
    },
    { timeoutMs: 100 },
  );
  const first = s.sign(message);
  // A bounded late success makes omission of the deadline fail a named assertion.
  const late = setTimeout(() => pending.resolve(response(request)), 250);
  try {
    await assert.rejects(first, error("TIMEOUT"));
    assert.equal(signal.aborted, true);
    await assert.rejects(s.sign(message), error("CLOSED"));
    pending.resolve(response(request));
    await tick();
    assert.equal(calls, 1);
  } finally {
    clearTimeout(late);
  }
});

test("status signer catches a valid response after synchronous event-loop blockage", async () => {
  const s = signer(
    (r) => {
      block(130);
      return response(r);
    },
    { timeoutMs: 100 },
  );
  await assert.rejects(s.sign(message), error("TIMEOUT"));
  await assert.rejects(s.sign(message), error("CLOSED"));
});

test("status signer avoids dispatch if its deadline elapsed before the transport microtask", async () => {
  let calls = 0;
  const s = signer(
    (r) => {
      calls++;
      return response(r);
    },
    { timeoutMs: 100 },
  );
  const pending = s.sign(message);
  block(130);
  await assert.rejects(pending, error("TIMEOUT"));
  assert.equal(calls, 0);
});

test("status signer pre-aborted input never dispatches and does not poison idle signer", async () => {
  const c = new AbortController();
  c.abort(Error("private reason"));
  let calls = 0;
  const s = signer((r) => {
    calls++;
    return response(r);
  });
  await assert.rejects(
    s.sign(message, { signal: c.signal }),
    error("CANCELLED"),
  );
  assert.equal(calls, 0);
  await s.sign(message);
  assert.equal(calls, 1);
});

test("status signer cancellation discards late transport completion", async () => {
  const c = new AbortController(),
    pending = deferred();
  let request, signal;
  const s = signer((r, o) => {
    request = r;
    signal = o.signal;
    return pending.promise;
  });
  const first = s.sign(message, { signal: c.signal });
  await tick();
  c.abort(Error("private reason"));
  await assert.rejects(first, error("CANCELLED"));
  assert(signal.aborted);
  pending.reject(Error("late private failure"));
  await tick();
  await assert.rejects(s.sign(message), error("CLOSED"));
  assert(request);
});

test("status signer close cancels outstanding work and prevents queued dispatch", async () => {
  for (const dispatched of [false, true]) {
    let calls = 0,
      signal;
    const pending = deferred();
    const s = signer((r, o) => {
      calls++;
      signal = o.signal;
      return pending.promise;
    });
    const first = s.sign(message);
    if (dispatched) await tick();
    s.close();
    s.close();
    await assert.rejects(first, error("CLOSED"));
    pending.reject(Error("late failure"));
    // If never dispatched the transport promise has no consumer; attach one locally.
    if (!dispatched) pending.promise.catch(() => {});
    await tick();
    assert.equal(calls, Number(dispatched));
    if (dispatched) assert(signal.aborted);
    await assert.rejects(s.sign(message), error("CLOSED"));
  }
});

test("status signer matches an actual existing receipt accepted by the unchanged observer", async (t) => {
  const f = fixture(t),
    id = f.mint();
  let now = 1000;
  const m = stateManifest(f.issuer.pinned.manifest, manifest.public_key);
  const observer = f.track(
    new StateObserver(join(f.dir, "observer.db"), f.issuer.pinned.manifest, m, {
      now: () => now,
    }),
  );
  const issuer = new StateIssuer(f.issuer, m, pair.privateKey, {
    now: () => now,
  });
  const c = observer.prepare(
    wallet,
    p.assetValue(asset, f.a.pinned),
    "28".repeat(32),
  );
  const show = f.a.show(id, wallet, showingChallenge(c));
  const wire = observer.request(c.challenge, show);
  const receipt = p.parse(issuer.observe(wire));
  const bytes = p.utf8(
    "ZFT_PS_Local_State_v1/receipt\0" + p.canonical(receipt.body),
  );
  const signature = await signer(undefined, {
    psManifest: f.issuer.pinned.manifest,
    manifest: m,
  }).sign(bytes);
  assert.equal(
    signature,
    receipt.signature,
    "exact existing domain and raw Ed25519 message",
  );
  const accepted = observer.accept(
    c.challenge,
    p.canonical({ body: receipt.body, signature }),
  );
  assert.equal(accepted.issuerReported, "unspent");
  assert.equal(accepted.walletAuthenticated, false);
});

test("status signer matches an actual stopped backup and unchanged restore verifier", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "zft-status-contract-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const state = join(dir, "state"),
    backup = join(dir, "backup");
  initializePersistent(state, 54123);
  const config = persistentConfig(state);
  const saved = await backupPersistent(state, backup);
  const snapshot = readFileSync(join(backup, "snapshot.json"), "utf8");
  const value = p.parse(snapshot);
  const privateKey = statusKey(config.config.status_private);
  const s = signer(async (r) => response(r, privateKey), {
    psManifest: config.pins.manifest,
    manifest: config.pins.status,
  });
  const signature = await s.sign(
    p.utf8("zft-ps-local-backup-v1/checkpoint\0" + p.canonical(value.body)),
  );
  assert.equal(signature, value.signature);
  assert.equal(p.canonical({ body: value.body, signature }), snapshot);
  assert.equal(readFileSync(join(backup, "snapshot.json"), "utf8"), snapshot);
  const restored = await restorePersistent(
    backup,
    join(dir, "restored"),
    saved.checkpoint,
  );
  assert.equal(restored.reviewRequired, true);
  assert.equal(restored.enabled, false);
});
