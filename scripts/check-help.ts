// Read-only hosted acceptance: HTML, rendered sharing PNGs and deployed bundle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { decode } from "fast-png";
import { HELP_VIEWS } from "../packages/protocol/help";
import { releaseHealth } from "./release-health";

const origin = "https://devnet.zft.foo";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const unescape = (value: string) => value.replaceAll("&amp;", "&");
const meta = (html: string, name: string) => {
  const value = html.match(
    new RegExp(`<meta (?:property|name)="${name}" content="([^"]+)"`),
  )?.[1];
  assert(value, `Missing ${name}`);
  return unescape(value);
};
const images = new Map<
  string,
  { url: string; sha256: string; bytes: number }
>();
const routes = [];
for (const [path, view] of [
  ["/how-it-works", "basics"],
  ["/how-it-works?view=cryptography", "cryptography"],
  ["/about?view=cryptography&tracking=discard", "cryptography"],
  ["/how-it-works?view=unknown", "basics"],
] as const) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal(meta(html, "og:title"), `${HELP_VIEWS[view].title} · ZFT`);
  const canonical =
    origin +
    "/how-it-works" +
    (view === "cryptography" ? "?view=cryptography" : "");
  assert.equal(meta(html, "og:url"), canonical);
  assert.equal(
    unescape(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? ""),
    canonical,
  );
  const image = meta(html, "og:image");
  assert.equal(meta(html, "twitter:image"), image);
  assert(
    image.startsWith(
      `${origin}/api/og/page/how-it-works${view === "cryptography" ? "-technical" : ""}.png?v=`,
    ),
  );
  const existing = images.get(view);
  if (existing) assert.equal(existing.url, image);
  else {
    const png = await fetch(image);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.match(png.headers.get("cache-control") ?? "", /immutable/);
    const bytes = new Uint8Array(await png.arrayBuffer());
    assert(bytes.length <= 1024 * 1024);
    const decoded = decode(bytes);
    assert.deepEqual([decoded.width, decoded.height], [1200, 630]);
    images.set(view, { url: image, sha256: hash(bytes), bytes: bytes.length });
    const repeated = new Uint8Array(await (await fetch(image)).arrayBuffer());
    assert.equal(hash(repeated), hash(bytes));
  }
  routes.push({ path, status: response.status, canonical, image });
}
assert.notEqual(
  images.get("basics")!.sha256,
  images.get("cryptography")!.sha256,
);
const missing = await fetch(origin + "/item/not-a-token");
assert.equal(missing.status, 404);
const missingHtml = await missing.text();
assert.match(missingHtml, /noindex/);
assert.match(missingHtml, /id="root"/);
const built = await readFile("dist/web/index.html", "utf8");
const bundle = built.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
assert(bundle);
const publicBundle = await fetch(origin + bundle);
assert.equal(publicBundle.status, 200);
const publicBytes = new Uint8Array(await publicBundle.arrayBuffer());
assert.equal(hash(publicBytes), hash(await readFile(`dist/web${bundle}`)));
const health = await fetch(origin + "/api/health");
assert.equal(health.status, 200);
const healthy = releaseHealth.parse(await health.json());
const evidence = {
  checkedAt: new Date().toISOString(),
  origin,
  routes,
  images: Object.fromEntries(images),
  invalidItem: { status: missing.status, noindexShell: true },
  bundle: { path: bundle, sha256: hash(publicBytes) },
  health: healthy,
};
await writeFile(
  "research/r5-deployment.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  "Hosted help checks passed: four HTML routes, two distinct immutable 1200×630 PNGs, invalid-item shell, bundle hash and health.",
);
