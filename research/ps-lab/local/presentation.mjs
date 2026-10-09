// Original local public-evidence composition. Separate from spend authority.
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as p from "./profile.mjs";
import { stateManifest, showingChallenge, STATE_TTL } from "./state.mjs";
import { inspectImage } from "./png.mjs";
export const PRESENTATION = "zft-ps-presentation-lab-v1";
export const PRESENTATION_LIMIT = 150000;
const CONTEXT =
  "protocol realm keyset_id ps_manifest_hash status_key_id purpose audience challenge wallet h created_at expires_at min_sequence";
const FIELDS =
  "format origin chain_id context showing receipt image image_sha256 wallet_signature";
function integer(x) {
  assert(
    Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0),
    "presentation integer",
  );
  return x;
}
export function presentationOrigin(value) {
  assert(typeof value === "string" && value.length <= 256, "origin size");
  const u = new URL(value);
  assert.equal(u.origin, value, "canonical origin");
  assert(
    u.protocol === "https:" ||
      (u.protocol === "http:" && u.hostname === "127.0.0.1" && u.port),
    "secure or loopback origin",
  );
  return value;
}
export function presentationAudience(origin, chainId) {
  presentationOrigin(origin);
  integer(chainId);
  assert(chainId <= 0xffffffff, "chain bound");
  return p.hash(
    PRESENTATION + "/audience\0" + p.canonical({ origin, chain_id: chainId }),
  );
}
function unsigned(value) {
  p.fields(value, FIELDS);
  const { wallet_signature, ...body } = value;
  return body;
}
export function endorsementMessage(value) {
  const body = unsigned(value),
    c = value.context;
  return [
    "ZFT PS public artwork evidence",
    "This signs a public presentation. It does not transfer a credential or authorize spending.",
    "Format: " + value.format,
    "Origin: " + value.origin,
    "Chain ID: " + value.chain_id,
    "Wallet: 0x" + c.wallet,
    "Issuer realm: " + c.realm,
    "Artwork SHA-256: " + value.image_sha256,
    "Challenge: " + c.challenge,
    "Expires at (Unix seconds): " + c.expires_at,
    "Evidence SHA-256: " + p.hash(p.canonical(body)),
  ].join("\n");
}
// Strict 65-byte low-S recoverable ERC-191 signing-key proof. No ERC-1271 RPC.
export function verifyEndorsement(message, signature, address) {
  p.bytes(address, 20);
  assert(
    typeof signature === "string" && /^0x[0-9a-f]{130}$/.test(signature),
    "wallet signature encoding",
  );
  const raw = p.bytes(signature.slice(2), 65),
    recovery = raw[64] - 27;
  assert(recovery === 0 || recovery === 1, "wallet recovery bit");
  const sig = secp256k1.Signature.fromBytes(raw.slice(0, 64), "compact");
  assert(!sig.hasHighS(), "wallet high-S");
  const text = p.utf8(message),
    prefix = p.utf8("\x19Ethereum Signed Message:\n" + text.length);
  const joined = new Uint8Array(prefix.length + text.length);
  joined.set(prefix);
  joined.set(text, prefix.length);
  const digest = keccak_256(joined),
    key = sig.addRecoveryBit(recovery).recoverPublicKey(digest).toBytes(false);
  assert.equal(
    p.hex(keccak_256(key.slice(1)).slice(-20)),
    address,
    "wallet signing key",
  );
  return true;
}
export function presentationContext(
  c,
  psManifest,
  statusManifest,
  expectedOrigin,
  chainId,
) {
  const ps = p.trust(psManifest),
    status = stateManifest(psManifest, statusManifest.public_key);
  assert.equal(
    p.canonical(statusManifest),
    p.canonical(status),
    "state manifest pin",
  );
  p.fields(c, CONTEXT);
  for (const k of [
    "protocol",
    "realm",
    "keyset_id",
    "ps_manifest_hash",
    "status_key_id",
  ])
    assert.equal(c[k], status[k], "presentation scope: " + k);
  assert.equal(c.purpose, "credential-state", "presentation purpose");
  assert.equal(
    c.audience,
    presentationAudience(expectedOrigin, chainId),
    "presentation audience",
  );
  p.bytes(c.challenge, 32);
  p.bytes(c.wallet, 20);
  p.scalar(c.h);
  integer(c.created_at);
  integer(c.expires_at);
  integer(c.min_sequence);
  assert.equal(c.expires_at - c.created_at, STATE_TTL, "presentation lifetime");
  return { ps, status };
}

