// Checks the lab's original fixtures against the unchanged production normalizer.
// --write is only for deliberately regenerating these new image fixtures.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { encode, decode } from "fast-png";
import {
  normalizeImage,
  validatePublicImage,
  importFile,
  exportFile,
} from "../../packages/file-codec/index";
import { contract, envelope } from "../../tests/fixtures";
import {
  inspectImage,
  pngChunks,
  assemble,
  chunk,
  BEARER_CHUNK,
} from "./local/png.mjs";
const cases = [
  {
    width: 2,
    height: 2,
    pixels: [
      0, 213, 87, 255, 0, 97, 235, 255, 249, 22, 144, 255, 21, 21, 21, 0,
    ],
  },
  {
    width: 4,
    height: 3,
    pixels: Array.from({ length: 48 }, (_, i) => (i * 41) % 256),
  },
  { width: 1, height: 1, pixels: [250, 190, 24, 255] },
];
const records = [];
for (const c of cases) {
  const source = encode({
    width: c.width,
    height: c.height,
    data: new Uint8Array(c.pixels),
    channels: 4,
    depth: 8,
  });
  const normalized = await normalizeImage(source);
  const png = Buffer.from(normalized.bytes);
  assert.deepEqual(inspectImage(png).image, png);
  assert.deepEqual([...decode(png).data], c.pixels);
  assert.deepEqual(Buffer.from((await normalizeImage(png)).bytes), png);
  await validatePublicImage(png);
  const parts = pngChunks(png);
  const marked = assemble([
    ...parts.slice(0, -1),
    {
      raw: chunk(
        BEARER_CHUNK,
        new TextEncoder().encode("container compatibility test only"),
      ),
    },
    parts.at(-1)!,
  ]);
  assert.deepEqual([...decode(marked).data], c.pixels);
  await assert.rejects(() => normalizeImage(marked), /zfPC/);
  await assert.rejects(() => validatePublicImage(marked), /sanitized/);
  await assert.rejects(() => importFile(marked, contract), /exactly one/);
  records.push({
    width: c.width,
    height: c.height,
    rgbaHex: Buffer.from(c.pixels).toString("hex"),
    pngHex: png.toString("hex"),
    sha256: createHash("sha256").update(png).digest("hex"),
  });
}
const first = Buffer.from(records[0].pngHex, "hex");
const legacy = await exportFile(first, envelope(first));
assert.deepEqual(
  (await importFile(legacy, contract)).image,
  new Uint8Array(first),
);
assert.throws(() => inspectImage(legacy), /public chunks/);
const path = new URL("./local/image-fixtures.json", import.meta.url);
const expected =
  JSON.stringify(
    {
      provenance:
        "Original test pixels normalized by unchanged packages/file-codec/index.ts (zft-png/1, fast-png 8.0.0). No PS authority in these files.",
      images: records,
    },
    null,
    2,
  ) + "\n";
if (process.argv.includes("--write")) writeFileSync(path, expected);
assert.equal(
  readFileSync(path, "utf8"),
  expected,
  "exact normalized fixture reproduction",
);
console.log(
  "3 exact normalized PNG fixtures reproduce; pixel decoding, metadata rejection and v1 roundtrip pass.",
);
