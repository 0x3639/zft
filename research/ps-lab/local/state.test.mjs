import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519, ED25519_TORSION_SUBGROUP } from "@noble/curves/ed25519.js";
import * as p from "./profile.mjs";
import {
  StateIssuer,
  StateObserver,
  stateManifest,
  showingChallenge,
  STATE_TTL,
  STATE_LIMIT,
} from "./state.mjs";
import { fixture, asset, wallet, child } from "./test-support.mjs";

// RFC 8032 section 7.1, test 1. This seed is PUBLIC, never an issuer secret.
const seed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const rawKey =
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const key = createPrivateKey({
  key: Buffer.from("302e020100300506032b657004220420" + seed, "hex"),
  format: "der",
  type: "pkcs8",
});
const audience = "28".repeat(32);
const message = (body) =>
  Buffer.from("ZFT_PS_Local_State_v1/receipt\0" + p.canonical(body));
function signed(body, privateKey = key) {
  return p.canonical({
    body,
    signature: sign(null, message(body), privateKey).toString("hex"),
  });
}
function setup(t) {
  const f = fixture(t),
    id = f.mint(),
    h = p.assetValue(asset, f.a.pinned);
  let now = 1000;
  const manifest = stateManifest(f.issuer.pinned.manifest, rawKey);
  const open = (name = "observations", options = {}) =>
    f.track(
      new StateObserver(
        join(f.dir, name + ".db"),
        f.issuer.pinned.manifest,
        manifest,
        { now: () => now, ...options },
      ),
    );
  const observer = open();
  const issuer = new StateIssuer(f.issuer, manifest, key, { now: () => now });
  const query = (credentialId = id, o = observer) => {
    const c = o.prepare(wallet, h, audience),
      showing = f.a.show(credentialId, wallet, showingChallenge(c)),
      wire = o.request(c.challenge, showing);
    return { c, wire, receipt: issuer.observe(wire) };
  };
  const swap = (old = id) => {
    const digest = f.a.prepareCancel(f.issuer.session("swap"), old);
    f.acknowledge(f.a, digest);
    return f.a.submit(digest, f.issuer);
  };
  return {
    f,
    id,
    h,
    manifest,
    issuer,
    observer,
    open,
    query,
    swap,
    time: (n) => {
      now = n;
    },
    now: () => now,
  };
}
function worker(s, q, crash) {
  return child({
    observer: true,
    path: join(s.f.dir, "observations.db"),
    psManifest: s.f.issuer.pinned.manifest,
    stateManifest: s.manifest,
    now: s.now(),
    challenge: q.c.challenge,
    receipt: q.receipt,
    crash,
  });
}

test("state Ed25519 backend matches RFC 8032 test 1", () => {
  const expected =
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
  assert.equal(
    createPublicKey(key)
      .export({ format: "der", type: "spki" })
      .toString("hex"),
    "302a300506032b6570032100" + rawKey,
  );
  const signature = sign(null, new Uint8Array(), key);
  assert.equal(signature.toString("hex"), expected);
  assert(verify(null, new Uint8Array(), createPublicKey(key), signature));
  assert(
    ed25519.verify(signature, new Uint8Array(), p.bytes(rawKey), {
      zip215: false,
    }),
  );
  assert(
    !verify(null, Buffer.from("changed"), createPublicKey(key), signature),
  );
});

test("signed state verifies the exact public proof without authenticating its wallet", (t) => {
  const s = setup(t),
    before = s.f.issuer.counts(),
    q = s.query(),
    envelope = p.parse(q.receipt);
  assert(
    ed25519.verify(
      p.bytes(envelope.signature),
      message(envelope.body),
      p.bytes(rawKey),
      { zip215: false },
    ),
  );
  assert.deepEqual(s.observer.accept(q.c.challenge, q.receipt), {
    issuerReported: "unspent",
    observedAt: 1000,
    expiresAt: 1060,
    sequence: 1,
    proofValid: true,
    walletAuthenticated: false,
  });
  assert.deepEqual(s.f.issuer.counts(), before);
  assert.equal(s.observer.row(q.c.challenge).receipt, q.receipt);
  const secret = p.parse(s.f.a.export(s.id), 140000).credential.s;
  assert(!q.wire.includes(secret));
  assert(!q.receipt.includes(secret));
  assert(!q.receipt.includes('"credential"'));
  assert(!q.receipt.includes('"asset"'));
});

