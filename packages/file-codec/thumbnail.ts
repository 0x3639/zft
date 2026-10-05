import { encode } from "fast-png";
import { concat, pngChunks, MAX_IMAGE } from "./index";

export const THUMBNAIL_VERSION = "rgba-nearest-480-v1";
/** Derive public pixels without allocating a full decoded 24 MP image.
 * Keeps two scanlines and a <=480x480 output; canonical source bytes never change.
 */
export async function thumbnail(bytes: Uint8Array) {
  if (bytes.length > MAX_IMAGE) throw new Error("Image too large.");
  const chunks = pngChunks(bytes),
    h = chunks[0].data;
  const v = new DataView(h.buffer, h.byteOffset, h.length);
  const width = v.getUint32(0),
    height = v.getUint32(4);
  if (
    h.length !== 13 ||
    !width ||
    !height ||
    width > 65536 ||
    width * height > 24_000_000 ||
    h[8] !== 8 ||
    h[9] !== 6 ||
    h[10] ||
    h[11] ||
    h[12] ||
    chunks.some((c) => !["IHDR", "IDAT", "IEND"].includes(c.type))
  )
    throw new Error("Unsupported public thumbnail source.");
  const scale = Math.min(1, 480 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)),
    outH = Math.max(1, Math.round(height * scale));
  const output = new Uint8Array(w * outH * 4);
  let prev = new Uint8Array(width * 4),
    row = new Uint8Array(width * 4);
  let x = -1,
    y = 0,
    filter = 0,
    destY = 0;
  const compressed = concat(
    ...chunks.filter((c) => c.type === "IDAT").map((c) => c.data),
  );
  const reader = new Blob([compressed as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      for (const byte of next.value) {
        if (y >= height)
          throw new Error("PNG exceeds its declared dimensions.");
        if (x === -1) {
          if (byte > 4) throw new Error("Invalid PNG row filter.");
          filter = byte;
          x = 0;
          continue;
        }
        const a = x >= 4 ? row[x - 4] : 0,
          b = prev[x],
          c = x >= 4 ? prev[x - 4] : 0;
        let predictor = 0;
        if (filter === 1) predictor = a;
        if (filter === 2) predictor = b;
        if (filter === 3) predictor = (a + b) >>> 1;
        if (filter === 4) {
          const p = a + b - c,
            pa = Math.abs(p - a),
            pb = Math.abs(p - b),
            pc = Math.abs(p - c);
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        row[x++] = (byte + predictor) & 255;
        if (x === row.length) {
          if (destY < outH && y === Math.floor((destY * height) / outH)) {
            for (let dx = 0; dx < w; dx++) {
              const sx = Math.floor((dx * width) / w) * 4;
              output.set(row.subarray(sx, sx + 4), (destY * w + dx) * 4);
            }
            destY++;
          }
          [prev, row] = [row, prev];
          y++;
          x = -1;
        }
      }
    }
    if (y !== height || x !== -1 || destY !== outH)
      throw new Error("Truncated PNG pixels.");
  } finally {
    await reader.cancel();
  }
  return encode(
    { width: w, height: outH, data: output, channels: 4, depth: 8 },
    { zlib: { level: 6 } },
  );
}
