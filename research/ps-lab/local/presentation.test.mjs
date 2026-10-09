import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { fixture } from "./test-support.mjs";
import * as p from "./profile.mjs";
import {
  stateManifest,
  StateIssuer,
  StateObserver,
  showingChallenge,
} from "./state.mjs";
import {
  PRESENTATION,
  PRESENTATION_LIMIT,
  presentationAudience,
  presentationOrigin,
  endorsementMessage,
  verifyEndorsement,
  verifyPresentation,
} from "./presentation.mjs";
const origin = "http://127.0.0.1:4141";
const images = JSON.parse(
  readFileSync(new URL("./image-fixtures.json", import.meta.url)),
).images;
// Public deterministic test key, not a wallet belonging to a person.
const key = p.bytes("11".repeat(32));
const wallet = p.hex(
  keccak_256(secp256k1.getPublicKey(key, false).slice(1)).slice(-20),
);
function signMessage(text) {
  const bytes = p.utf8(text),
    prefix = p.utf8("\x19Ethereum Signed Message:\n" + bytes.length),
    input = new Uint8Array(prefix.length + bytes.length);
  input.set(prefix);
  input.set(bytes, prefix.length);
  const sig = secp256k1.sign(keccak_256(input), key, {
    prehash: false,
    format: "recovered",
  });
  return "0x" + p.hex(sig.slice(1)) + (sig[0] + 27).toString(16);
}
function setup(t, withWallet = false) {
  const f = fixture(t),
    image = p.bytes(images[0].pngHex),
    d = f.a.prepareIssue(f.issuer.session("issue"), image);
  f.acknowledge(f.a, d);
  const id = f.a.submit(d, f.issuer);
  const { privateKey } = generateKeyPairSync("ed25519");
  const raw = createPublicKey(privateKey)
    .export({ type: "spki", format: "der" })
    .subarray(-32)
    .toString("hex");
  const status = stateManifest(f.issuer.pinned.manifest, raw),
    now = 1000;
  const observer = f.track(
    new StateObserver(
      join(f.dir, "public-observer.db"),
      f.issuer.pinned.manifest,
      status,
      { now: () => now },
    ),
  );
  const issuer = new StateIssuer(f.issuer, status, privateKey, {
    now: () => now,
  });
  const c = observer.prepare(
    withWallet ? wallet : "00".repeat(20),
    p.assetValue(image, f.a.pinned),
    presentationAudience(origin, withWallet ? 1 : 0),
  );
  const showing = f.a.show(id, c.wallet, showingChallenge(c)),
    request = observer.request(c.challenge, showing),
    receipt = issuer.observe(request);
  observer.accept(c.challenge, receipt);
  const v = {
    format: PRESENTATION,
    origin,
    chain_id: withWallet ? 1 : 0,
    context: c,
    showing,
    receipt,
    image: p.hex(image),
    image_sha256: p.hash(image),
    wallet_signature: null,
  };
  if (withWallet) v.wallet_signature = signMessage(endorsementMessage(v));
  return {
    f,
    id,
    v,
    status,
    check: (value = v, time = now, options = {}) =>
      verifyPresentation(
        p.canonical(value),
        f.issuer.pinned.manifest,
        status,
        origin,
        time,
        options,
      ),
  };
}
test("public evidence distinguishes anonymous credential proof from wallet signing key and expiry", async (t) => {
  const s = setup(t),
    value = await s.check();
  assert.equal(value.credentialValid, true);
  assert.equal(value.walletSigningKeyValid, false);
  assert.equal(value.contractWalletChecked, false);
  assert.equal(value.issuerReported, "unspent");
  assert.equal(value.withinObservationInterval, true);
  assert.equal((await s.check(s.v, 1060)).withinObservationInterval, false);
  await assert.rejects(
    () => s.check(s.v, 1060, { requireFresh: true }),
    /expired/,
  );
});
test("public evidence verifies the exact ERC-191 endorsement independently of credential validity", async (t) => {
  const s = setup(t, true);
  assert.equal((await s.check()).walletSigningKeyValid, true);
  await assert.rejects(
    () => s.check({ ...s.v, wallet_signature: null }),
    /unsigned wallet/,
  );
  await assert.rejects(
    () => s.check({ ...s.v, wallet_signature: signMessage("another request") }),
    /wallet signing key/,
  );
  assert.throws(() => verifyEndorsement("a", "0x" + "00".repeat(65), wallet));
});
test("public evidence rejects cross-asset images even with a fresh valid wallet signature", async (t) => {
  const s = setup(t, true),
    image = p.bytes(images[1].pngHex);
  const v = { ...s.v, image: p.hex(image), image_sha256: p.hash(image) };
  v.wallet_signature = signMessage(endorsementMessage(v));
  await assert.rejects(() => s.check(v), /signed asset/);
});
test("public evidence rejects every substituted scope, context, signed body and proof field", async (t) => {
  // Anonymous evidence isolates the issuer signature from optional wallet checks.
  const s = setup(t);
  const changes = [
    (v) => (v.origin = "http://127.0.0.1:4142"),
    (v) => (v.chain_id = 2),
    (v) => (v.format += "x"),
    (v) => (v.context.realm = "22".repeat(32)),
    (v) => (v.context.keyset_id = "22".repeat(32)),
    (v) => (v.context.ps_manifest_hash = "22".repeat(32)),
    (v) => (v.context.status_key_id = "22".repeat(32)),
    (v) => (v.context.audience = "22".repeat(32)),
    (v) => (v.context.challenge = "22".repeat(32)),
    (v) => (v.context.wallet = "22".repeat(20)),
    (v) => v.context.created_at++,
    (v) => v.context.expires_at++,
    (v) => v.context.min_sequence++,
    (v) => (v.context.purpose = "other"),
    (v) => (v.image_sha256 = "22".repeat(32)),
    (v) => {
      const x = JSON.parse(v.showing);
      x.n = x.u;
      v.showing = p.canonical(x);
    },
    (v) => {
      const x = JSON.parse(v.receipt);
      x.body.state = "spent";
      v.receipt = p.canonical(x);
    },
    (v) => {
      const x = JSON.parse(v.receipt);
      x.body.observed_at++;
      v.receipt = p.canonical(x);
    },
    (v) => {
      const x = JSON.parse(v.receipt);
      x.signature = "00".repeat(64);
      v.receipt = p.canonical(x);
    },
    (v) => (v.secret = "00"),
  ];
  for (const change of changes) {
    const v = structuredClone(s.v);
    change(v);
    await assert.rejects(() => s.check(v));
  }
});
test("caller pins cannot be replaced by an imported public record", async (t) => {
  const s = setup(t),
    ps = { ...s.f.issuer.pinned.manifest, realm: "42".repeat(32) };
  await assert.rejects(() =>
    verifyPresentation(
      p.canonical(s.v),
      s.f.issuer.pinned.manifest,
      s.status,
      "http://127.0.0.1:4142",
      1000,
    ),
  );
  await assert.rejects(() =>
    s.check({ ...s.v, origin: "http://127.0.0.1:4142" }),
  );
  await assert.rejects(() =>
    verifyPresentation(p.canonical(s.v), ps, s.status, origin, 1000),
  );
  await assert.rejects(() =>
    verifyPresentation(
      p.canonical(s.v),
      s.f.issuer.pinned.manifest,
      { ...s.status, public_key: "00".repeat(32) },
      origin,
      1000,
    ),
  );
});
test("timestamped evidence remains historical after a later spend; never a reservation", async (t) => {
  const s = setup(t),
    d = s.f.a.prepareCancel(s.f.issuer.session("swap"), s.id);
  s.f.acknowledge(s.f.a, d);
  s.f.a.submit(d, s.f.issuer);
  const report = await s.check(s.v, 1001);
  assert.equal(report.issuerReported, "unspent");
  assert.equal(report.withinObservationInterval, true);
  assert(!("currentOwner" in report));
  assert(!("walletAuthenticated" in report));
});
test("public presentation parser bounds canonical bytes and hostile metadata", async (t) => {
  const s = setup(t);
  for (const wire of [
    " " + p.canonical(s.v),
    p.canonical({ ...s.v, extra: "x" }),
    "x".repeat(PRESENTATION_LIMIT + 1),
  ])
    await assert.rejects(() =>
      verifyPresentation(
        wire,
        s.f.issuer.pinned.manifest,
        s.status,
        origin,
        1000,
      ),
    );
  for (const url of [
    "https://example.com/",
    "http://example.com",
    "https://user@example.com",
    "https://example.com?q=x",
    "file:///tmp/x",
  ])
    assert.throws(() => presentationOrigin(url));
  for (const n of [-1, -0, 1.5, 2 ** 40])
    assert.throws(() => presentationAudience(origin, n));
  await assert.rejects(() => s.check(s.v, 999), /observation time/);
});

