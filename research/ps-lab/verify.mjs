// RESEARCH ONLY: original verifier of public fixtures, not an app SDK or issuer.
import assert from "node:assert/strict";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const Q = bls.fields.Fr.ORDER;
export const G1 = bls.G1.Point.BASE;
export const G2 = bls.G2.Point.BASE;
const utf8 = (s) => new TextEncoder().encode(s);
export const hex = (bytes) => Buffer.from(bytes).toString("hex");
export const concat = (...parts) => new Uint8Array(Buffer.concat(parts));
export function bytes(value, length) {
  assert.equal(typeof value, "string");
  assert.match(value, /^(?:[0-9a-f]{2})*$/);
  const result = new Uint8Array(Buffer.from(value, "hex"));
  if (length !== undefined)
    assert.equal(result.length, length, "exact byte length");
  return result;
}
export function integer(n, size = 32) {
  assert(n >= 0n && n < 1n << BigInt(size * 8), "integer range");
  return bytes(n.toString(16).padStart(size * 2, "0"), size);
}
export function frame(value, size = 2) {
  return concat(integer(BigInt(value.length), size), value);
}
const number = (b) => BigInt(`0x${hex(b)}`);
const challenge = (b) => number(sha256(b)) % Q;
export const encode = (p) => p.toBytes(true);
export const multiply = (p, n) => p.multiplyUnsafe(n);
export function scalar(value, nonzero = false) {
  const n = number(bytes(value, 32));
  assert(n < Q && (!nonzero || n !== 0n), "canonical scalar");
  return n;
}
export function point(value, group = 1, allowIdentity = false) {
  assert(group === 1 || group === 2, "known group");
  const b = bytes(value, group === 1 ? 48 : 96);
  const C = group === 1 ? bls.G1.Point : bls.G2.Point;
  const p = C.fromBytes(b);
  p.assertValidity();
  assert(allowIdentity || !p.equals(C.ZERO), "nonidentity point");
  assert.equal(hex(encode(p)), value, "canonical compressed point");
  return p;
}
export const GN = bls.G1.hashToCurve(utf8("ps_nullifier_base"), {
  DST: "CASHU_PS_GNULL_XMD:SHA-256_SSWU_RO_",
});
export const GA = bls.G1.hashToCurve(utf8("ps_asset_tag_base"), {
  DST: "CASHU_PS_ASSET_TAG_XMD:SHA-256_SSWU_RO_",
});
export function hashAsset(asset) {
  return integer(challenge(concat(utf8("Cashu_PS_Asset_v1"), frame(asset, 4))));
}
export function keysetId(pk) {
  const p = bytes(pk, 336);
  return hex(
    concat(
      new Uint8Array([3]),
      sha256(
        concat(
          ...[
            p.slice(0, 96),
            p.slice(96, 192),
            p.slice(192, 288),
            p.slice(288),
          ].map((part) => frame(part, 4)),
          frame(utf8("psnft"), 4),
        ),
      ),
    ),
  );
}
function pairingEqual(left, right) {
  const product = bls.pairingBatch([
    ...left.map(([g1, g2]) => ({ g1, g2 })),
    ...right.map(([g1, g2]) => ({ g1: g1.negate(), g2 })),
  ]);
  assert(
    bls.fields.Fp12.eql(product, bls.fields.Fp12.ONE),
    "PS pairing equation",
  );
}
export function parameters(input) {
  assert.equal(keysetId(input.public_key), input.keyset_id, "keyset digest");
  const p = bytes(input.public_key, 336);
  const X2 = point(hex(p.slice(0, 96)), 2);
  const Yh2 = point(hex(p.slice(96, 192)), 2);
  const Ys2 = point(hex(p.slice(192, 288)), 2);
  const Yh1 = point(hex(p.slice(288)));
  // Additional lab policy; this cross-group check was not seen in reference g_().
  pairingEqual([[Yh1, G2]], [[G1, Yh2]]);
  return { X2, Yh2, Ys2, Yh1, id: input.keyset_id };
}
export function credential(input, pk) {
  assert.equal(input.keyset_id, pk.id, "trusted keyset");
  const h = scalar(input.h),
    s = scalar(input.s, true);
  const u = point(input.u),
    v = point(input.v);
  pairingEqual(
    [[v, G2]],
    [[u, pk.X2.add(multiply(pk.Yh2, h)).add(multiply(pk.Ys2, s))]],
  );
  return { u, v, h, s };
}
function responses(proof, count) {
  const b = bytes(proof, 32 * (count + 1));
  return Array.from({ length: count + 1 }, (_, i) =>
    scalar(hex(b.slice(32 * i, 32 * (i + 1)))),
  );
}
export function dleq(
  bases,
  statements,
  proof,
  domain,
  context = new Uint8Array(),
) {
  assert.equal(bases.length, statements.length);
  assert(bases.length > 0);
  const [c, z] = responses(proof, 1);
  const commitments = bases.map((base, i) =>
    multiply(base, z).subtract(multiply(statements[i], c)),
  );
  const transcript = concat(
    utf8(domain),
    frame(context),
    ...[...bases, ...statements, ...commitments].map((p) => frame(encode(p))),
  );
  assert.equal(challenge(transcript), c, "DLEQ challenge");
  return hex(transcript);
}
export function linear(equations, proof, count, domain, context) {
  const [c, ...z] = responses(proof, count);
  const parts = [utf8(domain), frame(context)];
  for (const [statement, terms] of equations) {
    assert(terms.length > 0);
    const products = terms.map(([base, i]) => {
      assert(Number.isInteger(i) && i >= 0 && i < count, "witness index");
      return multiply(base, z[i]);
    });
    const commitment = products
      .reduce((a, b) => a.add(b))
      .subtract(multiply(statement, c));
    parts.push(frame(encode(statement)), frame(encode(commitment)));
    for (const [base, i] of terms)
      parts.push(frame(encode(base)), integer(BigInt(i), 2));
  }
  const transcript = concat(...parts);
  assert.equal(challenge(transcript), c, "linear challenge");
  return hex(transcript);
}
export function issue(request, pk) {
  assert.equal(request.version, 3, "committed issuance version");
  const context = concat(bytes(pk.id, 33), bytes(request.session, 16));
  return linear(
    [
      [point(request.asset_tag, 1, true), [[GA, 0]]],
      [point(request.b, 1, true), [[pk.Yh1, 0]]],
      [point(request.owner_commitment), [[G1, 1]]],
    ],
    request.proof,
    2,
    "Cashu_PS_CommittedIssue_v3",
    context,
  );
}
export function decodeToken(token) {
  assert.equal(typeof token, "string");
  assert.match(token, /^psnft1[0-9a-f]{386}$/);
  const raw = token.slice(6);
  const value = {
    keyset_id: raw.slice(0, 66),
    u: raw.slice(66, 162),
    v: raw.slice(162, 258),
    h: raw.slice(258, 322),
    s: raw.slice(322),
  };
  point(value.u);
  point(value.v);
  scalar(value.h);
  scalar(value.s, true);
  // Syntactic decode alone does NOT establish issuer signature or spendability.
  return value;
}
export function showing(encoded, expectedProfile, expectedH, pk) {
  assert.equal(encoded.slice(0, 6), "pshow1");
  bytes(expectedProfile, 32);
  scalar(expectedH);
  const raw = bytes(encoded.slice(6));
  assert(raw.length >= 2, "showing prefix");
  const length = raw[0] * 256 + raw[1];
  assert.equal(raw.length, 2 + length + 321, "showing length");
  const context = raw.slice(2, 2 + length),
    p = raw.slice(2 + length);
  assert.equal(
    hex(context),
    hex(
      utf8(
        `Cashu_NFT_Portfolio_Show_v1\n${expectedProfile}\n${expectedH}\n${pk.id}`,
      ),
    ),
    "showing context",
  );
  assert.equal(hex(p.slice(0, 33)), pk.id, "trusted showing keyset");
  assert.equal(hex(p.slice(33, 65)), expectedH, "showing asset");
  const [U, V, T, N] = [65, 113, 161, 209].map((i) =>
    point(hex(p.slice(i, i + 48))),
  );
  const transcript = dleq(
    [GN, U],
    [N, T],
    hex(p.slice(257)),
    "Cashu_PS_Present_v1",
    concat(utf8("Cashu_PS_Showing_v1"), frame(context)),
  );
  pairingEqual(
    [[V, G2]],
    [
      [U, pk.X2.add(multiply(pk.Yh2, scalar(expectedH)))],
      [T, pk.Ys2],
    ],
  );
  // No wallet endorsement or registry state is checked in this reference-core lab.
  return { transcript, nullifier: hex(encode(N)) };
}
export function transfer(request, pk) {
  const p = bytes(request.presentation, 385);
  assert.equal(hex(p.slice(0, 33)), pk.id, "transfer keyset");
  const U = point(hex(p.slice(33, 81))),
    V = point(hex(p.slice(81, 129)));
  const K = point(hex(p.slice(129, 225)), 2),
    T = point(hex(p.slice(225, 273))),
    N = point(hex(p.slice(273, 321)));
  const S = point(request.new_owner_commitment),
    nextU = point(request.session_u),
    B = point(request.b);
  const ownerTranscript = dleq(
    [G1],
    [S],
    request.new_proof,
    "Cashu_PS_Issue_v1",
  );
  const presentationTranscript = dleq(
    [GN, U],
    [N, T],
    hex(p.slice(321)),
    "Cashu_PS_Present_v1",
    encode(S),
  );
  const transcript = linear(
    [
      [
        K,
        [
          [pk.Yh2, 0],
          [G2, 1],
        ],
      ],
      [
        B,
        [
          [nextU, 0],
          [G1, 2],
        ],
      ],
    ],
    request.proof,
    3,
    "Cashu_PS_CommitEq_v1",
    encode(S),
  );
  pairingEqual(
    [[V, G2]],
    [
      [U, pk.X2.add(K)],
      [T, pk.Ys2],
    ],
  );
  return {
    transcript,
    ownerTranscript,
    presentationTranscript,
    nullifier: hex(encode(N)),
  };
}
export function unblind(response, expectedU, expectedKeyset, t, pk) {
  assert.equal(response.keyset_id, expectedKeyset, "response keyset");
  assert.equal(response.u, expectedU, "response session base");
  assert.equal(pk.id, expectedKeyset, "trusted response keyset");
  point(expectedU);
  return hex(
    encode(point(response.v).subtract(multiply(pk.Yh1, scalar(t, true)))),
  );
}
