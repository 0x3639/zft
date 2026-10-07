// Restricted PNG container for the local PS lab, not a general image normalizer.
import assert from "node:assert/strict";
import { inflateSync, crc32 } from "node:zlib";
export const IMAGE_LIMIT = 65536;
export const PAYLOAD_LIMIT = 4096;
export const FILE_LIMIT = IMAGE_LIMIT + PAYLOAD_LIMIT + 12;
export const PIXEL_LIMIT = 262144;
export const CHUNK_LIMIT = 128;
export const BEARER_CHUNK = "zfPC"; // Ancillary, private, reserved-bit clear, unsafe to copy.
const signature = Buffer.from("89504e470d0a1a0a", "hex");
export function chunk(type, data) {
  assert(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type), "PNG chunk name");
  assert(
    data instanceof Uint8Array && data.length <= FILE_LIMIT,
    "PNG chunk size",
  );
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(type, 4, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}
// Bounded reads and CRC checks precede allocation/inflation or credential parsing.
export function pngChunks(input) {
  assert(
    input instanceof Uint8Array && input.length <= FILE_LIMIT,
    "PNG file size",
  );
  const file = Buffer.from(input); // Own copy; preserve caller's file and byte offsets.
  assert(
    file.length >= 8 && file.subarray(0, 8).equals(signature),
    "PNG signature",
  );
  const chunks = [];
  let offset = 8,
    ended = false;
  while (offset < file.length) {
    assert(
      !ended && offset + 12 <= file.length,
      "PNG trailing or truncated bytes",
    );
    const size = file.readUInt32BE(offset);
    assert(
      size <= FILE_LIMIT && size + 12 <= file.length - offset,
      "PNG chunk length",
    );
    const raw = file.subarray(offset, offset + size + 12);
    const type = raw.subarray(4, 8).toString("latin1");
    assert(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type), "PNG chunk name");
    assert.equal(
      crc32(raw.subarray(4, -4)),
      raw.readUInt32BE(raw.length - 4),
      "PNG CRC",
    );
    chunks.push({ type, data: raw.subarray(8, -4), raw });
    assert(chunks.length <= CHUNK_LIMIT, "PNG chunk count");
    ended = type === "IEND";
    offset += size + 12;
  }
  assert(
    ended && chunks[0]?.type === "IHDR" && chunks.at(-1).data.length === 0,
    "PNG structure",
  );
  assert.equal(
    chunks.filter((c) => c.type === "IHDR").length,
    1,
    "PNG header count",
  );
  return chunks;
}
export function assemble(chunks) {
  return Buffer.concat([signature, ...chunks.map((c) => c.raw)]);
}
// This subset matches the shape of small zft-png/1 outputs; it does not certify
// that an arbitrary input was produced by the pinned normalizer.
export function inspectImage(input) {
  assert(
    input instanceof Uint8Array && input.length <= IMAGE_LIMIT,
    "PNG image size",
  );
  const chunks = pngChunks(input);
  assert(chunks.length < CHUNK_LIMIT, "PNG image chunk count");
  assert(
    chunks.every((c) => ["IHDR", "IDAT", "IEND"].includes(c.type)),
    "PNG public chunks only",
  );
  assert(
    chunks.length >= 3 && chunks.slice(1, -1).every((c) => c.type === "IDAT"),
    "PNG IDAT ordering",
  );
  const header = chunks[0].data;
  assert.equal(header.length, 13, "PNG header length");
  const width = header.readUInt32BE(0),
    height = header.readUInt32BE(4);
  assert(
    width > 0 && height > 0 && width * height <= PIXEL_LIMIT,
    "PNG pixel limit",
  );
  assert(
    header[8] === 8 &&
      header[9] === 6 &&
      header[10] === 0 &&
      header[11] === 0 &&
      header[12] === 0,
    "PNG RGBA8 noninterlaced required",
  );
  const compressed = Buffer.concat(chunks.slice(1, -1).map((c) => c.data));
  const stride = width * 4 + 1,
    expected = stride * height;
  const inflated = inflateSync(compressed, {
    info: true,
    maxOutputLength: expected,
  });
  assert.equal(
    inflated.engine.bytesWritten,
    compressed.length,
    "PNG zlib trailing bytes",
  );
  assert.equal(inflated.buffer.length, expected, "PNG scanline length");
  for (let row = 0; row < height; row++)
    assert(inflated.buffer[row * stride] <= 4, "PNG row filter");
  return { image: assemble(chunks), width, height };
}