test("presentation service admits exact observations and idempotent opt-in publications", async (t) => {
  const { PresentationApi } = await import("./presentation-api.mjs");
  const s = setup(t),
    api = s.f.track(
      new PresentationApi(s.f.issuer, join(s.f.dir, "publication.db"), origin, {
        now: () => 1000,
      }),
    );
  const { context } = await api.dispatch({
    action: "prepare",
    wallet: "00".repeat(20),
    h: s.v.context.h,
    chain_id: 0,
  });
  const showing = s.f.a.show(s.id, context.wallet, showingChallenge(context));
  const { receipt } = await api.dispatch({
    action: "observe",
    challenge: context.challenge,
    showing,
  });
  assert.equal(
    (
      await api.dispatch({
        action: "observe",
        challenge: context.challenge,
        showing,
      })
    ).receipt,
    receipt,
  );
  await assert.rejects(() =>
    api.dispatch({
      action: "observe",
      challenge: context.challenge,
      showing: showing + " ",
    }),
  );
  const wire = p.canonical({ ...s.v, context, showing, receipt });
  const { id, report } = await api.dispatch({ action: "publish", wire });
  assert.equal(id, p.hash(wire));
  assert.equal(report.credentialValid, true);
  assert.equal((await api.dispatch({ action: "publish", wire })).id, id);
  assert.equal(api.records.size, 1);
  assert.equal(api.read(id).wire, wire);
  await assert.rejects(() =>
    api.dispatch({
      action: "publish",
      wire: p.canonical({ ...s.v, context, showing, receipt, secret: "never" }),
    }),
  );
  assert.equal(api.records.size, 1);
});
test("presentation service rejects expired publication without saving it and bounds requests", async (t) => {
  const { PresentationApi } = await import("./presentation-api.mjs");
  let now = 1000;
  const s = setup(t),
    api = s.f.track(
      new PresentationApi(
        s.f.issuer,
        join(s.f.dir, "bounded-publication.db"),
        origin,
        { now: () => now },
      ),
    );
  const req = {
    action: "prepare",
    wallet: "00".repeat(20),
    h: s.v.context.h,
    chain_id: 0,
  };
  const { context } = await api.dispatch(req),
    showing = s.f.a.show(s.id, context.wallet, showingChallenge(context));
  const { receipt } = await api.dispatch({
    action: "observe",
    challenge: context.challenge,
    showing,
  });
  now = 1060;
  await assert.rejects(
    () =>
      api.dispatch({
        action: "publish",
        wire: p.canonical({ ...s.v, context, showing, receipt }),
      }),
    /expired/,
  );
  assert.equal(api.records.size, 0);
  for (let i = 1; i < 64; i++) await api.dispatch(req);
  await assert.rejects(() => api.dispatch(req), /request cap/);
  assert.equal(api.requests.size, 64);
  assert.equal(
    api.observer.db.prepare("SELECT COUNT(*) AS n FROM challenges").get().n,
    64,
  );
});

