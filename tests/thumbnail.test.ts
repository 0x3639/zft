import { it, expect } from "vitest";
import { encode, decode } from "fast-png";
import { thumbnail } from "../packages/file-codec/thumbnail";
import { chunk, concat, pngChunks } from "../packages/file-codec";
it("retains actual RGBA pixels and bounds a large NFT to 480px without altering its source", async () => {
  const width = 2400,
    height = 1000,
    data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = x % 256;
      data[i + 1] = y % 256;
      data[i + 2] = 77;
      data[i + 3] = x % 3 ? 255 : 0;
    }
  const source = encode({ width, height, data, channels: 4, depth: 8 }),
    copy = source.slice();
  const bytes = await thumbnail(source),
    out = decode(bytes);
  expect([out.width, out.height]).toEqual([480, 200]);
  expect(bytes.length).toBeLessThan(1048576);
  expect(source).toEqual(copy);
  for (const [x, y] of [
    [0, 0],
    [123, 78],
    [479, 199],
  ]) {
    const original = (y * 5 * width + x * 5) * 4;
    expect(
      Array.from(out.data.slice((y * 480 + x) * 4, (y * 480 + x) * 4 + 4)),
    ).toEqual(Array.from(data.slice(original, original + 4)));
  }
});
it("rejects envelope/ancillary content and inflated rows exceeding declared dimensions", async () => {
  const image = encode({
      width: 2,
      height: 2,
      data: new Uint8Array(16),
      channels: 4,
      depth: 8,
    }),
    chunks = pngChunks(image);
  await expect(
    thumbnail(
      concat(
        image.slice(0, 8),
        ...chunks.slice(0, -1).map((c) => c.raw),
        chunk("zfTA", new Uint8Array([1])),
        chunks.at(-1)!.raw,
      ),
    ),
  ).rejects.toThrow("Unsupported public");
  const h = chunks[0].data.slice();
  new DataView(h.buffer).setUint32(4, 1);
  await expect(
    thumbnail(
      concat(
        image.slice(0, 8),
        chunk("IHDR", h),
        ...chunks.slice(1).map((c) => c.raw),
      ),
    ),
  ).rejects.toThrow("exceeds");
});
