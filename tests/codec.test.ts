import { describe, it, expect } from "vitest";
import { encode, decode } from "fast-png";
import jpeg from "jpeg-js";
import { stringToBytes, sha256 } from "viem";
import {
  normalizeImage,
  exportFile,
  importFile,
  pngChunks,
  chunk,
  concat,
  validatePublicImage,
} from "../packages/file-codec";
import { canonical } from "../packages/protocol";
import { contract, envelope, source } from "./fixtures";

describe("canonical PNG and transferable envelope", () => {
  it("preserves exact pixel bytes, alpha and deterministic encoding", async () => {
    const original = source(),
      a = await normalizeImage(original),
      b = await normalizeImage(a.bytes);
    expect(a.bytes).toEqual(b.bytes);
    expect(decode(a.bytes).data).toEqual(decode(original).data);
    expect(pngChunks(a.bytes).map((c) => c.type)).toEqual([
      "IHDR",
      "IDAT",
      "IEND",
    ]);
    expect(a.imageHash).toBe(
      "0x9ecc0d3410c294cf74c5e33a2d644a0fb3f8fdc4853c36abfec1127e86c8ed35",
    );
  });
  it("round trips a real viewable PNG and large token/nonce without changing canonical bytes", async () => {
    const original = source(),
      e = envelope(original),
      file = await exportFile(original, e);
    expect(decode(file).data).toEqual(decode(original).data);
    const imported = await importFile(file, contract);
    expect(imported.image).toEqual(original);
    expect(imported.envelope).toEqual(e);
    await expect(validatePublicImage(file)).rejects.toThrow("sanitized");
    await expect(normalizeImage(file)).rejects.toThrow("zfTA");
  });
  it("rejects duplicate envelopes, duplicate JSON keys and foreign deployments", async () => {
    const original = source(),
      e = envelope(original),
      file = await exportFile(original, e),
      chunks = pngChunks(file);
    const duplicate = concat(
      file.subarray(0, 8),
      ...chunks.slice(0, -1).map((c) => c.raw),
      chunks.find((c) => c.type === "zfTA")!.raw,
      chunks.at(-1)!.raw,
    );
    await expect(importFile(duplicate, contract)).rejects.toThrow(
      "exactly one",
    );
    const duplicateJson = canonical(e).replace(
      '"version":1',
      '"version":1,"version":1',
    );
    const ambiguous = concat(
      original.subarray(0, 8),
      ...pngChunks(original)
        .slice(0, -1)
        .map((c) => c.raw),
      chunk("zfTA", stringToBytes(duplicateJson)),
      pngChunks(original).at(-1)!.raw,
    );
    await expect(importFile(ambiguous, contract)).rejects.toThrow(
      "Non-canonical",
    );
    await expect(
      importFile(file, "0x0000000000000000000000000000000000000002"),
    ).rejects.toThrow("another deployment");
  });
  it("rejects tampering, zero keys, truncation, CRC mismatch, trailing bytes, APNG, oversized dimensions", async () => {
    const original = source(),
      e = envelope(original);
    await expect(
      exportFile(original, {
        ...e,
        metadata: { ...e.metadata, name: "Altered" },
      }),
    ).rejects.toThrow("hash mismatch");
    await expect(
      exportFile(original, {
        ...e,
        authority: {
          ...e.authority,
          privateKey: ("0x" + "0".repeat(64)) as `0x${string}`,
        },
      }),
    ).rejects.toThrow();
    const corrupt = original.slice();
    corrupt[30] ^= 1;
    expect(() => pngChunks(corrupt)).toThrow("checksum");
    expect(() => pngChunks(original.slice(0, -1))).toThrow();
    expect(() => pngChunks(concat(original, new Uint8Array([0])))).toThrow(
      "trailing",
    );
    const chunks = pngChunks(original),
      apng = concat(
        original.subarray(0, 8),
        chunks[0].raw,
        chunk("acTL", new Uint8Array(8)),
        ...chunks.slice(1).map((c) => c.raw),
      );
    await expect(normalizeImage(apng)).rejects.toThrow("acTL");
    const ihdr = chunks[0].data.slice();
    new DataView(ihdr.buffer).setUint32(0, 24000001);
    await expect(
      normalizeImage(
        concat(
          original.subarray(0, 8),
          chunk("IHDR", ihdr),
          ...chunks.slice(1).map((c) => c.raw),
        ),
      ),
    ).rejects.toThrow("24 megapixels");
  });
  it("bounds decompression against the declared pixel dimensions", async () => {
    const bigger = encode({
        width: 100,
        height: 100,
        data: new Uint8Array(40000),
        channels: 4,
        depth: 8,
      }),
      chunks = pngChunks(bigger);
    const header = chunks[0].data.slice();
    new DataView(header.buffer).setUint32(0, 1);
    new DataView(header.buffer).setUint32(4, 1);
    await expect(
      normalizeImage(
        concat(
          bigger.subarray(0, 8),
          chunk("IHDR", header),
          ...chunks.slice(1).map((c) => c.raw),
        ),
      ),
    ).rejects.toThrow("decompression");
  });
  it("normalizes JPEG pixels with EXIF orientation applied and metadata removed", async () => {
    const jpg = jpeg.encode(
      {
        width: 2,
        height: 3,
        data: Buffer.from(
          Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? 255 : i * 7)),
        ),
      },
      90,
    ).data;
    const exif = new Uint8Array([
      0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1,
      0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const normalized = await normalizeImage(
      concat(jpg.subarray(0, 2), exif, jpg.subarray(2)),
    );
    expect(normalized.width).toBe(3);
    expect(normalized.height).toBe(2);
    await validatePublicImage(normalized.bytes);
  });
});