// Trust always comes from the caller. An imported/public record cannot choose it.
export async function verifyObservation(
  wire,
  psManifest,
  statusManifest,
  expectedOrigin,
  now,
  { requireFresh = false } = {},
) {
  integer(now);
  presentationOrigin(expectedOrigin);
  const v = p.parse(wire, PRESENTATION_LIMIT);
  unsigned(v);
  assert.equal(v.format, PRESENTATION, "presentation format");
  assert.equal(v.origin, expectedOrigin, "presentation origin");
  const c = v.context;
  const { ps, status } = presentationContext(
    c,
    psManifest,
    statusManifest,
    expectedOrigin,
    v.chain_id,
  );
  const image = await inspectImage(p.bytes(v.image));
  p.bytes(v.image_sha256, 32);
  assert.equal(
    p.hash(image.image),
    v.image_sha256,
    "presentation image digest",
  );
  assert.equal(p.assetValue(image.image, ps), c.h, "presentation signed asset");
  const nullifier = p.verifyShowing(
    v.showing,
    c.wallet,
    showingChallenge(c),
    c.h,
    ps,
  );
  const r = p.parse(v.receipt, 8192);
  p.fields(r, "body signature");
  p.fields(
    r.body,
    CONTEXT + " request_hash showing_hash nullifier state sequence observed_at",
  );
  p.bytes(r.signature, 64);
  assert(
    ed25519.verify(
      p.bytes(r.signature),
      p.utf8("ZFT_PS_Local_State_v1/receipt\0" + p.canonical(r.body)),
      p.bytes(status.public_key),
      { zip215: false },
    ),
    "presentation status signature",
  );
  for (const k of Object.keys(c))
    assert.equal(r.body[k], c[k], "presentation receipt context: " + k);
  assert.equal(
    r.body.request_hash,
    p.hash(p.canonical({ ...c, showing: v.showing })),
    "presentation request digest",
  );
  assert.equal(
    r.body.showing_hash,
    p.hash(v.showing),
    "presentation showing digest",
  );
  assert.equal(r.body.nullifier, nullifier, "presentation nullifier");
  assert(["spent", "unspent"].includes(r.body.state), "presentation status");
  integer(r.body.sequence);
  integer(r.body.observed_at);
  assert(r.body.sequence >= c.min_sequence, "presentation sequence");
  assert(
    r.body.observed_at >= c.created_at &&
      r.body.observed_at < c.expires_at &&
      r.body.observed_at <= now,
    "presentation observation time",
  );
  const inInterval = now >= c.created_at && now < c.expires_at;
  if (requireFresh) assert(inInterval, "presentation expired");
  return {
    credentialValid: true,
    contractWalletChecked: false,
    issuerReported: r.body.state,
    observedAt: r.body.observed_at,
    expiresAt: c.expires_at,
    withinObservationInterval: inInterval,
    sequence: r.body.sequence,
    imageSha256: v.image_sha256,
    width: image.width,
    height: image.height,
  };
}

export async function verifyPresentation(
  wire,
  psManifest,
  statusManifest,
  expectedOrigin,
  now,
  options = {},
) {
  const report = await verifyObservation(
    wire,
    psManifest,
    statusManifest,
    expectedOrigin,
    now,
    options,
  );
  const v = p.parse(wire, PRESENTATION_LIMIT),
    c = v.context;
  let walletSigningKeyValid = false;
  if (v.wallet_signature === null) {
    assert.equal(c.wallet, "00".repeat(20), "unsigned wallet context");
    assert.equal(v.chain_id, 0, "anonymous chain context");
  } else {
    assert(v.chain_id > 0, "wallet chain context");
    walletSigningKeyValid = verifyEndorsement(
      endorsementMessage(v),
      v.wallet_signature,
      c.wallet,
    );
  }
  return { ...report, walletSigningKeyValid };
}
