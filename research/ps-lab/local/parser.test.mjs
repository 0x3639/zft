// Bounded malformed-input corpus against real lab entry points and disposable stores.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { join } from "node:path";
import * as p from "./profile.mjs";
import {
  StateIssuer,
  StateObserver,
  stateManifest,
  showingChallenge,
} from "./state.mjs";
import { asset, wallet, nonce, fixture, pending } from "./test-support.mjs";

// Test serialization deliberately permits arrays, negative/fractional numbers and
// deep objects, so the corpus can exercise the production parser's rejection rules.
const json = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, v[key]]),
        )
      : v,
  );
function schemaCases(value, prefix = "root", wrap = (x) => x) {
  const cases = [
    [prefix + ": extra field", json(wrap({ ...value, unexpected: true }))],
  ];
  for (const key of Object.keys(value)) {
    const copy = { ...value };
    delete copy[key];
    cases.push([prefix + ": missing " + key, json(wrap(copy))]);
  }
  for (const replacement of [null, [], "object", 1, false])
    cases.push([
      prefix + ": wrong object type " + json(replacement),
      json(wrap(replacement)),
    ]);
  return cases;
}
function corpus(wire, limit) {
  const value = JSON.parse(wire),
    key = Object.keys(value)[0];
  const escapedKey =
    '"\\u' +
    key.charCodeAt(0).toString(16).padStart(4, "0") +
    key.slice(1) +
    '"';
  const cases = [
    ["leading whitespace", " " + wire],
    ["trailing newline", wire + "\n"],
    ["truncated JSON", wire.slice(0, -1)],
    ["trailing object", wire + "{}"],
    ["UTF-8 BOM as string", "\ufeff" + wire],
    [
      "reversed keys",
      JSON.stringify(Object.fromEntries(Object.entries(value).reverse())),
    ],
    ["escaped member name", wire.replace(JSON.stringify(key), escapedKey)],
    ["non-string Buffer", Buffer.from(wire)],
    ["undefined input", undefined],
    ["oversize canonical object", json({ padding: "x".repeat(limit) })],
    [
      "own __proto__ member",
      wire.slice(0, -1) + ',"__proto__":{"psPolluted":true}}',
    ],
    ...schemaCases(value),
  ];
  for (const k of Object.keys(value))
    cases.push([
      "duplicate root member " + k,
      "{" +
        JSON.stringify(k) +
        ":" +
        JSON.stringify(value[k]) +
        "," +
        wire.slice(1),
    ]);
  if (value.protocol)
    cases.push([
      "unknown protocol",
      json({ ...value, protocol: "zft-ps-unknown-v999" }),
    ]);
  if (value.credential) {
    cases.push(
      ...schemaCases(value.credential, "credential", (credential) => ({
        ...value,
        credential,
      })),
    );
    for (const [label, patch] of [
      ["zero secret", { s: "00".repeat(32) }],
      ["noncanonical secret", { s: p.scalarHex(p.Q) }],
      ["infinity signature", { u: "c0" + "00".repeat(47) }],
      ["short signature", { v: value.credential.v.slice(2) }],
    ])
      cases.push([
        label,
        json({ ...value, credential: { ...value.credential, ...patch } }),
      ]);
  }
  if (value.source)
    cases.push(
      ...schemaCases(value.source, "source", (source) => ({
        ...value,
        source,
      })),
    );
  if (value.body) {
    cases.push(
      ...schemaCases(value.body, "body", (body) => ({ ...value, body })),
    );
    const body = json(value.body),
      first = Object.keys(value.body)[0];
    const duplicate =
      "{" +
      JSON.stringify(first) +
      ":" +
      JSON.stringify(value.body[first]) +
      "," +
      body.slice(1);
    cases.push(["duplicate nested body member", wire.replace(body, duplicate)]);
  }
  for (const k of ["wire", "showing"])
    if (typeof value[k] === "string") {
      cases.push([
        "noncanonical embedded " + k,
        json({ ...value, [k]: value[k] + " " }),
      ]);
      cases.push([
        "wrong embedded " + k + " type",
        json({ ...value, [k]: {} }),
      ]);
    }
  for (const k of ["expires", "created_at", "expires_at", "min_sequence"])
    if (typeof value[k] === "number") {
      for (const bad of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1000", null])
        cases.push([
          k + ": invalid number " + json(bad),
          json({ ...value, [k]: bad }),
        ]);
      cases.push([
        k + ": noncanonical number spelling",
        wire.replace(
          '"' + k + '":' + value[k],
          '"' + k + '":' + value[k] + ".0",
        ),
      ]);
    }
  if (typeof value.asset === "string")
    for (const bad of ["", "0", "zz", value.asset.toUpperCase()])
      cases.push([
        "bad asset hex " + bad.slice(0, 8),
        json({ ...value, asset: bad }),
      ]);
  return cases;
}
const issuerTables = [
  "identity",
  "policy",
  "sessions",
  "operations",
  "assets",
  "spent",
  "sqlite_sequence",
];
const clientTables = ["identity", "pending", "credentials"];
function rows(db, tables) {
  return Object.fromEntries(
    tables.map((name) => [
      name,
      db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ]),
  );
}
function snapshot(f, observer) {
  return {
    issuer: rows(f.issuer.db, issuerTables),
    a: rows(f.a.db, clientTables),
    b: rows(f.b.db, clientTables),
    ...(observer
      ? {
          observer: rows(observer.db, [
            "identity",
            "observation_clock",
            "challenges",
          ]),
        }
      : {}),
  };
}
function rejectCorpus(t, f, wire, limit, invoke, observer) {
  const before = snapshot(f, observer),
    cases = corpus(wire, limit);
  const targets = Array.isArray(invoke) ? invoke : [invoke];
  for (const [label, bad] of cases) {
    for (const [index, target] of targets.entries()) {
      assert.throws(() => target(bad), undefined, label + ": target " + index);
      assert.deepEqual(
        snapshot(f, observer),
        before,
        label + ": persistence unchanged",
      );
      assert.equal(
        Object.prototype.psPolluted,
        undefined,
        "no prototype mutation",
      );
    }
  }
  t.diagnostic(
    `${cases.length} bounded malformed variants; ${cases.length * targets.length} rejected calls; database rows unchanged`,
  );
}
function operation(f, kind) {
  const digest =
    kind === "issue"
      ? f.a.prepareIssue(f.issuer.session("issue"), asset)
      : f.a.prepareCancel(f.issuer.session("swap"), f.mint());
  return { digest, v: pending(f.a, digest) };
}
for (const kind of ["issue", "swap"]) {
  test(`parser corpus rejects malformed ${kind} requests without issuer mutation`, (t) => {
    const f = fixture(t, { now: () => 1000 }),
      { v } = operation(f, kind),
      before = f.issuer.counts();
    rejectCorpus(t, f, v.wire, 12288, (wire) =>
      f.issuer.submit(wire, v.capability),
    );
    const response = f.issuer.submit(v.wire, v.capability);
    assert.equal(f.issuer.submit(v.wire, v.capability), response);
    assert.equal(f.issuer.counts().operations, before.operations + 1);
  });
  test(`parser corpus rejects malformed ${kind} responses without client mutation`, (t) => {
    const f = fixture(t, { now: () => 1000 }),
      { digest, v } = operation(f, kind);
    f.acknowledge(f.a, digest);
    const response = f.issuer.submit(v.wire, v.capability);
    rejectCorpus(t, f, response, 12288, (wire) => f.a.accept(digest, wire));
    const id = f.a.accept(digest, response);
    p.importBearer(f.a.export(id), f.a.pinned);
    assert.equal(f.a.pending(digest).response, response);
  });
  test(`parser corpus rejects malformed ${kind} recovery in existing and new stores`, (t) => {
    const f = fixture(t, { now: () => 1000 }),
      { digest } = operation(f, kind),
      wire = f.a.backup(digest);
    rejectCorpus(t, f, wire, 300000, [
      (bad) => f.a.restore(bad),
      (bad) => f.b.restore(bad),
    ]);
    assert.equal(f.a.pending(digest).acknowledged, 0);
    assert.equal(f.b.restore(wire), digest);
    assert.equal(f.b.backup(digest), wire);
    p.importBearer(f.b.export(f.b.submit(digest, f.issuer)), f.b.pinned);
  });
}
test("parser corpus rejects malformed bearer files without creating pending claims", (t) => {
  const f = fixture(t, { now: () => 1000 }),
    wire = f.a.export(f.mint()),
    session = f.issuer.session("swap");
  rejectCorpus(t, f, wire, 140000, (bad) => f.b.prepareClaim(session, bad));
  const digest = f.b.prepareClaim(session, wire);
  f.acknowledge(f.b, digest);
  p.importBearer(f.b.export(f.b.submit(digest, f.issuer)), f.b.pinned);
});
test("parser corpus rejects malformed public showings without registry mutation", (t) => {
  const f = fixture(t, { now: () => 1000 }),
    wire = f.a.show(f.mint(), wallet, nonce),
    h = p.assetValue(asset, f.a.pinned);
  const verify = (bad) => f.issuer.checkShowing(bad, wallet, nonce, h);
  rejectCorpus(t, f, wire, 12288, verify);
  assert.equal(verify(wire).state, "unspent");
  assert.equal(verify(wire).walletAuthenticated, false);
});
function observation(t) {
  const f = fixture(t, { now: () => 1000 }),
    id = f.mint();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = stateManifest(
    f.issuer.pinned.manifest,
    publicKey
      .export({ format: "der", type: "spki" })
      .subarray(12)
      .toString("hex"),
  );
  const observer = f.track(
    new StateObserver(
      join(f.dir, "observer.db"),
      f.issuer.pinned.manifest,
      manifest,
      { now: () => 1000 },
    ),
  );
  const issuer = new StateIssuer(f.issuer, manifest, privateKey, {
    now: () => 1000,
  });
  const c = observer.prepare(
    wallet,
    p.assetValue(asset, f.a.pinned),
    "28".repeat(32),
  );
  const wire = observer.request(
    c.challenge,
    f.a.show(id, wallet, showingChallenge(c)),
  );
  return { f, observer, issuer, c, wire };
}
test("parser corpus rejects malformed state requests without observation or registry mutation", (t) => {
  const s = observation(t);
  rejectCorpus(
    t,
    s.f,
    s.wire,
    8192,
    (bad) => s.issuer.observe(bad),
    s.observer,
  );
  assert.equal(
    s.observer.accept(s.c.challenge, s.issuer.observe(s.wire)).issuerReported,
    "unspent",
  );
});
test("parser corpus rejects malformed state receipts without consuming the challenge", (t) => {
  const s = observation(t),
    receipt = s.issuer.observe(s.wire);
  rejectCorpus(
    t,
    s.f,
    receipt,
    8192,
    (bad) => s.observer.accept(s.c.challenge, bad),
    s.observer,
  );
  assert.equal(
    s.observer.accept(s.c.challenge, receipt).issuerReported,
    "unspent",
  );
  assert.equal(s.observer.row(s.c.challenge).receipt, receipt);
});

test("parser limits count UTF-8 bytes at each local wire boundary", () => {
  for (const limit of [8192, 12288, 140000, 300000]) {
    // {"a":""} is eight ASCII bytes; repeated é is two bytes per code point.
    const wire = '{"a":"' + "é".repeat((limit - 8) / 2) + '"}';
    assert.equal(Buffer.byteLength(wire), limit);
    assert.equal(json(p.parse(wire, limit)), wire);
    assert.throws(() => p.parse(wire, limit - 1), /wire size/);
    assert.throws(() => p.parse(wire.replace('"}', 'x"}'), limit), /wire size/);
  }
});
test("parser canonical boundaries reject deep objects and alternate numeric encodings", () => {
  const nested = (depth) => {
    let v = 1;
    for (let i = 0; i < depth; i++) v = { a: v };
    return json(v);
  };
  assert.equal(json(p.parse(nested(7))), nested(7));
  assert.throws(() => p.parse(nested(8)), /JSON depth/);
  for (const wire of [
    '{"a":-0}',
    '{"a":1.0}',
    '{"a":1e0}',
    '{"a":-1}',
    '{"a":0.5}',
    '{"a":9007199254740992}',
    '{"a":[]}',
    '{"a":1,"a":1}',
    '{"a":{"x":1,"x":1}}',
  ])
    assert.throws(() => p.parse(wire), undefined, wire);
  assert.equal(
    json(p.parse('{"a":0,"b":9007199254740991}')),
    '{"a":0,"b":9007199254740991}',
  );
});
test("maximum local asset roundtrips while empty and one-byte-over assets leave no pending state", (t) => {
  const f = fixture(t, { now: () => 1000 }),
    session = f.issuer.session("issue"),
    before = snapshot(f);
  for (const bad of [new Uint8Array(), new Uint8Array(65537)]) {
    assert.throws(() => f.a.prepareIssue(session, bad), /asset size/);
    assert.deepEqual(snapshot(f), before);
  }
  const bytes = new Uint8Array(65536).fill(0x80),
    digest = f.a.prepareIssue(session, bytes),
    saved = f.a.backup(digest);
  assert(Buffer.byteLength(saved) < 300000);
  assert.equal(f.b.restore(saved), digest);
  const id = f.b.submit(digest, f.issuer),
    envelope = f.b.export(id);
  assert(Buffer.byteLength(envelope) < 140000);
  assert.equal(p.importBearer(envelope, f.a.pinned).asset, p.hex(bytes));
});
