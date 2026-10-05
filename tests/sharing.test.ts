import { afterAll, beforeAll, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

let worker: Unstable_DevWorker;
const profile = "/p/0x1111111111111111111111111111111111111111";
beforeAll(async () => {
  worker = await unstable_dev("tests/fixtures/sharing-worker.ts", {
    config: "tests/fixtures/wrangler.sharing.jsonc",
    local: true,
    port: 0,
    inspectorPort: 0,
    persist: false,
    logLevel: "error",
    experimental: {
      disableExperimentalWarning: true,
      disableDevRegistry: true,
      watch: false,
    },
  });
}, 30_000);
afterAll(async () => {
  await worker?.stop();
});

it.each([
  ["unindexed item", "/item/42", "", 404],
  ["unpublished profile", profile, "", 404],
  ["invalid selection", `${profile}?nft=bad`, "published-profile", 400],
  ["unpublished selection", `${profile}?nft=42`, "published-profile", 404],
  ["unknown route", "/missing", "", 404],
  ["database outage", profile, "database-outage", 503],
  ["metadata outage", "/item/42", "metadata-outage", 503],
  ["snapshot lookup outage", "/explore", "head-outage", 503],
  ["snapshot persistence outage", "/explore", "put-outage", 503],
] as const)(
  "serves the usable app shell with private metadata on %s",
  async (_label, path, mode, status) => {
    const response = await worker.fetch(path, {
      headers: { "x-fixture": mode },
    });
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBeNull();
    const html = await response.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('src="/assets/app.js"');
    expect(html).toContain('name="robots" content="noindex,nofollow"');
    expect(html).not.toContain('property="og:image"');
    expect(html).not.toContain('name="twitter:image"');
    expect(html).not.toContain("Old title");
    expect(html).not.toContain("private storage failure detail");
    expect(html).not.toContain("A published collector");
  },
);
it("keeps public share metadata and private routes working", async () => {
  const publicPage = await worker.fetch("/explore");
  expect(publicPage.status).toBe(200);
  const html = await publicPage.text();
  expect(html).toMatch(
    /property="og:image" content="https:\/\/devnet.zft.foo\/api\/og\/page\/explore.png\?v=[a-f0-9]{64}"/,
  );
  expect(html).not.toContain("stale-image");
  expect(html).not.toContain('name="robots"');
  const privatePage = await worker.fetch("/wallet", {
    headers: { "x-fixture": "head-outage" },
  });
  expect(privatePage.status).toBe(200);
  const privateHTML = await privatePage.text();
  expect(privateHTML).toContain('name="robots" content="noindex,nofollow"');
  expect(privateHTML).not.toContain('property="og:image"');
});
it("preserves an unavailable asset shell status and HEAD semantics", async () => {
  const missingShell = await worker.fetch("/missing", {
    headers: { "x-fixture": "shell-outage" },
  });
  expect(missingShell.status).toBe(502);
  await missingShell.text();
  const head = await worker.fetch("/item/42", { method: "HEAD" });
  expect(head.status).toBe(404);
  expect(head.headers.get("content-type")).toContain("text/html");
  expect(await head.text()).toBe("");
});
