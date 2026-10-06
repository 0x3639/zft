import { expect, it } from "vitest";
import { helpPage } from "../packages/protocol/help";
import { snapshot, headTags, ogResponse } from "../apps/api/sharing";
import { digest } from "../packages/protocol";
import type { Env } from "../apps/api/types";

it.each(["/how-it-works", "/about"])(
  "normalizes %s help views and discards private/unrelated URL state",
  (path) => {
    expect(
      helpPage(
        new URL(
          `https://devnet.zft.foo${path}?view=cryptography&secret=never-share#trust`,
        ),
      ),
    ).toMatchObject({
      view: "cryptography",
      path: "/how-it-works?view=cryptography",
      imagePath: "/api/og/page/how-it-works-technical.png",
    });
    expect(
      helpPage(
        new URL(
          `https://devnet.zft.foo${path}?view=unknown&returnTo=https://bad.test`,
        ),
      ),
    ).toMatchObject({ view: "basics", path: "/how-it-works" });
  },
);
it("keeps help usable without discovery storage and gives each view its own canonical image revision", async () => {
  const unavailable = new Proxy(
    {},
    {
      get() {
        throw new Error("Storage should not be read");
      },
    },
  ) as Env;
  const basics = await snapshot(
    unavailable,
    new URL("https://devnet.zft.foo/about?tracking=drop"),
  );
  const technical = await snapshot(
    unavailable,
    new URL("https://devnet.zft.foo/how-it-works?view=cryptography#trust"),
  );
  expect(digest(basics)).not.toBe(digest(technical));
  expect(basics.imagePath).not.toBe(technical.imagePath);
  const html = headTags(
    technical,
    "https://devnet.zft.foo",
    digest(technical).slice(2),
  );
  expect(html).toContain(
    'href="https://devnet.zft.foo/how-it-works?view=cryptography"',
  );
  expect(html).toContain("The picture. The key. The proof.");
  expect(html).not.toContain("#trust");
});
it("serves the technical revision and rejects substituting the Basics snapshot", async () => {
  const page = await snapshot(
    {} as Env,
    new URL("https://devnet.zft.foo/how-it-works?view=cryptography"),
  );
  const revision = digest(page).slice(2),
    url = new URL(`https://devnet.zft.foo${page.imagePath}?v=${revision}`);
  const env = {
    MEDIA: {
      get: async (key: string) =>
        key.startsWith("og-snapshots")
          ? { json: async () => page }
          : { body: "cached PNG" },
    },
  } as unknown as Env;
  const response = await ogResponse(env, url);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("immutable");
  expect(response.headers.get("etag")).toBe(`"${revision}"`);
  const wrong = new URL(url);
  wrong.pathname = "/api/og/page/how-it-works.png";
  await expect(ogResponse(env, wrong)).rejects.toMatchObject({ status: 404 });
  wrong.pathname = page.imagePath;
  wrong.searchParams.set("v", "0".repeat(64));
  await expect(ogResponse(env, wrong)).rejects.toMatchObject({ status: 404 });
});
