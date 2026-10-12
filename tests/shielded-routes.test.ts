import { it, expect, vi } from "vitest";
vi.mock("../apps/api/sponsor", () => ({ Sponsor: class {} }));
vi.mock("../apps/api/indexer", () => ({ Indexer: class {} }));
import worker from "../apps/api";
import type { Env } from "../apps/api/types";
const origin = "https://devnet.zft.foo";
function environment() {
  const assets = vi.fn(
    async () =>
      new Response("<main>Shielded gallery</main>", {
        headers: { "content-type": "text/html" },
      }),
  );
  const untouched = new Proxy(
    {},
    {
      get() {
        throw Error("Retired storage must stay unused");
      },
    },
  );
  return {
    env: {
      ASSETS: { fetch: assets },
      MEDIA: { list: async () => ({ objects: [], truncated: false }) },
      PUBLIC_ORIGIN: origin,
      SPONSOR: untouched,
      INDEXER: untouched,
      DB: untouched,
    } as unknown as Env,
    assets,
  };
}
it.each([
  "/api/config",
  "/api/health",
  "/api/gallery",
  "/api/discovery/nfts",
  "/api/profiles/0x" + "1".repeat(40),
  "/api/activity",
  "/api/index",
  "/art/old.png",
  "/metadata/old.json",
  "/p/0x" + "1".repeat(40),
  "/settings/profile",
  "/ps",
])("retires %s without reading the old catalog", async (path) => {
  const { env, assets } = environment();
  const result = await worker.fetch(new Request(origin + path), env);
  expect(result.status).toBe(404);
  expect(assets).not.toHaveBeenCalled();
});
it.each([
  ["/mint", "/shielded/create"],
  ["/collection", "/shielded"],
  ["/wallet", "/shielded"],
  ["/recovery", "/shielded/recovery"],
  ["/claim", "/shielded/claim"],
  ["/explore", "/"],
])("redirects the retired %s entry to %s", async (path, target) => {
  const { env } = environment();
  const result = await worker.fetch(
    new Request(origin + path + "?private=drop"),
    env,
  );
  expect(result.status).toBe(308);
  expect(result.headers.get("location")).toBe(origin + target);
});
it("opens the public gallery without a wallet or any legacy storage", async () => {
  const { env } = environment();
  const result = await worker.fetch(
    new Request(origin + "/api/shielded/gallery"),
    env,
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ items: [], cursor: null });
  expect(result.headers.get("cache-control")).toBe("no-store");
  await worker.scheduled();
});
it("serves only new public document routes, strips HEAD bodies and applies security headers", async () => {
  const { env } = environment();
  for (const path of ["/", "/nft/0x" + "1".repeat(64), "/how-it-works"]) {
    const response = await worker.fetch(
      new Request(origin + path, { method: "HEAD" }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  }
});
it("rejects wrong origins, unexpected fields and oversized publication bodies", async () => {
  const { env } = environment();
  const send = (data: string, headers = {}) =>
    worker.fetch(
      new Request(origin + "/api/shielded/gallery", {
        method: "POST",
        headers: { origin, "content-type": "application/json", ...headers },
        body: data,
      }),
      env,
    );
  expect((await send("{}", { origin: "https://evil.test" })).status).toBe(403);
  expect((await send("{}", { "content-type": "text/plain" })).status).toBe(415);
  expect((await send('{"recovery":"must not upload"}')).status).toBe(400);
  expect((await send("broken-json")).status).toBe(400);
  expect((await send("{}", { "content-length": "14000001" })).status).toBe(413);
});
