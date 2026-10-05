import { afterEach, describe, expect, it, vi } from "vitest";
import { database } from "./d1";
import {
  discoverCollections,
  discoverNFTs,
  projectDiscovery,
  recentDiscoveryActivity,
} from "../apps/api/discovery";
import { profileData, publicMutation } from "../apps/api/public";
import { snapshot } from "../apps/api/sharing";
import { HttpError } from "../apps/api/http";
import { digest, type Metadata } from "../packages/protocol";
import type { Env } from "../apps/api/types";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const addr = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const url = (query = "") => new URL(`https://devnet.zft.foo/?${query}`);
function fixture() {
  const { db, sql } = database(),
    objects = new Map<string, string>();
  const env = {
    DB: db,
    MEDIA: {
      get: vi.fn(async (key: string) =>
        objects.has(key)
          ? { json: async () => JSON.parse(objects.get(key)!) }
          : null,
      ),
    },
  } as unknown as Env;
  function mint(id: number, name = `Piece ${id}`, creator = addr(1)) {
    const imageHash = `0x${id.toString(16).padStart(64, "0")}` as `0x${string}`;
    const metadata: Metadata = {
      name,
      description: "",
      image: `https://zft.foo/art/${imageHash.slice(2)}.png`,
      imageHash,
      canonicalizer: "zft-png/1",
      mediaType: "image/png",
      width: 1,
      height: 1,
      creator,
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const hash = digest(metadata);
    objects.set(`metadata/${hash.slice(2)}.json`, JSON.stringify(metadata));
    sql
      .prepare("INSERT INTO chain_events VALUES(?,0,?,?,?,?,?,?,?,?)")
      .run(
        id,
        "block",
        "tx" + id,
        "Minted",
        String(id),
        null,
        null,
        creator,
        hash,
      );
    sql
      .prepare("INSERT INTO chain_events VALUES(?,1,?,?,?,?,?,?,?,?)")
      .run(
        id,
        "block",
        "tx" + id,
        "Transfer",
        String(id),
        addr(0),
        creator,
        null,
        null,
      );
    return hash;
  }
  const profile = (n: number, name = `Collector ${n}`) =>
    publicMutation(env, "/api/profile", addr(n), {
      name,
      bio: "",
      featured: null,
      revision: 0,
    });
  function publish(
    id: number,
    profile = addr(1),
    expires = Math.floor(Date.now() / 1000) + 100,
    owner = addr(1),
    nonce = "0",
  ) {
    sql
      .prepare("INSERT INTO possessions VALUES(?,?,?,?,?,?,?)")
      .run(profile, String(id), owner, nonce, "sig", expires, Date.now());
  }
  async function project() {
    while (await projectDiscovery(env)) {}
  }
  return { env, sql, objects, mint, profile, publish, project };
}
afterEach(() => vi.useRealTimers());
describe("Discovery projections and pagination", () => {
  it("searches the whole dataset before pagination, with literal wildcards and normalized Unicode", async () => {
    const f = fixture();
    for (let id = 1; id <= 55; id++)
      f.mint(id, id === 1 ? "ＭＯＯＮ 100%_" : `Picture ${id}`);
    expect((await discoverNFTs(f.env, url())).pending).toBe(55);
    expect(await projectDiscovery(f.env)).toBe(true);
    expect((await discoverNFTs(f.env, url())).pending).toBe(47);
    await f.project();
    const page = await discoverNFTs(f.env, url("q=moon&limit=1"));
    expect(page.items.map((i) => i.tokenId)).toEqual(["1"]);
    expect(page.total).toBe(1);
    expect(page.nextCursor).toBeNull();
    expect((await discoverNFTs(f.env, url("q=%25_"))).total).toBe(1);
    expect((await discoverNFTs(f.env, url("q=absent"))).items).toEqual([]);
  });
  it.each(["newest", "oldest", "az"])(
    "paginates all titles without duplicates using %s, including title ties",
    async (sort) => {
      const f = fixture();
      for (let id = 1; id <= 30; id++)
        f.mint(id, id <= 15 ? "Same" : "Another");
      await f.project();
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await discoverNFTs(
          f.env,
          url(`sort=${sort}&limit=7${cursor ? `&cursor=${cursor}` : ""}`),
        );
        expect(page.total).toBe(30);
        ids.push(...page.items.map((i) => i.tokenId));
        cursor = page.nextCursor;
      } while (cursor);
      const expected =
        sort === "newest"
          ? Array.from({ length: 30 }, (_, i) => String(30 - i))
          : sort === "oldest"
            ? Array.from({ length: 30 }, (_, i) => String(i + 1))
            : [
                ...Array.from({ length: 15 }, (_, i) => String(i + 16)),
                ...Array.from({ length: 15 }, (_, i) => String(i + 1)),
              ];
      expect(ids).toEqual(expected);
      expect(new Set(ids).size).toBe(30);
    },
  );
  it("ranks collections by likes, follower ties, holdings and honest creation dates", async () => {
    const f = fixture();
    for (let i = 1; i <= 4; i++) await f.profile(i);
    f.sql
      .prepare("UPDATE profile_discovery SET created_at=NULL WHERE address=?")
      .run(addr(1));
    for (let i = 2; i <= 4; i++)
      f.sql
        .prepare("UPDATE profile_discovery SET created_at=? WHERE address=?")
        .run(i, addr(i));
    f.mint(1);
    f.mint(2);
    f.publish(1);
    f.publish(2);
    await f.project();
    f.sql
      .prepare("INSERT INTO relations VALUES(?,'like',?,1)")
      .run(addr(4), addr(1));
    f.sql
      .prepare("INSERT INTO relations VALUES(?,'like',?,1)")
      .run(addr(4), addr(2));
    f.sql
      .prepare("INSERT INTO relations VALUES(?,'follow',?,1)")
      .run(addr(4), addr(2));
    const popular = await discoverCollections(f.env, url(`viewer=${addr(4)}`));
    expect(popular.items.map((i) => i.address)).toEqual([
      addr(2),
      addr(1),
      addr(3),
      addr(4),
    ]);
    expect(popular.items[0].liked).toBe(true);
    const biggest = await discoverCollections(f.env, url("sort=biggest"));
    expect(biggest.items[0].collected).toBe(2);
    expect((await profileData(f.env, addr(1))).counts.collected).toBe(2);
    expect(biggest.items[0].preview?.tokenId).toBe("2");
    expect(
      (await discoverCollections(f.env, url("sort=newest"))).items.map(
        (i) => i.address,
      ),
    ).toEqual([addr(4), addr(3), addr(2), addr(1)]);
    await publicMutation(f.env, "/api/profile", addr(1), {
      name: "ÉTOILE",
      bio: "edited",
      featured: null,
      revision: 1,
    });
    expect(
      (await discoverCollections(f.env, url("q=étoile"))).items[0].createdAt,
    ).toBeNull();
    expect((await discoverCollections(f.env, url("q=ÉTOILE"))).total).toBe(1);
  });
  it.each(["popular", "newest", "biggest"])(
    "paginates tied collection ranks with %s and filters beyond page one",
    async (sort) => {
      const f = fixture();
      for (let i = 1; i <= 29; i++)
        await f.profile(i, i === 29 ? "Beyond first page" : `Same name`);
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await discoverCollections(
          f.env,
          url(`sort=${sort}&limit=5${cursor ? `&cursor=${cursor}` : ""}`),
        );
        ids.push(...page.items.map((i) => i.address));
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids).toHaveLength(29);
      expect(new Set(ids).size).toBe(29);
      expect(
        (await discoverCollections(f.env, url("q=Beyond"))).items[0].address,
      ).toBe(addr(29));
    },
  );
  it("rejects mismatched/malformed/expired cursors and invalidates ranking pages on a social change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    const page = await discoverCollections(f.env, url("limit=1"));
    await expect(
      discoverCollections(
        f.env,
        url(`limit=1&sort=biggest&cursor=${page.nextCursor}`),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      discoverNFTs(f.env, url("cursor=not-a-cursor")),
    ).rejects.toMatchObject({ status: 400 });
    await expect(discoverNFTs(f.env, url("limit=100"))).rejects.toMatchObject({
      status: 400,
    });
    await expect(discoverNFTs(f.env, url("sort=price"))).rejects.toMatchObject({
      status: 400,
    });
    await publicMutation(f.env, "/api/social", addr(2), {
      kind: "like",
      target: addr(1),
      active: true,
    });
    await expect(
      discoverCollections(f.env, url(`limit=1&cursor=${page.nextCursor}`)),
    ).rejects.toMatchObject({ status: 409 });
    const next = await discoverCollections(f.env, url("limit=1"));
    vi.advanceTimersByTime(300_001);
    await expect(
      discoverCollections(f.env, url(`limit=1&cursor=${next.nextCursor}`)),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("uses only unambiguous eligible public context and rejects pages crossing proof expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    f.mint(1);
    f.mint(2);
    f.publish(1);
    await f.project();
    expect((await discoverNFTs(f.env, url("sort=oldest"))).items[0].href).toBe(
      `/p/${addr(1)}?nft=1`,
    );
    f.publish(1, addr(2));
    expect((await discoverNFTs(f.env, url("sort=oldest"))).items[0].href).toBe(
      "/item/1",
    );
    const page = await discoverNFTs(f.env, url("limit=1"));
    vi.advanceTimersByTime(100_000);
    await expect(
      discoverNFTs(f.env, url(`limit=1&cursor=${page.nextCursor}`)),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await discoverCollections(f.env, url())).items.every(
        (i) => i.collected === 0,
      ),
    ).toBe(true);
    expect((await discoverNFTs(f.env, url("sort=oldest"))).items[0].href).toBe(
      "/item/1",
    );
  });
  it("drops ownership context on transfer, restores it on rewind, and excludes orphaned mints", async () => {
    const f = fixture();
    await f.profile(1);
    f.mint(1);
    f.publish(1);
    await f.project();
    f.sql
      .prepare("INSERT INTO chain_events VALUES(2,0,?,?,?,?,?,?,?,?)")
      .run("fork", "tx2", "Transfer", "1", addr(1), addr(2), null, null);
    expect((await discoverCollections(f.env, url())).items[0].collected).toBe(
      0,
    );
    expect((await discoverNFTs(f.env, url())).items[0].href).toBe("/item/1");
    f.sql.exec("DELETE FROM chain_events WHERE block_number=2");
    expect((await discoverCollections(f.env, url())).items[0].collected).toBe(
      1,
    );
    f.sql.exec("DELETE FROM chain_events");
    expect((await discoverNFTs(f.env, url())).total).toBe(0);
  });
  it("omits invalid/missing metadata without hiding peers, retries late metadata, and does not cache storage outages", async () => {
    const f = fixture();
    const hash = f.mint(1);
    f.mint(2);
    const object = f.objects.get(`metadata/${hash.slice(2)}.json`)!;
    f.objects.delete(`metadata/${hash.slice(2)}.json`);
    await f.project();
    expect(
      (await discoverNFTs(f.env, url())).items.map((i) => i.tokenId),
    ).toEqual(["2"]);
    f.objects.set(`metadata/${hash.slice(2)}.json`, object);
    f.sql.exec("UPDATE discovery_metadata SET retry_at=0 WHERE valid=0");
    await f.project();
    expect((await discoverNFTs(f.env, url())).total).toBe(2);
    f.mint(3);
    vi.mocked(f.env.MEDIA.get).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(projectDiscovery(f.env)).rejects.toThrow(
      "storage unavailable",
    );
    expect((await discoverNFTs(f.env, url())).pending).toBe(1);
  });
  it("uses real NFT artwork for distinct page share snapshots and honest recent chain activity", async () => {
    const f = fixture();
    await f.profile(1);
    f.mint(1);
    f.publish(1);
    await f.project();
    const home = await snapshot(f.env, new URL("https://devnet.zft.foo/"));
    const collections = await snapshot(
      f.env,
      new URL("https://devnet.zft.foo/explore"),
    );
    const nfts = await snapshot(
      f.env,
      new URL("https://devnet.zft.foo/explore/nfts?q=ignored"),
    );
    expect(home.art).toHaveLength(1);
    expect(collections.art).toHaveLength(1);
    expect(nfts.art).toHaveLength(1);
    expect(
      new Set([digest(home), digest(collections), digest(nfts)]).size,
    ).toBe(3);
    expect(nfts.path).toBe("/explore/nfts");
    expect(nfts.imagePath).toBe("/api/og/page/explore-nfts.png");
    expect((await recentDiscoveryActivity(f.env)).events[0]).toMatchObject({
      kind: "mint",
      block: 1,
      tokenId: "1",
    });
    await publicMutation(f.env, "/api/unpublish", addr(1), { tokenId: "1" });
    expect(
      (await snapshot(f.env, new URL("https://devnet.zft.foo/explore"))).art,
    ).toHaveLength(0);
  });
  it.each(["/", "/explore", "/explore/nfts"])(
    "keeps the branded %s snapshot when discovery reports a revision conflict",
    async (path) => {
      const f = fixture();
      const page = new URL(path, "https://devnet.zft.foo");
      const fallback = await snapshot(f.env, page);
      const conflict = new HttpError(409, "Discovery changed; refresh");
      vi.spyOn(f.env.DB, "prepare").mockImplementation(() => {
        throw conflict;
      });
      expect(await snapshot(f.env, page)).toEqual(fallback);
      expect(fallback.art).toEqual([]);
      await expect(
        path === "/explore"
          ? discoverCollections(f.env, url())
          : discoverNFTs(f.env, url()),
      ).rejects.toBe(conflict);
    },
  );
  it("migrates old profiles without inventing creation dates and remains compatible with old profile inserts", () => {
    const sql = new DatabaseSync(":memory:");
    sql.exec(readFileSync("migrations/0001_public.sql", "utf8"));
    sql
      .prepare("INSERT INTO profiles VALUES(?,?,?,NULL,1,?)")
      .run(addr(1), "Legacy", "", 123);
    sql.exec(readFileSync("migrations/0002_discovery.sql", "utf8"));
    expect(
      sql
        .prepare("SELECT created_at FROM profile_discovery WHERE address=?")
        .get(addr(1)),
    ).toMatchObject({ created_at: null });
    sql
      .prepare("INSERT INTO profiles VALUES(?,?,?,NULL,1,?)")
      .run(addr(2), "New", "", 456);
    const created = sql
      .prepare("SELECT created_at FROM profile_discovery WHERE address=?")
      .get(addr(2))!.created_at;
    expect(typeof created).toBe("number");
    sql
      .prepare("UPDATE profiles SET name=? WHERE address=?")
      .run("Edited", addr(2));
    expect(
      sql
        .prepare("SELECT created_at FROM profile_discovery WHERE address=?")
        .get(addr(2))!.created_at,
    ).toBe(created);
    sql.close();
  });
});
