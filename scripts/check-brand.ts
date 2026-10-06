// Read-only hosted checks for supplied assets and immutable sharing revisions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { decode } from "fast-png";
import { releaseHealth } from "./release-health";

const origin = "https://devnet.zft.foo";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const inventory = JSON.parse(
  await readFile("apps/web/public/assets/brand/manifest.json", "utf8"),
) as {
  assets: { original: string; rendered?: string }[];
};
const paths = inventory.assets.flatMap((a) =>
  a.rendered ? [a.original, a.rendered] : [a.original],
);
paths.push(
  "/favicon.svg",
  "/favicon.ico",
  "/assets/brand/site.webmanifest",
  "/assets/brand/index.html",
  "/assets/brand/gallery.css",
  "/licenses/IBM-Plex-Mono.txt",
);
const assets = [];
for (const path of paths) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, path);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(
    hash(bytes),
    hash(await readFile(`apps/web/public${path}`)),
    path,
  );
  const mime = response.headers.get("content-type")?.split(";")[0];
  if (path.endsWith(".svg")) assert.equal(mime, "image/svg+xml", path);
  if (path.endsWith(".png")) assert.equal(mime, "image/png", path);
  if (path.endsWith(".webmanifest"))
    assert.equal(mime, "application/manifest+json", path);
  assets.push({
    path,
    status: response.status,
    mime,
    bytes: bytes.length,
    sha256: hash(bytes),
  });
}
const before = JSON.parse(
  await readFile("research/brand-before.json", "utf8"),
) as {
  checks: { path: string; image: string; sha256: string }[];
};
const pages = [];
for (const old of before.checks) {
  const response = await fetch(origin + old.path);
  assert.equal(response.status, 200);
  const html = await response.text();
  const image = html
    .match(/<meta property="og:image" content="([^"]+)"/)?.[1]
    .replaceAll("&amp;", "&");
  assert(image);
  assert(image.startsWith(`${origin}/api/og/`));
  assert.notEqual(image, old.image, "New branding needs a new immutable URL");
  assert.match(html, /href="\/favicon\.svg\?v=2026-10"/);
  assert.match(html, /href="\/assets\/brand\/site\.webmanifest"/);
  const png = await fetch(image);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.match(png.headers.get("cache-control") ?? "", /immutable/);
  const bytes = new Uint8Array(await png.arrayBuffer()),
    decoded = decode(bytes);
  assert.deepEqual([decoded.width, decoded.height], [1200, 630]);
  assert(bytes.length <= 1024 * 1024);
  assert.notEqual(hash(bytes), old.sha256);
  const repeat = await fetch(image);
  assert.equal(repeat.status, 200);
  assert.equal(hash(new Uint8Array(await repeat.arrayBuffer())), hash(bytes));
  const legacy = await fetch(old.image);
  assert.equal(legacy.status, 200);
  assert.equal(
    hash(new Uint8Array(await legacy.arrayBuffer())),
    old.sha256,
    "Prior OG URL must preserve its pixels",
  );
  pages.push({
    path: old.path,
    image,
    sha256: hash(bytes),
    bytes: bytes.length,
    legacyImage: old.image,
    legacyPreserved: true,
  });
}
const built = await readFile("dist/web/index.html", "utf8");
const bundle = built.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
assert(bundle);
const bundleResponse = await fetch(origin + bundle);
assert.equal(bundleResponse.status, 200);
const bundleBytes = new Uint8Array(await bundleResponse.arrayBuffer());
assert.equal(hash(bundleBytes), hash(await readFile(`dist/web${bundle}`)));
const response = await fetch(origin + "/api/health");
assert.equal(response.status, 200);
const health = releaseHealth.parse(await response.json());
await writeFile(
  "research/brand-deployment.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      origin,
      assets,
      pages,
      bundle: { path: bundle, sha256: hash(bundleBytes) },
      health,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Hosted branding passed: ${assets.length} exact asset responses, three new OG images with preserved old URLs, bundle and semantic health.`,
);
