import { afterEach, expect, it, vi } from "vitest";
import { decode, encode } from "fast-png";
import { sha256 } from "viem";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { database } from "./d1";
import { publicMutation, profileData, directory } from "../apps/api/public";
import {
  admittedProfileImage,
  profileMediaResponse,
} from "../apps/api/profile-media";
import { discoverCollections } from "../apps/api/discovery";
import { snapshot } from "../apps/api/sharing";
import {
  PROFILE_MEDIA,
  type MediaKind,
} from "../packages/protocol/profile-media";
import { base64 } from "../packages/vault";
import {
  chunk,
  concat,
  pngChunks,
  normalizeImage,
} from "../packages/file-codec";
import {
  cropProfileImage,
  cropRect,
} from "../packages/file-codec/profile-crop";
import type { Env } from "../apps/api/types";
const alice = "0x1111111111111111111111111111111111111111",
  bob = "0x2222222222222222222222222222222222222222";
function image(kind: MediaKind, color = 90) {
  const { width, height } = PROFILE_MEDIA[kind];
  const data = new Uint8Array(width * height * 4).fill(color);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return encode({ width, height, data, depth: 8, channels: 4 });
}
const avatar = image("avatar"),
  cover = image("cover");
function fixture() {
  const { db, sql } = database();
  const objects = new Map<string, Uint8Array>();
  const put = vi.fn(async (key: string, data: Uint8Array) => {
    objects.set(key, data);
  });
  const env = {
    DB: db,
    MEDIA: {
      put,
      get: async (key: string) =>
        objects.has(key)
          ? {
              body: objects.get(key),
              arrayBuffer: async () => objects.get(key)!.buffer,
              size: objects.get(key)!.length,
            }
          : null,
    },
  } as unknown as Env;
  const save = (
    revision: number,
    changes = {},
    actor: typeof alice | typeof bob = alice,
  ) =>
    publicMutation(env, "/api/profile", actor, {
      name: "Collector",
      bio: "",
      featured: null,
      revision,
      ...changes,
    });
  return { env, db, sql, objects, put, save };
}
afterEach(() => vi.restoreAllMocks());
it("publishes both images, preserves them for older clients, and journals meaningful media edits once", async () => {
  const f = fixture();
  await f.save(0, {
    avatar: { image: base64(avatar) },
    cover: { image: base64(cover) },
  });
  expect((await profileData(f.env, alice)).profile).toMatchObject({
    revision: 1,
    avatar: sha256(avatar),
    cover: sha256(cover),
  });
  expect(f.objects.size).toBe(2);
  await f.save(1); // Omission from a preceding client does not reset media.
  await f.save(2, { avatar: { image: base64(avatar) } }); // Same pixels: no event.
  expect(
    f.sql.prepare("SELECT kind FROM public_events ORDER BY id").all(),
  ).toEqual([{ kind: "profile_created" }]);
  await f.save(3, { avatar: null });
  expect((await profileData(f.env, alice)).profile).toMatchObject({
    revision: 4,
    avatar: null,
    cover: sha256(cover),
  });
  await f.save(4, { name: "Renamed", cover: null });
  expect(
    f.sql.prepare("SELECT kind FROM public_events ORDER BY id").all(),
  ).toEqual([
    { kind: "profile_created" },
    { kind: "profile_updated" },
    { kind: "profile_updated" },
  ]);
  expect(f.objects.size).toBe(2); // Old public snapshots retain immutable media.
});
it("rejects stale saves before upload and keeps the winner during an interleaved save", async () => {
  const f = fixture();
  await f.save(0);
  const winner = image("avatar", 150);
  f.put.mockImplementationOnce(async (key, data) => {
    f.objects.set(key, data);
    await f.save(1, { avatar: { image: base64(winner) } });
  });
  await expect(
    f.save(1, {
      avatar: { image: base64(avatar) },
      cover: { image: base64(cover) },
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await profileData(f.env, alice)).profile).toMatchObject({
    revision: 2,
    avatar: sha256(winner),
    cover: null,
  });
  const uploads = f.put.mock.calls.length;
  await expect(
    f.save(1, { avatar: { image: base64(avatar) } }),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.put).toHaveBeenCalledTimes(uploads);
  expect(
    f.sql.prepare("SELECT COUNT(*) n FROM public_events").get(),
  ).toMatchObject({ n: 2 });
});
it("rolls back profile and journal changes if the media reference write fails", async () => {
  const f = fixture();
  await f.save(0);
  f.sql.exec(
    "CREATE TRIGGER reject_media BEFORE INSERT ON profile_media BEGIN SELECT RAISE(ABORT,'media unavailable'); END;",
  );
  await expect(
    f.save(1, { name: "Must roll back", avatar: { image: base64(avatar) } }),
  ).rejects.toThrow("media unavailable");
  expect((await profileData(f.env, alice)).profile).toMatchObject({
    name: "Collector",
    revision: 1,
    avatar: null,
  });
  expect(
    f.sql.prepare("SELECT COUNT(*) n FROM public_events").get(),
  ).toMatchObject({ n: 1 });
});
it("keeps all profile references unchanged after an upload failure", async () => {
  const f = fixture();
  await f.save(0);
  f.put.mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(
    f.save(1, { avatar: { image: base64(avatar) } }),
  ).rejects.toThrow("Storage unavailable");
  expect((await profileData(f.env, alice)).profile.revision).toBe(1);
});
it("does not accept another profile address or arbitrary media reference from the request", async () => {
  const f = fixture();
  await f.save(0, { avatar: { image: base64(avatar) } });
  await expect(f.save(0, { address: alice }, bob)).rejects.toThrow();
  await expect(f.save(0, { avatar: sha256(avatar) }, bob)).rejects.toThrow();
  await expect(
    f.save(0, { name: "Bob", avatar: { image: base64(cover) } }, bob),
  ).rejects.toThrow();
  expect((await profileData(f.env, alice)).profile.revision).toBe(1);
  expect(
    f.sql.prepare("SELECT * FROM profiles WHERE address=?").get(bob),
  ).toBeUndefined();
});
it.each(["avatar", "cover"] as const)(
  "validates %s dimensions, canonical pixels and upload limits",
  async (kind) => {
    const bytes = image(kind);
    expect((await admittedProfileImage(kind, base64(bytes))).hash).toBe(
      sha256(bytes),
    );
    for (const value of [
      "!!!!",
      base64(new TextEncoder().encode('<svg onload="alert(1)"/>')),
      base64(bytes.slice(0, -2)),
      "A".repeat(4 * Math.ceil(PROFILE_MEDIA[kind].maxBytes / 3) + 4),
    ])
      await expect(admittedProfileImage(kind, value)).rejects.toMatchObject({
        status: 400,
      });
    const header = pngChunks(bytes)[0].data.slice();
    new DataView(header.buffer).setUint32(0, 6000);
    const wrongSize = concat(
      bytes.slice(0, 8),
      chunk("IHDR", header),
      ...pngChunks(bytes)
        .slice(1)
        .map((c) => c.raw),
    );
    await expect(
      admittedProfileImage(kind, base64(wrongSize)),
    ).rejects.toMatchObject({ status: 400 });
  },
);
it.each(["zfTA", "tEXt", "iTXt"])(
  "rejects %s payloads instead of uploading or stripping secret content",
  async (type) => {
    const chunks = pngChunks(avatar);
    const unsafe = concat(
      avatar.slice(0, 8),
      ...chunks.slice(0, -1).map((c) => c.raw),
      chunk(type, new TextEncoder().encode("not public pixels")),
      chunks.at(-1)!.raw,
    );
    await expect(
      admittedProfileImage("avatar", base64(unsafe)),
    ).rejects.toMatchObject({ status: 400 });
    if (type === "zfTA")
      await expect(normalizeImage(unsafe)).rejects.toThrow(
        "Unsupported PNG chunk",
      );
  },
);
it("validates all images before upload or profile writes", async () => {
  const f = fixture();
  await expect(
    f.save(0, { avatar: { image: base64(avatar) }, cover: { image: "bad!" } }),
  ).rejects.toMatchObject({ status: 400 });
  expect(f.put).not.toHaveBeenCalled();
  expect(f.sql.prepare("SELECT COUNT(*) n FROM profiles").get()).toMatchObject({
    n: 0,
  });
});
it("returns public media through profiles, directory, discovery and distinct sharing revisions", async () => {
  const f = fixture();
  await f.save(0);
  await f.save(0, { name: "Bob" }, bob);
  await publicMutation(f.env, "/api/social", bob, {
    kind: "follow",
    target: alice,
    active: true,
  });
  const before = await snapshot(
    f.env,
    new URL(`https://devnet.zft.foo/p/${alice}`),
  );
  await f.save(1, {
    avatar: { image: base64(avatar) },
    cover: { image: base64(cover) },
  });
  const after = await snapshot(
    f.env,
    new URL(`https://devnet.zft.foo/p/${alice}`),
  );
  expect(after.profileMedia).toEqual({
    address: alice,
    avatar: sha256(avatar),
    cover: sha256(cover),
  });
  expect(after.revisionData).not.toEqual(before.revisionData);
  expect(JSON.stringify(after)).not.toContain(base64(avatar));
  const collections = await discoverCollections(
    f.env,
    new URL("https://internal/api/discovery/collections"),
  );
  expect(collections.items.find((p) => p.address === alice)).toMatchObject({
    avatar: sha256(avatar),
    cover: sha256(cover),
  });
  const people = await directory(
    f.env,
    bob,
    "following",
    new URL("https://internal"),
  );
  expect(people.profiles[0].avatar).toBe(sha256(avatar));
  const response = await profileMediaResponse(
    f.env,
    alice,
    sha256(avatar).slice(2),
  );
  expect(response.headers.get("cache-control")).toContain("immutable");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(avatar);
  await expect(
    profileMediaResponse(f.env, bob, sha256(avatar).slice(2)),
  ).rejects.toMatchObject({ status: 404 });
});
it("crops wide and tall sources at their edges with the required output dimensions", async () => {
  const source = decode(
    encode({
      width: 4,
      height: 2,
      depth: 8,
      channels: 4,
      data: new Uint8Array([
        255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0,
        0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
      ]),
    }),
  );
  for (const kind of ["avatar", "cover"] as const) {
    const left = cropProfileImage(source, kind, { x: 0, y: 0, zoom: 3 });
    const right = cropProfileImage(source, kind, { x: 100, y: 100, zoom: 3 });
    const a = decode(left),
      b = decode(right);
    expect([a.width, a.height]).toEqual([
      PROFILE_MEDIA[kind].width,
      PROFILE_MEDIA[kind].height,
    ]);
    expect([...a.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...b.data.slice(-4)]).toEqual([0, 0, 255, 255]);
    await admittedProfileImage(kind, base64(right));
    const r = cropRect(2, 8, kind, { x: 100, y: 100, zoom: 1 });
    expect(r.x + r.width).toBeCloseTo(2);
    expect(r.y + r.height).toBeCloseTo(8);
  }
  expect(() => cropRect(4, 2, "avatar", { x: -1, y: 50, zoom: 1 })).toThrow(
    "Invalid crop",
  );
});
it("adds media without changing older Worker profile insert shapes or existing data", () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync("migrations/0001_public.sql", "utf8"));
  sql
    .prepare("INSERT INTO profiles VALUES(?,?,?,NULL,1,?)")
    .run(alice, "Legacy", "", 1);
  const before = sql.prepare("SELECT * FROM profiles").all();
  sql.exec(readFileSync("migrations/0007_profile_media.sql", "utf8"));
  expect(sql.prepare("SELECT * FROM profiles").all()).toEqual(before);
  sql
    .prepare("INSERT INTO profiles VALUES(?,?,?,NULL,1,?)")
    .run(bob, "Previous Worker", "", 2);
  expect(sql.prepare("SELECT COUNT(*) n FROM profiles").get()).toMatchObject({
    n: 2,
  });
});
