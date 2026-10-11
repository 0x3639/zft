// This new format reuses pixel normalization without changing or importing v1 authority.
// Node callers use --import tsx for the existing TypeScript pixel codec.
import {
  normalizeImage,
  validatePublicImage,
  pngChunks,
  chunk,
  concat,
} from "../../packages/file-codec/index.ts";
import {
  canonical,
  parseCanonical,
  digest,
  utf8ToBytes,
  check,
} from "./core.mjs";
const MAGIC = "zsHA",
  PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const decoder = new TextDecoder("utf-8", { fatal: true });
export { normalizeImage };
async function verifyImage(image, note) {
  const size = await validatePublicImage(image);
  check(
    digest(image) === note.imageHash &&
      note.metadata.imageHash === note.imageHash,
    "Image digest mismatch",
  );
  check(
    size.width === note.metadata.width && size.height === note.metadata.height,
    "Image dimensions mismatch",
  );
  const normalized = await normalizeImage(image);
  check(digest(normalized.bytes) === note.imageHash, "Image is not canonical");
}
export async function exportBearer(profile, image, note) {
  profile.validate(note, note.deployment);
  await verifyImage(image, note);
  const payload = utf8ToBytes(canonical(note));
  check(payload.length <= 16384, "Note too large");
  const parts = pngChunks(image);
  return concat(
    PNG,
    ...parts.slice(0, -1).map((c) => c.raw),
    chunk(MAGIC, payload),
    parts.at(-1).raw,
  );
}
export async function importBearer(profile, bytes, deployment) {
  const parts = pngChunks(bytes),
    envelopes = parts.filter((c) => c.type === MAGIC);
  check(
    envelopes.length === 1 && parts.at(-2).type === MAGIC,
    "Expected one shielded envelope before IEND",
  );
  check(
    parts.every((c) => ["IHDR", "IDAT", "IEND", MAGIC].includes(c.type)),
    "Unexpected image/envelope format",
  );
  const note = profile.validate(
    parseCanonical(decoder.decode(envelopes[0].data)),
    deployment,
  );
  const image = concat(
    PNG,
    ...parts.filter((c) => c.type !== MAGIC).map((c) => c.raw),
  );
  await verifyImage(image, note);
  return { image, note };
}
export async function publicImage(profile, bytes, deployment) {
  return (await importBearer(profile, bytes, deployment)).image;
}
