// Original, separately versioned research PNG envelope. Plaintext bearer authority.
import assert from "node:assert/strict";
import * as p from "./profile.mjs";
import {
  pngChunks,
  assemble,
  inspectImage,
  chunk,
  BEARER_CHUNK,
  PAYLOAD_LIMIT,
  CHUNK_LIMIT,
} from "./png.mjs";
export const FILE_PROTOCOL = "zft-ps-png-lab-v1";
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Input is an already verified local bearer envelope; preserve its exact asset bytes.
export function exportImage(envelope, manifest) {
  const value = p.importBearer(envelope, p.trust(manifest));
  const { image } = inspectImage(p.bytes(value.asset));
  const { asset, ...rest } = value;
  const payload = p.utf8(
    p.canonical({
      ...rest,
      file_protocol: FILE_PROTOCOL,
      image_sha256: p.hash(image),
    }),
  );
  assert(payload.length <= PAYLOAD_LIMIT, "PNG bearer payload size");
  const chunks = pngChunks(image);
  assert(chunks.length < CHUNK_LIMIT, "PNG export chunk count");
  return assemble([
    ...chunks.slice(0, -1),
    { raw: chunk(BEARER_CHUNK, payload) },
    chunks.at(-1),
  ]);
}

// No issuer URLs or trust choices come from the file. Verification is offline and
// says nothing about spent status; a stale but valid credential still imports.
export function importImage(file, manifest) {
  const chunks = pngChunks(file),
    envelopes = chunks.filter((c) => c.type === BEARER_CHUNK);
  assert.equal(envelopes.length, 1, "exactly one PS PNG envelope");
  assert.equal(chunks.at(-2), envelopes[0], "PS envelope must follow IDAT");
  assert(envelopes[0].data.length <= PAYLOAD_LIMIT, "PNG bearer payload size");
  const body = p.parse(decoder.decode(envelopes[0].data), PAYLOAD_LIMIT);
  p.fields(
    body,
    "file_protocol image_sha256 protocol realm keyset_id public_key type credential",
  );
  assert.equal(body.file_protocol, FILE_PROTOCOL, "PS PNG file protocol");
  const { image, width, height } = inspectImage(
    assemble(chunks.filter((c) => c.type !== BEARER_CHUNK)),
  );
  p.bytes(body.image_sha256, 32);
  assert.equal(p.hash(image), body.image_sha256, "PNG image digest");
  const { file_protocol, image_sha256, ...rest } = body;
  const envelope = p.canonical({ ...rest, asset: p.hex(image) });
  p.importBearer(envelope, p.trust(manifest));
  return { image, envelope, image_sha256, width, height };
}

// Returns only verified, envelope-free PNG bytes, never the credential or manifest.
// It removes metadata authority, not steganographic information in pixels/deflate.
export function publicImage(file, manifest) {
  return importImage(file, manifest).image;
}

// Validate before any journal write; existing acknowledgment/recovery rules apply.
export function prepareImageIssue(client, session, image) {
  return client.prepareIssue(session, inspectImage(image).image);
}
export function prepareImageClaim(client, session, file) {
  return client.prepareClaim(
    session,
    importImage(file, client.pinned.manifest).envelope,
  );
}
