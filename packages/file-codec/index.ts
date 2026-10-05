import { decode, encode } from "fast-png";
import jpeg from "jpeg-js";
import { sha256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CANONICALIZER,
  canonical,
  digest,
  envelopeSchema,
  type Envelope,
} from "../protocol";

export const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_ENVELOPE = 16 * 1024;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const fail = (message: string): never => {
  throw new Error(message);
};
export const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function chunk(type: string, data: Uint8Array) {
  const result = new Uint8Array(data.length + 12),
    view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(stringToBytes(type), 4);
  result.set(data, 8);
  view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)));
  return result;
}
type Chunk = { type: string; data: Uint8Array; raw: Uint8Array };
export function pngChunks(bytes: Uint8Array): Chunk[] {
  if (
    bytes.length > MAX_IMAGE + MAX_ENVELOPE + 12 ||
    !PNG.every((v, i) => bytes[i] === v)
  )
    fail("Expected a PNG image (maximum 10 MiB).");
  const chunks: Chunk[] = [];
  let p = 8,
    ended = false;
  while (p < bytes.length) {
    if (ended || p + 12 > bytes.length)
      fail("Invalid PNG length or trailing bytes.");
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset + p,
      bytes.length - p,
    );
    const size = view.getUint32(0);
    if (size > MAX_IMAGE || p + size + 12 > bytes.length)
      fail("Truncated PNG chunk.");
    const type = decoder.decode(bytes.subarray(p + 4, p + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase())
      fail("Invalid PNG chunk type.");
    if (crc32(bytes.subarray(p + 4, p + 8 + size)) !== view.getUint32(size + 8))
      fail("PNG checksum mismatch.");
    chunks.push({
      type,
      data: bytes.subarray(p + 8, p + 8 + size),
      raw: bytes.subarray(p, p + size + 12),
    });
    if (chunks.length > 2048) fail("Too many PNG chunks.");
    p += size + 12;
    ended = type === "IEND";
  }
  if (
    !ended ||
    chunks[0]?.type !== "IHDR" ||
    chunks.filter((c) => c.type === "IHDR").length !== 1 ||
    chunks.at(-1)?.data.length !== 0
  )
    fail("Invalid PNG structure.");
  const idat = chunks
    .map((c, i) => (c.type === "IDAT" ? i : -1))
    .filter((i) => i >= 0);
  if (!idat.length || idat.at(-1)! - idat[0] + 1 !== idat.length)
    fail("PNG data chunks must be consecutive.");
  return chunks;
}
function dimensions(chunks: Chunk[]) {
  const h = chunks[0].data;
  if (h.length !== 13) fail("Invalid PNG header.");
  const view = new DataView(h.buffer, h.byteOffset, h.length);
  const width = view.getUint32(0),
    height = view.getUint32(4),
    channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[h[9]];
  if (
    !width ||
    !height ||
    width * height > 24_000_000 ||
    h[8] !== 8 ||
    !channels ||
    h[10] ||
    h[11] ||
    h[12]
  )
    fail(
      "Use a non-interlaced 8-bit RGB or grayscale PNG, up to 24 megapixels.",
    );
  return { width, height, channels };
}
async function boundedInflate(chunks: Chunk[]) {
  const { width, height, channels } = dimensions(chunks);
  const expected = (width * channels + 1) * height;
  const compressed = concat(
    ...chunks.filter((c) => c.type === "IDAT").map((c) => c.data),
  );
  const stream = new Blob([compressed as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > expected)
        fail("PNG decompression exceeds its declared dimensions.");
    }
    if (size !== expected) fail("PNG pixel data length mismatch.");
  } finally {
    await reader.cancel();
  }
}
function orientation(tiff: Uint8Array) {
  if (tiff.length < 8) return fail("Invalid EXIF orientation.");
  const le = tiff[0] === 73 && tiff[1] === 73;
  if (!le && !(tiff[0] === 77 && tiff[1] === 77))
    return fail("Invalid EXIF byte order.");
  const v = new DataView(tiff.buffer, tiff.byteOffset, tiff.length);
  if (v.getUint16(2, le) !== 42) return fail("Invalid EXIF header.");
  const offset = v.getUint32(4, le);
  if (offset + 2 > tiff.length) return fail("Invalid EXIF directory.");
  const count = v.getUint16(offset, le);
  if (offset + 2 + count * 12 > tiff.length)
    return fail("Truncated EXIF directory.");
  for (let n = 0; n < count; n++) {
    const p = offset + 2 + n * 12;
    if (v.getUint16(p, le) === 0x112) {
      if (v.getUint16(p + 2, le) !== 3 || v.getUint32(p + 4, le) !== 1)
        return fail("Invalid EXIF orientation.");
      const o = v.getUint16(p + 8, le);
      if (o < 1 || o > 8) return fail("Invalid EXIF orientation.");
      return o;
    }
  }
  return 1;
}
function jpegOrientation(bytes: Uint8Array) {
  let p = 2,
    orient = 1;
  while (p < bytes.length) {
    if (bytes[p++] !== 255) fail("Invalid JPEG marker.");
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 0xda || marker === 0xd9) break;
    if (p + 2 > bytes.length) fail("Truncated JPEG.");
    const len = (bytes[p] << 8) | bytes[p + 1];
    if (len < 2 || p + len > bytes.length) fail("Invalid JPEG segment.");
    const data = bytes.subarray(p + 2, p + len);
    if (
      marker === 0xef &&
      data[0] === 90 &&
      data[1] === 70 &&
      data[2] === 84 &&
      data[3] === 0
    )
      fail("This is a transferable file. Import it instead of minting it.");
    if (
      marker === 0xe2 &&
      decoder.decode(data.subarray(0, 11)) === "ICC_PROFILE"
    )
      fail("Convert this color-profile image to sRGB first.");
    if (
      marker === 0xe1 &&
      data[0] === 69 &&
      data[1] === 120 &&
      data[2] === 105 &&
      data[3] === 102
    )
      orient = orientation(data.subarray(6));
    if ([0xc0, 0xc1, 0xc2].includes(marker) && data[5] !== 1 && data[5] !== 3)
      fail("CMYK JPEG is unsupported. Convert to sRGB.");
    p += len;
  }
  return orient;
}
function orientPixels(
  data: Uint8Array,
  width: number,
  height: number,
  o: number,
) {
  const outWidth = o >= 5 ? height : width,
    outHeight = o >= 5 ? width : height;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [dx, dy] = [
        [],
        [x, y],
        [width - 1 - x, y],
        [width - 1 - x, height - 1 - y],
        [x, height - 1 - y],
        [y, x],
        [height - 1 - y, x],
        [height - 1 - y, width - 1 - x],
        [y, width - 1 - x],
      ][o];
      out.set(
        data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
        (dy * outWidth + dx) * 4,
      );
    }
  return { data: out, width: outWidth, height: outHeight };
}
/** v1 always produces an 8-bit RGBA PNG. JPEG is an input format, never re-encoded after mint. */
export async function normalizeImage(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_IMAGE)
    fail("Choose a JPG or PNG up to 10 MiB.");
  let rgba: Uint8Array,
    width: number,
    height: number,
    orient = 1;
  if (bytes[0] === 137) {
    const chunks = pngChunks(bytes);
    const info = dimensions(chunks);
    for (const c of chunks) {
      if (
        ![
          "IHDR",
          "IDAT",
          "IEND",
          "sRGB",
          "gAMA",
          "cHRM",
          "pHYs",
          "tEXt",
          "iTXt",
          "tIME",
          "eXIf",
        ].includes(c.type)
      )
        fail(
          `Unsupported PNG chunk ${c.type}. Use an 8-bit sRGB PNG without animation.`,
        );
      if (
        c.type === "gAMA" &&
        (c.data.length !== 4 ||
          new DataView(c.data.buffer, c.data.byteOffset, 4).getUint32(0) !==
            45455)
      )
        fail("Convert PNG gamma to sRGB first.");
      if (c.type === "eXIf") orient = orientation(c.data);
    }
    await boundedInflate(chunks);
    // Decode only pixels: never inflate optional text/profile chunks.
    const image = decode(
      concat(
        PNG,
        ...chunks
          .filter((c) => ["IHDR", "IDAT", "IEND"].includes(c.type))
          .map((c) => c.raw),
      ),
      { checkCrc: true },
    );
    width = info.width;
    height = info.height;
    rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const n = i * image.channels,
        gray = image.channels < 3;
      rgba[i * 4] = image.data[n];
      rgba[i * 4 + 1] = image.data[n + (gray ? 0 : 1)];
      rgba[i * 4 + 2] = image.data[n + (gray ? 0 : 2)];
      rgba[i * 4 + 3] =
        image.channels === 2 || image.channels === 4
          ? image.data[n + image.channels - 1]
          : 255;
    }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    orient = jpegOrientation(bytes);
    const image = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: 24,
      maxMemoryUsageInMB: 256,
    });
    rgba = image.data;
    width = image.width;
    height = image.height;
  } else return fail("Only JPG and PNG images are supported.");
  const image = orientPixels(rgba, width, height, orient);
  const result = encode(
    { ...image, depth: 8, channels: 4 },
    { interlace: "null", zlib: { level: 6 } },
  );
  if (result.length > MAX_IMAGE)
    fail("The normalized PNG exceeds 10 MiB. Choose a smaller image.");
  return {
    bytes: result,
    width: image.width,
    height: image.height,
    imageHash: sha256(result),
    canonicalizer: CANONICALIZER,
  };
}
export async function validatePublicImage(bytes: Uint8Array) {
  if (bytes.length > MAX_IMAGE) fail("Image exceeds 10 MiB.");
  const chunks = pngChunks(bytes),
    info = dimensions(chunks);
  if (
    info.channels !== 4 ||
    chunks.some((c) => !["IHDR", "IDAT", "IEND"].includes(c.type))
  )
    fail("Only sanitized canonical PNG pixels can be uploaded.");
  await boundedInflate(chunks);
  return info;
}
export async function exportFile(
  image: Uint8Array,
  envelope: Envelope,
): Promise<Uint8Array> {
  await validatePublicImage(image);
  const e = envelopeSchema.parse(envelope);
  validateIdentity(image, e);
  const payload = stringToBytes(canonical(e));
  if (payload.length > MAX_ENVELOPE) fail("Ownership envelope is too large.");
  const chunks = pngChunks(image);
  return concat(
    PNG,
    ...chunks.slice(0, -1).map((c) => c.raw),
    chunk("zfTA", payload),
    chunks.at(-1)!.raw,
  );
}
function validateIdentity(image: Uint8Array, e: Envelope) {
  privateKeyToAccount(e.authority.privateKey);
  if (
    sha256(image) !== e.imageHash ||
    e.metadata.imageHash !== e.imageHash ||
    BigInt(e.imageHash).toString() !== e.tokenId ||
    digest(e.metadata) !== e.metadataHash
  )
    fail("File or metadata hash mismatch.");
  const info = dimensions(pngChunks(image));
  if (info.width !== e.metadata.width || info.height !== e.metadata.height)
    fail("Image dimensions do not match its metadata.");
}
export async function importFile(bytes: Uint8Array, approvedContract: Hex) {
  const chunks = pngChunks(bytes),
    envelopes = chunks.filter((c) => c.type === "zfTA");
  if (envelopes.length !== 1 || envelopes[0].data.length > MAX_ENVELOPE)
    fail("Expected exactly one ZFT ownership envelope.");
  const text = decoder.decode(envelopes[0].data),
    raw: unknown = JSON.parse(text);
  // Equality rejects duplicate JSON keys and alternate/non-canonical representations.
  if (canonical(raw) !== text) fail("Non-canonical ownership envelope.");
  const envelope = envelopeSchema.parse(raw);
  if (envelope.contract.toLowerCase() !== approvedContract.toLowerCase())
    fail("This file belongs to another deployment.");
  const image = concat(
    PNG,
    ...chunks.filter((c) => c.type !== "zfTA").map((c) => c.raw),
  );
  await validatePublicImage(image);
  validateIdentity(image, envelope);
  return { image, envelope };
}
