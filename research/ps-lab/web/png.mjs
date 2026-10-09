// Browser port of the restricted local PNG container; exact image bytes preserved.
import assert, { concatBytes, hexToBytes } from "./runtime.mjs";
export const IMAGE_LIMIT = 65536;
export const PAYLOAD_LIMIT = 4096;
export const FILE_LIMIT = IMAGE_LIMIT + PAYLOAD_LIMIT + 12;
export const PIXEL_LIMIT = 262144;
export const CHUNK_LIMIT = 128;
export const BEARER_CHUNK = "zfPC";
const signature = hexToBytes("89504e470d0a1a0a");
const u32 = (b, offset) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(offset);
const put32 = (b, offset, n) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(offset, n);
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function chunk(type, data) {
  assert(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type), "PNG chunk name");
  assert(
    data instanceof Uint8Array && data.length <= FILE_LIMIT,
    "PNG chunk size",
  );
  const out = new Uint8Array(data.length + 12);
  put32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  put32(out, out.length - 4, crc32(out.subarray(4, -4)));
  return out;
}
export function pngChunks(input) {
  assert(
    input instanceof Uint8Array && input.length <= FILE_LIMIT,
    "PNG file size",
  );
  const file = new Uint8Array(input);
  assert(
    file.length >= 8 && signature.every((v, i) => file[i] === v),
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
    const size = u32(file, offset);
    assert(
      size <= FILE_LIMIT && size + 12 <= file.length - offset,
      "PNG chunk length",
    );
    const raw = file.subarray(offset, offset + size + 12);
    const type = String.fromCharCode(...raw.subarray(4, 8));
    assert(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type), "PNG chunk name");
    assert.equal(
      crc32(raw.subarray(4, -4)),
      u32(raw, raw.length - 4),
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
  const size = 8 + chunks.reduce((n, c) => n + c.raw.length, 0);
  assert(size <= FILE_LIMIT, "PNG assembled size");
  return concatBytes(signature, ...chunks.map((c) => c.raw));
}
async function inflate(input, expected) {
  // One input chunk avoids engine differences in how trailing input is split.
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(input);
      c.close();
    },
  }).pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader(),
    output = new Uint8Array(expected);
  let n = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      assert(
        value instanceof Uint8Array && n + value.length <= expected,
        "PNG inflation limit",
      );
      output.set(value, n);
      n += value.length;
    }
    assert.equal(n, expected, "PNG scanline length");
    return output;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
let decoderCheck;
export function requireStrictDecoder() {
  // Fail closed on engines which silently accept trailing zlib input (including
  // some Node versions). These probes are compatibility checks, not an audit.
  decoderCheck ??= (async () => {
    const valid = hexToBytes("789ccb48cdc9c90700062c0215"); // "hello"
    assert.equal(
      new TextDecoder().decode(await inflate(valid, 5)),
      "hello",
      "PNG decoder unavailable",
    );
    for (const invalid of [
      concatBytes(valid, new Uint8Array([0])),
      concatBytes(valid, valid),
      valid.slice(0, -1),
    ]) {
      let rejected = false;
      try {
        await inflate(invalid, 5);
      } catch {
        rejected = true;
      }
      assert(
        rejected,
        "PNG decoder must reject incomplete or trailing zlib input",
      );
    }
  })();
  return decoderCheck;
}
export async function inspectImage(input) {
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
  const width = u32(header, 0),
    height = u32(header, 4);
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
  await requireStrictDecoder();
  const compressed = concatBytes(...chunks.slice(1, -1).map((c) => c.data));
  const stride = width * 4 + 1,
    raw = await inflate(compressed, stride * height);
  for (let row = 0; row < height; row++)
    assert(raw[row * stride] <= 4, "PNG row filter");
  return { image: assemble(chunks), width, height };
}