test("state manifest pins the complete PS scope and a separate signing key", (t) => {
  const s = setup(t),
    wrong = generateKeyPairSync("ed25519").privateKey;
  assert.throws(
    () => new StateIssuer(s.f.issuer, s.manifest, wrong),
    /key mismatch/,
  );
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  assert.throws(() => new StateIssuer(s.f.issuer, s.manifest, ec), /Ed25519/);
  for (const patch of [
    { realm: "00".repeat(32) },
    { ps_manifest_hash: "00".repeat(32) },
    { status_key_id: "00".repeat(32) },
    { algorithm: "ECDSA" },
    { extra: true },
  ])
    assert.throws(
      () => new StateIssuer(s.f.issuer, { ...s.manifest, ...patch }, key),
    );
});

test("state key parser rejects weak and noncanonical Ed25519 keys", (t) => {
  const s = setup(t);
  for (const raw of [
    ...ED25519_TORSION_SUBGROUP,
    "ff".repeat(32),
    rawKey.toUpperCase(),
    rawKey + "00",
  ])
    assert.throws(() => stateManifest(s.f.issuer.pinned.manifest, raw));
});

test("observer database refuses status key or PS realm replacement", (t) => {
  const s = setup(t);
  s.query();
  s.observer.close();
  const otherRaw = createPublicKey(generateKeyPairSync("ed25519").privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("hex");
  const manifest = stateManifest(s.f.issuer.pinned.manifest, otherRaw);
  assert.throws(
    () =>
      new StateObserver(
        join(s.f.dir, "observations.db"),
        s.f.issuer.pinned.manifest,
        manifest,
      ),
    /identity mismatch/,
  );
  const ps = { ...s.f.issuer.pinned.manifest, realm: "99".repeat(32) };
  assert.throws(
    () =>
      new StateObserver(
        join(s.f.dir, "observations.db"),
        ps,
        stateManifest(ps, rawKey),
      ),
    /identity mismatch/,
  );
});

test("state signature tampering is rejected without consuming the challenge", (t) => {
  const s = setup(t),
    q = s.query(),
    v = p.parse(q.receipt);
  const forged = p.canonical({ ...v, body: { ...v.body, state: "spent" } });
  assert.throws(
    () => s.observer.accept(q.c.challenge, forged),
    /state signature/,
  );
  const wrong = generateKeyPairSync("ed25519").privateKey;
  assert.throws(
    () => s.observer.accept(q.c.challenge, signed(v.body, wrong)),
    /state signature/,
  );
  assert.equal(s.observer.row(q.c.challenge).consumed, 0);
  s.observer.accept(q.c.challenge, q.receipt);
});

test("even correctly signed substitutions cannot change the saved observation context", (t) => {
  const s = setup(t),
    q = s.query(),
    { body } = p.parse(q.receipt);
  const patches = [
    { protocol: "other" },
    { realm: "00".repeat(32) },
    { keyset_id: "00".repeat(33) },
    { ps_manifest_hash: "00".repeat(32) },
    { status_key_id: "00".repeat(32) },
    { purpose: "transfer" },
    { audience: "00".repeat(32) },
    { wallet: "00".repeat(20) },
    { challenge: "00".repeat(32) },
    { h: p.scalarHex(1n) },
    { created_at: 999 },
    { expires_at: 1061 },
    { min_sequence: 5 },
    { request_hash: "00".repeat(32) },
    { showing_hash: "00".repeat(32) },
    { nullifier: p.encodedPoint(p.G1) },
    { state: "unavailable" },
    { observed_at: 999 },
    { observed_at: 1060 },
  ];
  for (const patch of patches) {
    assert.throws(
      () => s.observer.accept(q.c.challenge, signed({ ...body, ...patch })),
      undefined,
      JSON.stringify(patch),
    );
    assert.equal(s.observer.row(q.c.challenge).consumed, 0);
  }
  s.observer.accept(q.c.challenge, q.receipt);
});

test("state showing challenge binds audience and every request context field", (t) => {
  const s = setup(t),
    q = s.query(),
    r = p.parse(q.wire);
  for (const patch of [
    { audience: "47".repeat(32) },
    { challenge: "48".repeat(32) },
    { min_sequence: 1 },
    { created_at: 999, expires_at: 1059 },
  ])
    assert.throws(
      () => s.issuer.observe(p.canonical({ ...r, ...patch })),
      /show challenge/,
    );
});

test("invalid PS proof never obtains a signed state observation", (t) => {
  const s = setup(t),
    q = s.query(),
    r = p.parse(q.wire),
    showing = p.parse(r.showing);
  for (const patch of [
    { proof: "00".repeat(64) },
    { v: p.encodedPoint(p.G1) },
    { wallet: "00".repeat(20) },
    { h: p.scalarHex(1n) },
  ])
    assert.throws(() =>
      s.issuer.observe(
        p.canonical({ ...r, showing: p.canonical({ ...showing, ...patch }) }),
      ),
    );
  assert.equal(s.f.issuer.counts().operations, 1);
});

test("state parser rejects oversized, duplicate, extra, missing and noncanonical fields", (t) => {
  const s = setup(t),
    q = s.query(),
    r = p.parse(q.wire),
    e = p.parse(q.receipt);
  for (const bad of [
    " ".repeat(STATE_LIMIT + 1),
    q.wire + " ",
    q.wire.replace("{", '{"purpose":"credential-state",'),
    p.canonical({ ...r, extra: true }),
    p.canonical({ ...r, showing: null }),
    p.canonical({ ...r, expires_at: r.expires_at + 1 }),
  ])
    assert.throws(() => s.issuer.observe(bad));
  const { state, ...missing } = e.body;
  for (const bad of [
    " ".repeat(STATE_LIMIT + 1),
    q.receipt + " ",
    p.canonical({ ...e, extra: true }),
    signed(missing),
    signed({ ...e.body, extra: true }),
    p.canonical({ ...e, signature: e.signature.toUpperCase() }),
    p.canonical({ ...e, signature: "00".repeat(65) }),
    p.canonical({ ...e, body: null }),
  ])
    assert.throws(() => s.observer.accept(q.c.challenge, bad));
  assert.throws(
    () => s.observer.request(q.c.challenge, " ".repeat(STATE_LIMIT + 1)),
    /wire size/,
  );
  s.observer.accept(q.c.challenge, q.receipt);
});

test("state response cannot be replayed after observer restart", (t) => {
  const s = setup(t),
    q = s.query();
  s.observer.accept(q.c.challenge, q.receipt);
  s.observer.close();
  const reopened = s.open();
  assert.throws(() => reopened.accept(q.c.challenge, q.receipt), /consumed/);
  assert.equal(reopened.row(q.c.challenge).receipt, q.receipt);
});

test("unknown, unsaved and wrong challenges cannot accept a state receipt", (t) => {
  const s = setup(t),
    q = s.query();
  assert.throws(() => s.observer.accept("77".repeat(32), q.receipt), /unknown/);
  const other = s.observer.prepare(wallet, s.h, audience);
  assert.throws(
    () => s.observer.accept(other.challenge, q.receipt),
    /not saved/,
  );
  const show = s.f.a.show(s.id, wallet, showingChallenge(other));
  s.observer.request(other.challenge, show);
  assert.throws(() => s.observer.accept(other.challenge, q.receipt), /context/);
  assert.equal(s.observer.row(other.challenge).consumed, 0);
});

test("state request retry returns exact saved bytes and refuses another randomized proof", (t) => {
  const s = setup(t),
    q = s.query(),
    r = p.parse(q.wire);
  assert.equal(s.observer.request(q.c.challenge, r.showing), q.wire);
  const second = s.f.a.show(s.id, wallet, showingChallenge(q.c));
  assert.notEqual(second, r.showing);
  assert.throws(
    () => s.observer.request(q.c.challenge, second),
    /already bound/,
  );
  assert.equal(s.observer.row(q.c.challenge).wire, q.wire);
});

for (const offset of [-1, STATE_TTL])
  test(`state challenge rejects receipt outside its lifetime at offset ${offset}`, (t) => {
    const s = setup(t),
      q = s.query();
    s.time(1000 + offset);
    assert.throws(() => s.issuer.observe(q.wire), /expired or clock behind/);
    assert.throws(
      () => s.observer.accept(q.c.challenge, q.receipt),
      /clock rollback|expired/,
    );
    assert.equal(s.observer.row(q.c.challenge).consumed, 0);
  });

test("state validity is rechecked inside the observer commit boundary", (t) => {
  const s = setup(t),
    q = s.query(),
    before = s.observer.clock();
  s.observer.boundary = (phase) => {
    if (phase === "before-state-accept") s.time(1060);
  };
  assert.throws(() => s.observer.accept(q.c.challenge, q.receipt), /expired/);
  assert.equal(s.observer.row(q.c.challenge).consumed, 0);
  assert.deepEqual(s.observer.clock(), before);
});

test("future signed observation and persistent local clock rollback reject", (t) => {
  const s = setup(t),
    q = s.query(),
    { body } = p.parse(q.receipt);
  assert.throws(
    () =>
      s.observer.accept(q.c.challenge, signed({ ...body, observed_at: 1001 })),
    /future/,
  );
  s.time(1001);
  s.observer.accept(q.c.challenge, q.receipt);
  s.observer.close();
  s.time(1000);
  const reopened = s.open();
  assert.throws(
    () => reopened.prepare(wallet, s.h, audience),
    /clock rollback/,
  );
});

test("delayed state receipt cannot lower a newer accepted sequence", (t) => {
  const s = setup(t),
    old = s.query(),
    next = s.swap(),
    newer = s.query(next);
  s.observer.accept(newer.c.challenge, newer.receipt);
  assert.throws(
    () => s.observer.accept(old.c.challenge, old.receipt),
    /sequence rollback/,
  );
  assert.equal(s.observer.row(old.c.challenge).consumed, 0);
  const updated = s.issuer.observe(old.wire);
  assert.equal(
    s.observer.accept(old.c.challenge, updated).issuerReported,
    "spent",
  );
  assert.equal(s.observer.clock().sequence, 2);
});

test("remembered issuer sequence detects a restored older registry", (t) => {
  const s = setup(t),
    backup = join(s.f.dir, "old-issuer.db");
  const oldEnvelope = s.f.a.export(s.id);
  copyFileSync(join(s.f.dir, "issuer.db"), backup);
  const next = s.swap(),
    newer = s.query(next);
  s.observer.accept(newer.c.challenge, newer.receipt);
  s.f.issuer.close();
  copyFileSync(backup, join(s.f.dir, "issuer.db"));
  const issuer = s.f.openIssuer(),
    signer = new StateIssuer(issuer, s.manifest, key, { now: s.now });
  const c = s.observer.prepare(wallet, s.h, audience),
    show = s.f.a.show(next, wallet, showingChallenge(c)),
    wire = s.observer.request(c.challenge, show);
  assert.throws(() => signer.observe(wire), /sequence behind observer/);
  // Explicit trust limit: a fresh observer cannot detect that historical rollback.
  const fresh = s.open("fresh"),
    unknown = fresh.prepare(wallet, s.h, audience);
  const credential = p.importBearer(oldEnvelope, s.f.a.pinned).credential;
  const oldShow = p.showing(
    credential,
    wallet,
    showingChallenge(unknown),
    s.f.a.pinned,
  );
  const accepted = fresh.accept(
    unknown.challenge,
    signer.observe(fresh.request(unknown.challenge, oldShow)),
  );
  assert.equal(accepted.issuerReported, "unspent");
});

test("suspended mint still signs observations without issuing or spending", (t) => {
  const s = setup(t),
    q = s.query(),
    before = s.f.issuer.counts();
  s.f.issuer.setEnabled(false);
  assert.equal(
    s.observer.accept(q.c.challenge, s.issuer.observe(q.wire)).issuerReported,
    "unspent",
  );
  assert.deepEqual(s.f.issuer.counts(), before);
});

test("issuer outage and malformed unavailable response never become unspent", (t) => {
  const s = setup(t),
    q = s.query(),
    before = s.observer.clock();
  s.f.issuer.close();
  assert.throws(() => s.issuer.observe(q.wire));
  assert.throws(() => s.observer.accept(q.c.challenge, "unavailable"));
  assert.equal(s.observer.row(q.c.challenge).consumed, 0);
  assert.equal(s.observer.row(q.c.challenge).receipt, null);
  assert.deepEqual(s.observer.clock(), before);
});

test("an unspent observation remains historical after an intervening spend", (t) => {
  const s = setup(t),
    q = s.query(),
    original = s.f.a.export(s.id);
  s.swap();
  // Within its deadline, the earlier signed observation still describes sequence 1.
  assert.equal(
    s.observer.accept(q.c.challenge, q.receipt).issuerReported,
    "unspent",
  );
  const c = s.observer.prepare(wallet, s.h, audience);
  const credential = p.importBearer(original, s.f.a.pinned).credential;
  const show = p.showing(credential, wallet, showingChallenge(c), s.f.a.pinned);
  const wire = s.observer.request(c.challenge, show);
  const result = s.observer.accept(c.challenge, s.issuer.observe(wire));
  assert.equal(result.issuerReported, "spent");
  assert.equal(result.sequence, 2);
});

test("active observation challenges are bounded and consumed slots can be reused", (t) => {
  const s = setup(t),
    q = s.query();
  for (let i = 1; i < 100; i++) s.observer.prepare(wallet, s.h, audience);
  assert.throws(
    () => s.observer.prepare(wallet, s.h, audience),
    /challenge limit/,
  );
  s.observer.accept(q.c.challenge, q.receipt);
  s.observer.prepare(wallet, s.h, audience);
  s.time(1060);
  s.observer.prepare(wallet, s.h, audience);
});

test("state acceptance watermark and challenge consumption commit atomically", (t) => {
  const s = setup(t),
    q = s.query(),
    before = s.observer.clock();
  s.observer.boundary = (phase) => {
    if (phase === "after-state-watermark")
      throw new Error("injected interruption");
  };
  assert.throws(() => s.observer.accept(q.c.challenge, q.receipt), /injected/);
  assert.deepEqual(s.observer.clock(), before);
  assert.equal(s.observer.row(q.c.challenge).consumed, 0);
  assert.equal(s.observer.row(q.c.challenge).receipt, null);
  s.observer.boundary = () => {};
  s.observer.accept(q.c.challenge, q.receipt);
});

for (const crash of ["after-state-watermark", "after-state-commit"])
  test(`SIGKILL ${crash} preserves observation replay state`, async (t) => {
    const s = setup(t),
      q = s.query(),
      before = s.observer.clock();
    s.observer.close();
    const w = worker(s, q, crash);
    await w.ready;
    w.run();
    const result = await w.done;
    assert.equal(result.signal, "SIGKILL", result.stderr);
    const reopened = s.open();
    if (crash === "after-state-watermark") {
      assert.deepEqual(reopened.clock(), before);
      assert.equal(reopened.row(q.c.challenge).consumed, 0);
      reopened.accept(q.c.challenge, q.receipt);
    } else {
      assert.equal(reopened.row(q.c.challenge).receipt, q.receipt);
      assert.equal(reopened.clock().sequence, 1);
      assert.throws(
        () => reopened.accept(q.c.challenge, q.receipt),
        /consumed/,
      );
    }
  });

test("two observer processes consume one challenge exactly once", async (t) => {
  const s = setup(t),
    q = s.query();
  const workers = [worker(s, q), worker(s, q)];
  await Promise.all(workers.map((w) => w.ready));
  workers.forEach((w) => w.run());
  const results = await Promise.all(workers.map((w) => w.done));
  assert(results.every((r) => r.code === 0));
  assert.equal(results.filter((r) => r.message.ok).length, 1);
  assert.match(results.find((r) => !r.message.ok).message.error, /consumed/);
  assert.equal(s.observer.row(q.c.challenge).consumed, 1);
});

test("state verifier rejects altered and noncanonical Ed25519 signatures", (t) => {
  const s = setup(t),
    q = s.query(),
    value = p.parse(q.receipt);
  const encodedS = p.bytes(value.signature.slice(64));
  const scalarS = BigInt(
    "0x" + Buffer.from(encodedS).reverse().toString("hex"),
  );
  const order = (1n << 252n) + 27742317777372353535851937790883648493n;
  const oversizedS = Buffer.from(
    (scalarS + order).toString(16).padStart(64, "0"),
    "hex",
  )
    .reverse()
    .toString("hex");
  for (const signature of [
    value.signature.slice(0, 64) + oversizedS,
    "ff".repeat(32) + value.signature.slice(64),
  ])
    assert.throws(
      () =>
        s.observer.accept(q.c.challenge, p.canonical({ ...value, signature })),
      /state signature/,
    );
  s.observer.accept(q.c.challenge, q.receipt);
});

test("state counters and timestamps reject noninteger values", (t) => {
  const s = setup(t),
    q = s.query(),
    r = p.parse(q.wire),
    { body } = p.parse(q.receipt);
  for (const value of ["1", null, true]) {
    assert.throws(
      () => s.issuer.observe(p.canonical({ ...r, min_sequence: value })),
      /state integer/,
    );
    assert.throws(
      () =>
        s.observer.accept(q.c.challenge, signed({ ...body, sequence: value })),
      /state integer/,
    );
    assert.throws(
      () =>
        s.observer.accept(
          q.c.challenge,
          signed({ ...body, observed_at: value }),
        ),
      /state integer/,
    );
  }
  for (const value of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    s.time(value);
    assert.throws(
      () => s.observer.prepare(wallet, s.h, audience),
      /state integer/,
    );
  }
  s.time(1000);
  s.observer.accept(q.c.challenge, q.receipt);
});
