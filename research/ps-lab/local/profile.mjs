// LOCAL RESEARCH ONLY. Versioned ZFT transcripts, not reference wire compatibility.
// BigInt/group secret operations here are not qualified for production side channels.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import {
  Q,
  G1,
  G2,
  GN,
  GA,
  bytes,
  hex,
  integer,
  frame,
  concat,
  encode,
  multiply as mul,
  scalar,
  point,
  parameters,
  keysetId,
  hashAsset,
  credential,
  dleq,
  linear,
} from "../verify.mjs";
export {
  bytes,
  hex,
  integer,
  encode,
  scalar,
  point,
  credential,
  parameters,
  G1,
  G2,
  GN,
  GA,
  Q,
  mul,
};
export const PROTOCOL = "zft-ps-local-v1";
export const MAX_ASSET = 65536;
export const utf8 = (s) => new TextEncoder().encode(s);
export const hash = (data) => createHash("sha256").update(data).digest("hex");
export const randomHex = (size) => randomBytes(size).toString("hex");
export const encodedPoint = (p) => hex(encode(p));
export const scalarHex = (n) => hex(integer(n));
export function randomScalar() {
  // Rejection sampling; no modular-reduction bias, no zero secrets or nonces.
  for (;;) {
    const n = BigInt("0x" + randomHex(32));
    if (n > 0n && n < Q) return n;
  }
}
export function canonical(v, depth = 0) {
  assert(depth < 8, "JSON depth");
  if (typeof v === "string" || typeof v === "boolean" || v === null)
    return JSON.stringify(v);
  if (typeof v === "number") {
    assert(
      Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0),
      "JSON integer",
    );
    return JSON.stringify(v);
  }
  assert(
    v && Object.getPrototypeOf(v) === Object.prototype,
    "plain JSON object",
  );
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(v[k], depth + 1))
      .join(",") +
    "}"
  );
}
export function parse(wire, limit = 12288) {
  assert(
    typeof wire === "string" && Buffer.byteLength(wire) <= limit,
    "wire size",
  );
  const v = JSON.parse(wire);
  assert.equal(
    canonical(v),
    wire,
    "canonical JSON; no duplicate keys or alternate encoding",
  );
  return v;
}
export function fields(v, names) {
  assert(v && Object.getPrototypeOf(v) === Object.prototype, "object");
  assert.deepEqual(
    Object.keys(v).sort(),
    names.split(" ").sort(),
    "exact fields",
  );
}
export function manifest(realm, secrets) {
  bytes(realm, 32);
  fields(secrets, "x yh ys");
  const [x, yh, ys] = ["x", "yh", "ys"].map((k) => scalar(secrets[k], true));
  const public_key = hex(
    concat(...[mul(G2, x), mul(G2, yh), mul(G2, ys), mul(G1, yh)].map(encode)),
  );
  return {
    protocol: PROTOCOL,
    realm,
    keyset_id: keysetId(public_key),
    public_key,
  };
}
export function trust(input) {
  // Only the caller's pinned configuration establishes trust; files never replace it.
  const m = parse(canonical(input));
  fields(m, "protocol realm keyset_id public_key");
  assert.equal(m.protocol, PROTOCOL, "protocol");
  bytes(m.realm, 32);
  return { manifest: Object.freeze(m), pk: parameters(m) };
}
export function scope(v, pinned) {
  for (const name of ["protocol", "realm", "keyset_id"])
    assert.equal(v[name], pinned.manifest[name], "pinned " + name);
}
export function assetValue(asset, pinned) {
  assert(
    asset instanceof Uint8Array &&
      asset.length > 0 &&
      asset.length <= MAX_ASSET,
    "asset size",
  );
  const { protocol, realm, keyset_id } = pinned.manifest;
  // The credential attribute itself binds the realm, not only its presentation.
  const context = utf8(canonical({ protocol, realm, keyset_id }));
  return scalarHex(
    challenge(
      concat(utf8("ZFT_PS_Local_v1/asset"), frame(context), hashAsset(asset)),
    ),
  );
}
export function session(input, pinned) {
  fields(input, "protocol realm keyset_id kind session expires u");
  scope(input, pinned);
  assert(["issue", "swap"].includes(input.kind), "session purpose");
  bytes(input.session, 16);
  point(input.u);
  assert(
    Number.isSafeInteger(input.expires) && input.expires > 0,
    "session expiry",
  );
  return input;
}
export function header(s, recoveryHash) {
  return { ...s, recovery_hash: recoveryHash };
}
const challenge = (b) => BigInt("0x" + hash(b)) % Q;
export function proveDleq(bases, statements, witness, domain, context) {
  const r = randomScalar();
  const c = challenge(
    concat(
      utf8(domain),
      frame(context),
      ...[...bases, ...statements, ...bases.map((b) => mul(b, r))].map((p) =>
        frame(encode(p)),
      ),
    ),
  );
  return hex(concat(integer(c), integer((r + c * witness) % Q)));
}
export function proveLinear(equations, witnesses, domain, context) {
  const nonces = witnesses.map(() => randomScalar());
  const parts = [utf8(domain), frame(context)];
  for (const [statement, terms] of equations) {
    const commitment = terms
      .map(([b, i]) => mul(b, nonces[i]))
      .reduce((a, b) => a.add(b));
    parts.push(frame(encode(statement)), frame(encode(commitment)));
    for (const [base, i] of terms)
      parts.push(frame(encode(base)), integer(BigInt(i), 2));
  }
  const c = challenge(concat(...parts));
  return hex(
    concat(
      integer(c),
      ...witnesses.map((w, i) => integer((nonces[i] + c * w) % Q)),
    ),
  );
}
const LABEL = "ZFT_PS_Local_v1/";
export function requestContext(r) {
  const core = { ...r };
  delete core.proof;
  delete core.owner_proof;
  if (r.kind === "swap") core.presentation = r.presentation.slice(0, 642); // six public fields, no source proof
  return utf8(canonical(core));
}
function issueEquations(r, pk) {
  return [
    [point(r.asset_tag, 1, true), [[GA, 0]]],
    [point(r.b, 1, true), [[pk.Yh1, 0]]],
    [point(r.s), [[G1, 1]]],
  ];
}
function swapEquations(r, pk) {
  return [
    [
      point(r.presentation.slice(258, 450), 2),
      [
        [pk.Yh2, 0],
        [G2, 1],
      ],
    ],
    [
      point(r.b),
      [
        [point(r.u), 0],
        [G1, 2],
      ],
    ],
  ];
}
export function prepareIssue(s, h, secret, capability, pinned) {
  session(s, pinned);
  assert.equal(s.kind, "issue");
  const H = scalar(h),
    S = scalar(secret, true);
  const r = {
    ...header(s, hash(bytes(capability, 32))),
    asset_tag: encodedPoint(mul(GA, H)),
    b: encodedPoint(mul(pinned.pk.Yh1, H)),
    s: encodedPoint(mul(G1, S)),
  };
  return canonical({
    ...r,
    proof: proveLinear(
      issueEquations(r, pinned.pk),
      [H, S],
      LABEL + "issue",
      requestContext(r),
    ),
  });
}
function present(c) {
  const rho = randomScalar();
  const U = mul(c.u, rho);
  return [U, mul(c.v, rho), mul(U, c.s), mul(GN, c.s)];
}
export function prepareSwap(s, old, secret, tHex, capability, pinned) {
  session(s, pinned);
  assert.equal(s.kind, "swap");
  const c = credential(old, pinned.pk),
    nextS = scalar(secret, true),
    t = scalar(tHex, true),
    o = randomScalar();
  const [U, V, T, N] = present(c),
    K = mul(pinned.pk.Yh2, c.h).add(mul(G2, o));
  const r = {
    ...header(s, hash(bytes(capability, 32))),
    s: encodedPoint(mul(G1, nextS)),
    b: encodedPoint(mul(point(s.u), c.h).add(mul(G1, t))),
    presentation:
      pinned.pk.id + [U, V.add(mul(U, o)), K, T, N].map(encodedPoint).join(""),
  };
  const context = requestContext(r);
  const oldProof = proveDleq([GN, U], [N, T], c.s, LABEL + "spend", context);
  const owner_proof = proveDleq(
    [G1],
    [point(r.s)],
    nextS,
    LABEL + "destination",
    context,
  );
  const proof = proveLinear(
    swapEquations(r, pinned.pk),
    [c.h, o, t],
    LABEL + "asset-equality",
    context,
  );
  return canonical({
    ...r,
    presentation: r.presentation + oldProof,
    owner_proof,
    proof,
  });
}
function pairing(left, right) {
  const product = bls.pairingBatch([
    ...left.map(([g1, g2]) => ({ g1, g2 })),
    ...right.map(([g1, g2]) => ({ g1: g1.negate(), g2 })),
  ]);
  assert(
    bls.fields.Fp12.eql(product, bls.fields.Fp12.ONE),
    "presentation pairing",
  );
}
export function request(wire, pinned) {
  const r = parse(wire);
  const common =
    "protocol realm keyset_id kind session expires u recovery_hash b s proof";
  assert(["issue", "swap"].includes(r.kind), "request purpose");
  fields(
    r,
    common + (r.kind === "issue" ? " asset_tag" : " presentation owner_proof"),
  );
  const s = Object.fromEntries(
    "protocol realm keyset_id kind session expires u"
      .split(" ")
      .map((k) => [k, r[k]]),
  );
  session(s, pinned);
  bytes(r.recovery_hash, 32);
  point(r.s);
  const context = requestContext(r);
  if (r.kind === "issue") {
    linear(issueEquations(r, pinned.pk), r.proof, 2, LABEL + "issue", context);
    return { r, nullifier: null };
  }
  bytes(r.presentation, 385);
  assert.equal(r.presentation.slice(0, 66), pinned.pk.id, "source keyset");
  const U = point(r.presentation.slice(66, 162)),
    V = point(r.presentation.slice(162, 258));
  const K = point(r.presentation.slice(258, 450), 2),
    T = point(r.presentation.slice(450, 546)),
    N = point(r.presentation.slice(546, 642));
  dleq([G1], [point(r.s)], r.owner_proof, LABEL + "destination", context);
  dleq([GN, U], [N, T], r.presentation.slice(642), LABEL + "spend", context);
  linear(
    swapEquations(r, pinned.pk),
    r.proof,
    3,
    LABEL + "asset-equality",
    context,
  );
  pairing(
    [[V, G2]],
    [
      [U, pinned.pk.X2.add(K)],
      [T, pinned.pk.Ys2],
    ],
  );
  return { r, nullifier: encodedPoint(N) };
}
export function issueResponse(r, digest, kHex, secrets) {
  const k = scalar(kHex, true),
    x = scalar(secrets.x, true),
    yh = scalar(secrets.yh, true),
    ys = scalar(secrets.ys, true);
  assert.equal(encodedPoint(mul(G1, k)), r.u, "session signing base");
  const v =
    r.kind === "issue"
      ? mul(
          mul(G1, x)
            .add(point(r.b, 1, true))
            .add(mul(point(r.s), ys)),
          k,
        )
      : mul(point(r.u), x)
          .add(mul(point(r.b), yh))
          .add(mul(point(r.s), (k * ys) % Q));
  point(encodedPoint(v));
  return canonical({
    protocol: r.protocol,
    realm: r.realm,
    keyset_id: r.keyset_id,
    digest,
    u: r.u,
    v: encodedPoint(v),
  });
}
export function finish(response, pending, pinned) {
  const v = parse(response),
    r = parse(pending.wire);
  fields(v, "protocol realm keyset_id digest u v");
  scope(v, pinned);
  assert.equal(v.digest, hash(pending.wire), "response digest");
  assert.equal(v.u, r.u, "response base");
  let V = point(v.v);
  if (r.kind === "swap")
    V = V.subtract(mul(pinned.pk.Yh1, scalar(pending.t, true)));
  const c = {
    keyset_id: pinned.pk.id,
    u: v.u,
    v: encodedPoint(V),
    h: pending.h,
    s: pending.secret,
  };
  credential(c, pinned.pk);
  return c;
}
export function bearer(asset, c, pinned) {
  assert.equal(assetValue(asset, pinned), c.h, "asset binding");
  credential(c, pinned.pk);
  return canonical({
    ...pinned.manifest,
    type: "bearer",
    asset: hex(asset),
    credential: c,
  });
}
export function importBearer(wire, pinned) {
  const v = parse(wire, 140000);
  fields(v, "protocol realm keyset_id public_key type asset credential");
  scope(v, pinned);
  assert.equal(v.public_key, pinned.manifest.public_key, "pinned parameters");
  assert.equal(v.type, "bearer");
  fields(v.credential, "keyset_id u v h s");
  assert.equal(
    assetValue(bytes(v.asset), pinned),
    v.credential.h,
    "asset binding",
  );
  credential(v.credential, pinned.pk);
  return v;
}
export function showing(c, wallet, nonce, pinned) {
  bytes(wallet, 20);
  bytes(nonce, 32);
  const value = credential(c, pinned.pk),
    [U, V, T, N] = present(value);
  const r = {
    protocol: PROTOCOL,
    realm: pinned.manifest.realm,
    keyset_id: pinned.pk.id,
    purpose: "show",
    wallet,
    nonce,
    h: c.h,
    u: encodedPoint(U),
    v: encodedPoint(V),
    t: encodedPoint(T),
    n: encodedPoint(N),
  };
  return canonical({
    ...r,
    proof: proveDleq(
      [GN, U],
      [N, T],
      value.s,
      LABEL + "show",
      utf8(canonical(r)),
    ),
  });
}
export function verifyShowing(wire, wallet, nonce, expectedH, pinned) {
  const r = parse(wire);
  fields(r, "protocol realm keyset_id purpose wallet nonce h u v t n proof");
  scope(r, pinned);
  bytes(wallet, 20);
  bytes(nonce, 32);
  scalar(expectedH);
  assert.equal(r.purpose, "show");
  assert.equal(r.wallet, wallet, "wallet context");
  assert.equal(r.nonce, nonce, "show challenge");
  assert.equal(r.h, expectedH, "show asset");
  const { proof, ...core } = r,
    U = point(r.u),
    V = point(r.v),
    T = point(r.t),
    N = point(r.n);
  dleq([GN, U], [N, T], proof, LABEL + "show", utf8(canonical(core)));
  pairing(
    [[V, G2]],
    [
      [U, pinned.pk.X2.add(mul(pinned.pk.Yh2, scalar(r.h)))],
      [T, pinned.pk.Ys2],
    ],
  );
  return r.n; // Does NOT authenticate the wallet or establish unspent state.
}
