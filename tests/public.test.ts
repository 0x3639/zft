import { describe, it, expect } from "vitest";
import { projectDiscovery } from "../apps/api/discovery";
import { database } from "./d1";
import {
  publicMutation,
  profileData,
  gallery,
  inProfile,
  publicContext,
  collectionPreview,
  item,
} from "../apps/api/public";
import { headTags, snapshot, ogResponse } from "../apps/api/sharing";
import { digest, type Metadata } from "../packages/protocol";
import type { Env } from "../apps/api/types";
const alice = "0x1111111111111111111111111111111111111111",
  bob = "0x2222222222222222222222222222222222222222";
function setup() {
  const { db, sql } = database();
  const objects = new Map<string, string>();
  const env = {
    DB: db,
    MEDIA: {
      get: async (key: string) =>
        objects.has(key)
          ? {
              json: async () => JSON.parse(objects.get(key)!),
              body: objects.get(key)!,
            }
          : null,
    },
  } as unknown as Env;
  return { env, sql, objects };
}
describe("Public identity and ownership projections", () => {
  it.each(["creator", "digest", "image", "schema", "json", "missing"])(
    "excludes a token with invalid %s metadata without breaking its gallery or profile preview",
    async (invalid) => {
      const { env, sql, objects } = setup();
      for (let id = 1; id <= 2; id++) {
        const imageHash =
          `0x${(id === 2 && invalid === "image" ? 3 : id).toString(16).padStart(64, "0")}` as `0x${string}`;
        const m: Metadata = {
          name: `Art ${id}`,
          description: "",
          image: `https://zft.foo/art/${imageHash.slice(2)}.png`,
          imageHash,
          canonicalizer: "zft-png/1",
          mediaType: "image/png",
          width: 1,
          height: 1,
          creator: id === 2 && invalid === "creator" ? alice : bob,
          createdAt: "2026-10-04T00:00:00.000Z",
        };
        const hash = digest(m);
        let content = JSON.stringify(m);
        if (id === 2) {
          if (invalid === "digest")
            content = JSON.stringify({ ...m, name: "Tampered" });
          if (invalid === "schema") content = "{}";
          if (invalid === "json") content = "{";
        }
        if (id !== 2 || invalid !== "missing")
          objects.set(`metadata/${hash.slice(2)}.json`, content);
        sql
          .prepare("INSERT INTO chain_events VALUES(?,0,?,?,?,?,?,?,?,?)")
          .run(id, "block", "tx", "Minted", String(id), null, null, bob, hash);
        sql
          .prepare("INSERT INTO chain_events VALUES(?,1,?,?,?,?,?,?,?,?)")
          .run(
            id,
            "block",
            "tx",
            "Transfer",
            String(id),
            null,
            bob,
            null,
            null,
          );
        sql
          .prepare("INSERT INTO possessions VALUES(?,?,?,?,?,?,?)")
          .run(
            bob,
            String(id),
            bob,
            "0",
            "signature",
            Math.floor(Date.now() / 1000) + 100,
            id,
          );
      }
      await projectDiscovery(env);
      const url = new URL("https://zft.foo/api/gallery");
      expect((await gallery(env, url)).items.map((i) => i.tokenId)).toEqual([
        "1",
      ]);
      for (const tab of ["created", "collection", "wallet"])
        expect(
          (await gallery(env, url, bob, tab)).items.map((i) => i.tokenId),
        ).toEqual(["1"]);
      expect((await collectionPreview(env, bob)).map((i) => i.tokenId)).toEqual(
        ["1"],
      );
      await expect(item(env, "2")).rejects.toMatchObject({ status: 404 });
      env.MEDIA.get = async () => {
        throw new Error("R2 unavailable");
      };
      await expect(gallery(env, url)).rejects.toThrow("R2 unavailable");
    },
  );
  it("orders profile previews by publication time and excludes expired holdings", async () => {
    const { env, sql, objects } = setup();
    for (let id = 1; id <= 4; id++) {
      const imageHash =
        `0x${id.toString(16).padStart(64, "0")}` as `0x${string}`;
      const m: Metadata = {
        name: `Art ${id}`,
        description: "",
        image: `https://zft.foo/art/${imageHash.slice(2)}.png`,
        imageHash,
        canonicalizer: "zft-png/1",
        mediaType: "image/png",
        width: 1,
        height: 1,
        creator: alice,
        createdAt: "2026-10-04T00:00:00.000Z",
      };
      const hash = digest(m);
      objects.set(`metadata/${hash.slice(2)}.json`, JSON.stringify(m));
      sql
        .prepare("INSERT INTO chain_events VALUES(?,0,?,?,?,?,?,?,?,?)")
        .run(id, "block", "tx", "Minted", String(id), null, null, alice, hash);
      sql
        .prepare("INSERT INTO chain_events VALUES(?,1,?,?,?,?,?,?,?,?)")
        .run(
          id,
          "block",
          "tx",
          "Transfer",
          String(id),
          null,
          alice,
          null,
          null,
        );
      sql
        .prepare("INSERT INTO possessions VALUES(?,?,?,?,?,?,?)")
        .run(
          alice,
          String(id),
          alice,
          "0",
          "signature",
          id === 4 ? 1 : Math.floor(Date.now() / 1000) + 100,
          100 - id,
        );
    }
    expect((await collectionPreview(env, alice)).map((i) => i.tokenId)).toEqual(
      ["1", "2", "3"],
    );
  });
  it("requires an exact published epoch for history and keeps current collages separate from creator provenance", async () => {
    const { env, sql, objects } = setup();
    const metadata: Metadata = {
      name: "Previous epoch",
      description: "",
      image: "https://zft.foo/art/" + "0".repeat(63) + "1.png",
      imageHash: ("0x" + "0".repeat(63) + "1") as `0x${string}`,
      canonicalizer: "zft-png/1",
      mediaType: "image/png",
      width: 1,
      height: 1,
      creator: alice,
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const hash = digest(metadata);
    objects.set(`metadata/${hash.slice(2)}.json`, JSON.stringify(metadata));
    sql
      .prepare("INSERT INTO chain_events VALUES(1,0,?,?,?,?,?,?,?,?)")
      .run("block", "tx", "Minted", "1", null, null, alice, hash);
    sql
      .prepare("INSERT INTO chain_events VALUES(1,1,?,?,?,?,?,?,?,?)")
      .run("block", "tx", "Transfer", "1", null, alice, null, null);
    sql
      .prepare("INSERT INTO possessions VALUES(?,?,?,?,?,?,?)")
      .run(
        alice,
        "1",
        alice,
        "0",
        "signature",
        Math.floor(Date.now() / 1000) + 100,
        Date.now(),
      );
    await projectDiscovery(env);
    expect(
      (await snapshot(env, new URL(`https://zft.foo/p/${alice}`))).art,
    ).toHaveLength(1);
    sql
      .prepare("INSERT INTO chain_events VALUES(2,0,?,?,?,?,?,?,?,?)")
      .run("next", "tx2", "Transfer", "1", alice, bob, null, null);
    expect(await inProfile(env, alice, "1")).toBe(true); // Immutable creator provenance.
    expect(await publicContext(env, alice, "1")).toBeNull();
    expect(
      (await gallery(env, new URL("https://internal"), alice, "wallet")).items,
    ).toEqual([]);
    const walletItems = (
      await gallery(env, new URL("https://internal"), bob, "wallet")
    ).items;
    expect(walletItems.map((i) => i.tokenId)).toEqual(["1"]);
    expect(walletItems[0].publicationNonce).toBeUndefined(); // Wallet ownership is independent of profile publication.
    expect(
      (await snapshot(env, new URL(`https://zft.foo/p/${alice}`))).art,
    ).toHaveLength(0);
    expect(
      (await gallery(env, new URL("https://internal"), alice, "sent")).items[0]
        .publicationNonce,
    ).toBe("0");
    const page = await snapshot(
      env,
      new URL(`https://zft.foo/p/${alice}?tab=sent&nft=1&epoch=0`),
    );
    expect(page.path).toBe(`/p/${alice}?nft=1&epoch=0`);
    expect(page.subtitle).toBe("PREVIOUS OWNERSHIP EPOCH");
    expect(page.publication?.nonce).toBe("0");
    await expect(publicContext(env, alice, "1", "1")).rejects.toThrow(
      "not published",
    );
    await expect(publicContext(env, bob, "1", "0")).rejects.toThrow(
      "not published",
    );
    const revision = digest(page).slice(2);
    objects.set(
      `og-snapshots${page.imagePath}/${revision}.json`,
      JSON.stringify(page),
    );
    objects.set(`og${page.imagePath}/${revision}.png`, "cached image bytes");
    const url = new URL(`https://zft.foo${page.imagePath}?v=${revision}`);
    expect((await ogResponse(env, url)).status).toBe(200);
    await publicMutation(env, "/api/unpublish", alice, { tokenId: "1" });
    await expect(publicContext(env, alice, "1", "0")).rejects.toThrow(
      "not published",
    );
    await expect(ogResponse(env, url)).rejects.toThrow("no longer publishes");
  });
  it("rejects stale concurrent profile edits and does not let a stale revision create a profile", async () => {
    const { env } = setup(),
      p = { name: "Alice", bio: "", featured: null, revision: 0 };
    await expect(
      publicMutation(env, "/api/profile", alice, { ...p, revision: 8 }),
    ).rejects.toThrow("Profile changed");
    await publicMutation(env, "/api/profile", alice, p);
    const attempts = await Promise.allSettled([
      publicMutation(env, "/api/profile", alice, {
        ...p,
        name: "First",
        revision: 1,
      }),
      publicMutation(env, "/api/profile", alice, {
        ...p,
        name: "Second",
        revision: 1,
      }),
    ]);
    expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await profileData(env, alice)).profile.revision).toBe(2);
  });
  it("keeps follow/like retries idempotent and reversible", async () => {
    const { env } = setup();
    for (const addr of [alice, bob] as const)
      await publicMutation(env, "/api/profile", addr, {
        name: addr,
        bio: "",
        featured: null,
        revision: 0,
      });
    for (let i = 0; i < 2; i++)
      await publicMutation(env, "/api/social", alice, {
        kind: "follow",
        target: bob,
        active: true,
      });
    expect((await profileData(env, bob, alice)).counts.followers).toBe(1);
    await publicMutation(env, "/api/social", alice, {
      kind: "follow",
      target: bob,
      active: false,
    });
    expect((await profileData(env, bob)).counts.followers).toBe(0);
  });
  it("invalidates a published holding after a self-transfer and restores it when that fork is removed", async () => {
    const { env, sql } = setup();
    sql
      .prepare("INSERT INTO chain_events VALUES(1,0,?,?,?,?,?,?,?,?)")
      .run("hash", "tx", "Minted", "1", null, null, bob, "0x" + "1".repeat(64));
    sql
      .prepare("INSERT INTO chain_events VALUES(1,1,?,?,?,?,?,?,?,?)")
      .run(
        "hash",
        "tx",
        "Transfer",
        "1",
        "0x" + "0".repeat(40),
        alice,
        null,
        null,
      );
    sql
      .prepare("INSERT INTO possessions VALUES(?,?,?,?,?,?,?)")
      .run(
        alice,
        "1",
        alice,
        "0",
        "signature",
        Math.floor(Date.now() / 1000) + 100,
        Date.now(),
      );
    expect(await inProfile(env, alice, "1")).toBe(true);
    sql
      .prepare("INSERT INTO chain_events VALUES(2,0,?,?,?,?,?,?,?,?)")
      .run("fork", "tx2", "Transfer", "1", alice, alice, null, null);
    expect(await inProfile(env, alice, "1")).toBe(false);
    sql.exec("DELETE FROM chain_events WHERE block_number>1");
    expect(await inProfile(env, alice, "1")).toBe(true);
  });
  it("isolates selected-artwork share context and escapes hostile titles in initial HTML", async () => {
    const { env, sql, objects } = setup();
    const m: Metadata = {
      name: '<script>bad</script> " title',
      description: '<img onerror="oops">',
      image: "https://zft.foo/art/" + "0".repeat(63) + "1.png",
      imageHash: ("0x" + "0".repeat(63) + "1") as `0x${string}`,
      canonicalizer: "zft-png/1",
      mediaType: "image/png",
      width: 1,
      height: 1,
      creator: alice,
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const hash = digest(m);
    objects.set(`metadata/${hash.slice(2)}.json`, JSON.stringify(m));
    sql
      .prepare("INSERT INTO chain_events VALUES(1,0,?,?,?,?,?,?,?,?)")
      .run("hash", "tx", "Minted", "1", null, null, alice, hash);
    sql
      .prepare("INSERT INTO chain_events VALUES(1,1,?,?,?,?,?,?,?,?)")
      .run("hash", "tx", "Transfer", "1", null, alice, null, null);
    await publicMutation(env, "/api/profile", bob, {
      name: "Bob",
      bio: "",
      featured: null,
      revision: 0,
    });
    await expect(
      snapshot(env, new URL(`https://zft.foo/p/${bob}?nft=1`)),
    ).rejects.toThrow("not in the public profile");
    const page = await snapshot(
      env,
      new URL(`https://zft.foo/p/${alice}?nft=1&utm_source=x`),
    );
    expect(page.path).toBe(`/p/${alice}?nft=1`);
    const tags = headTags(page, "https://zft.foo", "revision");
    expect(tags).not.toContain("<script>");
    expect(tags).toContain("&lt;script&gt;");
    expect(tags).not.toContain("utm_source");
    const profile = await snapshot(env, new URL(`https://zft.foo/p/${alice}`));
    expect(digest(page)).not.toBe(digest(profile));
    expect(
      (await gallery(env, new URL("https://zft.foo/api/gallery"))).items,
    ).toHaveLength(1);
  });
  it("refuses an already cached profile image after the holding is unpublished", async () => {
    const { env, sql, objects } = setup();
    const m: Metadata = {
      name: "Published holding",
      description: "",
      image: "https://zft.foo/art/" + "0".repeat(63) + "1.png",
      imageHash: ("0x" + "0".repeat(63) + "1") as `0x${string}`,
      canonicalizer: "zft-png/1",
      mediaType: "image/png",
      width: 1,
      height: 1,
      creator: bob,
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const hash = digest(m);
    objects.set(`metadata/${hash.slice(2)}.json`, JSON.stringify(m));
    sql
      .prepare("INSERT INTO chain_events VALUES(1,0,?,?,?,?,?,?,?,?)")
      .run("block", "tx", "Minted", "1", null, null, bob, hash);
    sql
      .prepare("INSERT INTO chain_events VALUES(1,1,?,?,?,?,?,?,?,?)")
      .run(
        "block",
        "tx",
        "Transfer",
        "1",
        "0x" + "0".repeat(40),
        alice,
        null,
        null,
      );
    sql
      .prepare("INSERT INTO possessions VALUES(?,?,?,?,?,?,?)")
      .run(
        alice,
        "1",
        alice,
        "0",
        "signature",
        Math.floor(Date.now() / 1000) + 100,
        Date.now(),
      );
    await publicMutation(env, "/api/profile", alice, {
      name: "Alice",
      bio: "",
      featured: null,
      revision: 0,
    });
    const page = await snapshot(
      env,
      new URL(`https://zft.foo/p/${alice}?nft=1`),
    );
    const revision = digest(page).slice(2);
    objects.set(
      `og-snapshots${page.imagePath}/${revision}.json`,
      JSON.stringify(page),
    );
    objects.set(`og${page.imagePath}/${revision}.png`, "cached image bytes");
    const url = new URL(`https://zft.foo${page.imagePath}?v=${revision}`);
    expect((await ogResponse(env, url)).status).toBe(200);
    await publicMutation(env, "/api/unpublish", alice, { tokenId: "1" });
    await expect(ogResponse(env, url)).rejects.toThrow("no longer publishes");
  });
});
