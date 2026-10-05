// Read-only hosted acceptance. Run after applying 0002 and deploying the app.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import type {
  CollectionEntry,
  DiscoveredItem,
  DiscoveryPage,
} from "../packages/protocol/discovery";
const origin = process.env.ZFT_TEST_ORIGIN ?? "https://devnet.zft.foo";
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
async function get<T>(path: string): Promise<T> {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, `${path}: ${response.status}`);
  return (await response.json()) as T;
}
const index = await get<{ block: number | null; error: string | null }>(
  "/api/index",
);
assert.equal(index.error, null);
const collections = await get<DiscoveryPage<CollectionEntry>>(
  "/api/discovery/collections?limit=24",
);
const nfts = await get<DiscoveryPage<DiscoveredItem>>(
  "/api/discovery/nfts?limit=24",
);
assert.equal(
  collections.pending,
  0,
  "Collection backfill still pending; retry after the indexer alarm",
);
assert.equal(
  nfts.pending,
  0,
  "Metadata backfill still pending; retry after the indexer alarm",
);
for (const entry of collections.items) {
  const profile = await get<{ counts: { collected: number } }>(
    "/api/profiles/" + entry.address,
  );
  assert.equal(entry.collected, profile.counts.collected);
}
const sorted = await get<DiscoveryPage<DiscoveredItem>>(
  "/api/discovery/nfts?sort=oldest&limit=1",
);
if (sorted.items[0]) {
  const page = await get<DiscoveryPage<DiscoveredItem>>(
    "/api/discovery/nfts?q=" +
      encodeURIComponent(sorted.items[0].metadata.name),
  );
  assert(
    page.items.some((i) => i.tokenId === sorted.items[0].tokenId),
    "Search must reach oldest title",
  );
}
const noResults = await get<DiscoveryPage<DiscoveredItem>>(
  "/api/discovery/nfts?q=zft-no-such-title-acceptance",
);
assert.equal(noResults.total, 0);
const localHTML = await readFile("dist/web/index.html", "utf8");
const entry = localHTML.match(/src="(\/assets\/index-[^"]+\.js)"/)![1];
const routes = [];
for (const path of ["/", "/explore", "/explore/nfts"]) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert(html.includes(entry));
  const og = html
    .match(/property="og:image" content="([^"]+)"/)![1]
    .replaceAll("&amp;", "&");
  const image = await fetch(og);
  assert.equal(image.status, 200);
  assert(image.headers.get("content-type")?.includes("image/png"));
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  routes.push({
    path,
    status: response.status,
    og,
    imageBytes: bytes.length,
    imageSha256: hash(bytes),
    width: 1200,
    height: 630,
  });
}
assert.equal(new Set(routes.map((r) => r.og)).size, 3);
assert.equal(new Set(routes.map((r) => r.imageSha256)).size, 3);
const remoteBundle = new Uint8Array(
    await (await fetch(origin + entry)).arrayBuffer(),
  ),
  localBundle = await readFile("dist/web" + entry);
assert.equal(hash(remoteBundle), hash(localBundle));
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  index,
  collections: collections.total,
  nfts: nfts.total,
  pending: 0,
  checks: [
    "Hosted collection counts agree with public profiles",
    "Search reaches the oldest artwork",
    "No-result search returns an empty dataset",
    "Three public routes return the exact tested bundle",
    "Distinct valid 1200×630 PNG share images for all three public pages",
  ],
  entry,
  assetSha256: hash(remoteBundle),
  routes,
};
await writeFile(
  "research/r2-deployment.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