test("generated browser presentation verifier matches Node receipt and wallet verification", async (t) => {
  const { browserModules } = await import("../web/modules.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import(
    "node:fs"
  );
  const { tmpdir } = await import("node:os");
  const { dirname } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { StrictTestDecoder } = await import("./web-image-test-support.mjs");
  const previous = globalThis.DecompressionStream;
  globalThis.DecompressionStream = StrictTestDecoder;
  const dir = mkdtempSync(join(tmpdir(), "zft-public-esm-"));
  try {
    for (const [url, source] of browserModules()) {
      const path = join(dir, url);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
    const portable = await import(
      pathToFileURL(join(dir, "web/presentation.mjs"))
    );
    const s = setup(t, true),
      wire = p.canonical(s.v);
    assert.deepEqual(
      await portable.verifyPresentation(
        wire,
        s.f.issuer.pinned.manifest,
        s.status,
        origin,
        1000,
      ),
      await s.check(),
    );
    const { BrowserClient } = await import(
      pathToFileURL(join(dir, "web/client.mjs"))
    );
    const { FORMAT } = await import(
      pathToFileURL(join(dir, "web/client-cipher.mjs"))
    );
    let writes = 0;
    const c = new BrowserClient(
      {
        format: FORMAT,
        client_id: "23".repeat(16),
        manifest: s.f.issuer.pinned.manifest,
        operations: {},
        credentials: { [s.id]: { wire: s.f.a.export(s.id), spent: false } },
      },
      "public fixture password",
      1,
      async () => {
        writes++;
        throw new Error("unexpected write");
      },
    );
    const now = Math.floor(Date.now() / 1000),
      context = { ...s.v.context, created_at: now, expires_at: now + 60 };
    const proof = await c.observation(s.id, context, s.status, origin, 1);
    assert.equal(
      p.verifyShowing(
        proof.showing,
        context.wallet,
        showingChallenge(context),
        context.h,
        s.f.a.pinned,
      ),
      s.id,
    );
    assert.deepEqual(Object.keys(proof).sort(), [
      "image",
      "image_sha256",
      "showing",
    ]);
    assert.equal(writes, 0);
    await assert.rejects(() =>
      c.observation(
        s.id,
        { ...context, h: "00".repeat(32) },
        s.status,
        origin,
        1,
      ),
    );
    await assert.rejects(() =>
      c.observation(
        s.id,
        { ...context, realm: "00".repeat(32) },
        s.status,
        origin,
        1,
      ),
    );
    const pending = c.observation(s.id, context, s.status, origin, 1);
    c.lock();
    await assert.rejects(() => pending, /locked/);
    const bad = { ...s.v, wallet_signature: signMessage("different") };
    await assert.rejects(() =>
      portable.verifyPresentation(
        p.canonical(bad),
        s.f.issuer.pinned.manifest,
        s.status,
        origin,
        1000,
      ),
    );
  } finally {
    globalThis.DecompressionStream = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
