import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { database } from "./d1";
import { activity } from "../apps/api/activity";
import { publicMutation } from "../apps/api/public";
import { projectDiscovery } from "../apps/api/discovery";
import { projectEventTimes } from "../apps/api/index-store";
import { digest, type Metadata } from "../packages/protocol";
import type { Env } from "../apps/api/types";
const addr = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const url = (params: Record<string, string> = {}) =>
  new URL(`https://internal/api/activity?${new URLSearchParams(params)}`);
function fixture() {
  const { db, sql } = database(),
    objects = new Map<string, string>();
  const env = {
    DB: db,
    MEDIA: {
      get: async (key: string) =>
        objects.has(key)
          ? { json: async () => JSON.parse(objects.get(key)!) }
          : null,
    },
  } as unknown as Env;
  async function profile(n: number, revision = 0, name = `Person ${n}`) {
    return publicMutation(env, "/api/profile", addr(n), {
      name,
      bio: "",
      featured: null,
      revision,
    });
  }
  function relation(
    actor: number,
    target: number,
    kind = "follow",
    active = true,
  ) {
    return publicMutation(env, "/api/social", addr(actor), {
      kind,
      target: addr(target),
      active,
    });
  }
  async function mint(
    id: number,
    owner = addr(1),
    hash = `block${id}`,
    creator = addr(1),
  ) {
    const imageHash = `0x${id.toString(16).padStart(64, "0")}` as `0x${string}`;
    const m: Metadata = {
      name: `Art ${id}`,
      description: "",
      creator,
      image: `https://zft.foo/art/${imageHash.slice(2)}.png`,
      imageHash,
      canonicalizer: "zft-png/1",
      mediaType: "image/png",
      width: 1,
      height: 1,
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const metadataHash = digest(m);
    objects.set(`metadata/${metadataHash.slice(2)}.json`, JSON.stringify(m));
    sql
      .prepare("INSERT INTO chain_events VALUES(?,0,?,?,?,?,?,?,?,?)")
      .run(
        id,
        hash,
        `tx${id}`,
        "Minted",
        String(id),
        null,
        null,
        creator,
        metadataHash,
      );
    sql
      .prepare("INSERT INTO chain_events VALUES(?,1,?,?,?,?,?,?,?,?)")
      .run(
        id,
        hash,
        `tx${id}`,
        "Transfer",
        String(id),
        addr(0),
        owner,
        null,
        null,
      );
    while (await projectDiscovery(env)) {}
  }
  function publish(id: number, nonce = "0", owner = addr(1)) {
    sql
      .prepare(
        "INSERT INTO possessions VALUES(?,?,?,?,?,?,?) ON CONFLICT(profile,token_id,nonce) DO UPDATE SET signature=excluded.signature,expires=excluded.expires",
      )
      .run(
        addr(2),
        String(id),
        owner,
        nonce,
        "sig",
        Math.floor(Date.now() / 1000) + 60,
        Date.now(),
      );
  }
  return { env, db, sql, objects, profile, relation, mint, publish };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("Public activity journal", () => {
  it("records only real transitions, retains explicit reversals, and rejects stale profile retries", async () => {
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    await expect(f.profile(1)).rejects.toThrow("Profile changed");
    await f.profile(1, 1); // Identical edit has no activity row.
    await f.profile(1, 2, "Updated person");
    for (const kind of ["follow", "like"]) {
      await f.relation(1, 2, kind);
      await f.relation(1, 2, kind);
      await f.relation(1, 2, kind, false);
      await f.relation(1, 2, kind, false);
    }
    const page = await activity(f.env, url());
    expect(page.events.map((e) => e.kind).sort()).toEqual(
      [
        "follow",
        "like",
        "profile_created",
        "profile_created",
        "profile_updated",
        "unfollow",
        "unlike",
      ].sort(),
    );
    expect(page.events.find((e) => e.kind === "follow")?.target).toEqual({
      address: addr(2),
      name: "Person 2",
    });
    expect(page.events.find((e) => e.kind === "follow")?.actor?.name).toBe(
      "Updated person",
    );
    expect(
      f.sql.prepare("SELECT COUNT(*) n FROM relations").get(),
    ).toMatchObject({ n: 0 });
    const ids = f.sql
      .prepare(
        "SELECT id,kind FROM public_events WHERE kind IN ('follow','unfollow') ORDER BY occurred_at,id",
      )
      .all();
    expect(ids.map((e) => e.kind)).toEqual(["follow", "unfollow"]);
  });
  it("rolls back the state change when its journal write fails", async () => {
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    f.sql.exec(
      "CREATE TRIGGER reject_event BEFORE INSERT ON public_events BEGIN SELECT RAISE(ABORT,'journal unavailable'); END;",
    );
    await expect(f.relation(1, 2)).rejects.toThrow("journal unavailable");
    expect(
      f.sql.prepare("SELECT COUNT(*) n FROM relations").get(),
    ).toMatchObject({ n: 0 });
    await expect(f.profile(1, 1, "Lost update")).rejects.toThrow(
      "journal unavailable",
    );
    expect(
      f.sql
        .prepare("SELECT name,revision FROM profiles WHERE address=?")
        .get(addr(1)),
    ).toMatchObject({ name: "Person 1", revision: 1 });
  });
  it("distinguishes guest, zero-follow and empty-following and filters before pagination", async () => {
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    await f.profile(3);
    expect((await activity(f.env, url({ view: "following" }))).state).toBe(
      "guest",
    );
    expect(
      (await activity(f.env, url({ view: "following", viewer: addr(1) })))
        .state,
    ).toBe("no-follows");
    await f.relation(1, 2);
    const page = await activity(
      f.env,
      url({ view: "following", viewer: addr(1), limit: "1" }),
    );
    expect(page.events).toHaveLength(1);
    expect(page.events[0].actor?.address).toBe(addr(2));
    expect(page.nextCursor).toBeNull();
    // A follow imported from before journal installation has no invented history.
    f.sql.exec("DELETE FROM public_events WHERE actor='" + addr(2) + "'");
    expect(
      await activity(f.env, url({ view: "following", viewer: addr(1) })),
    ).toMatchObject({ state: "ready", events: [] });
    const own = await activity(f.env, url(), addr(2));
    expect(own.events.map((e) => e.kind)).toEqual(["follow"]); // Includes actions targeting this profile.
  });
  it("uses a high-water mark and deterministic ties so appends cannot duplicate or skip older public events", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1791194000000);
    const f = fixture();
    for (let n = 1; n <= 7; n++) await f.profile(n);
    const first = await activity(f.env, url({ limit: "2" }));
    await f.profile(8);
    const events = [...first.events];
    let next = first.nextCursor;
    while (next) {
      const p = await activity(f.env, url({ limit: "2", cursor: next }));
      events.push(...p.events);
      next = p.nextCursor;
    }
    expect(events).toHaveLength(7);
    expect(new Set(events.map((e) => e.id)).size).toBe(7);
    expect(events.map((e) => e.actor?.address)).toEqual(
      [7, 6, 5, 4, 3, 2, 1].map(addr),
    );
    expect((await activity(f.env, url())).events).toHaveLength(8);
    vi.restoreAllMocks();
  });
  it("bounds and scopes cursors, and refreshes when follows or visibility change", async () => {
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    await f.profile(2, 1, "New name");
    await f.relation(1, 2);
    const first = await activity(
      f.env,
      url({ view: "following", viewer: addr(1), limit: "1" }),
    );
    expect(first.nextCursor).toBeTruthy();
    await expect(
      activity(f.env, url({ cursor: first.nextCursor! })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      activity(
        f.env,
        url({ view: "following", viewer: addr(3), cursor: first.nextCursor! }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await f.relation(1, 2, "follow", false);
    await expect(
      activity(
        f.env,
        url({ view: "following", viewer: addr(1), cursor: first.nextCursor! }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    for (const params of [
      { cursor: "bad" },
      { cursor: "a".repeat(2050) },
      { view: "bad" },
      { limit: "0" },
      { limit: "25" },
      { limit: "1e1" },
    ] as Record<string, string>[])
      await expect(activity(f.env, url(params))).rejects.toMatchObject({
        status: 400,
      });
    const page = await activity(f.env, url({ limit: "1" }));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300001);
    await expect(
      activity(f.env, url({ cursor: page.nextCursor! })),
    ).rejects.toMatchObject({ status: 409 });
    clock.mockRestore();
  });
  it("keeps publication renewal idempotent and permanently hides withdrawn generations", async () => {
    const f = fixture();
    await f.profile(2);
    await f.mint(1);
    f.publish(1);
    f.publish(1);
    let page = await activity(f.env, url({ limit: "1" }));
    const id = page.events[0].id;
    expect(page.events[0]).toMatchObject({
      kind: "published",
      item: { href: `/p/${addr(2)}?nft=1&epoch=0` },
    });
    expect(
      f.sql
        .prepare("SELECT COUNT(*) n FROM public_events WHERE kind='published'")
        .get(),
    ).toMatchObject({ n: 1 });
    await publicMutation(f.env, "/api/unpublish", addr(2), { tokenId: "1" });
    await expect(
      activity(f.env, url({ cursor: page.nextCursor! })),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await activity(f.env, url(), addr(2))).events.some((e) => e.item),
    ).toBe(false);
    f.publish(1);
    page = await activity(f.env, url());
    expect(page.events.filter((e) => e.kind === "published")).toHaveLength(1);
    expect(page.events.some((e) => e.id === id)).toBe(false);
    expect(
      f.sql
        .prepare("SELECT COUNT(*) n FROM public_events WHERE kind='published'")
        .get(),
    ).toMatchObject({ n: 2 });
  });
  it("keeps pagination valid across live proof renewals", async () => {
    const f = fixture();
    await f.profile(2);
    await f.mint(1);
    f.publish(1);
    const first = await activity(f.env, url({ limit: "1" }));
    expect(first.nextCursor).toBeTruthy();
    f.sql.exec("UPDATE possessions SET signature='renewed',expires=expires+60");
    const next = await activity(f.env, url({ cursor: first.nextCursor! }));
    expect(next.events.some((e) => e.id === first.events[0].id)).toBe(false);
    expect(next.events.length).toBeGreaterThan(0);
  });
  it.each(["profile", "following"])(
    "ignores unrelated publication changes in a %s snapshot",
    async (scope) => {
      const f = fixture();
      for (let n = 1; n <= 3; n++) await f.profile(n);
      await f.profile(1, 1, "Edited");
      await f.relation(3, 1);
      await f.mint(1);
      await f.mint(2);
      f.publish(1); // Profile 2's existing publication is inside publicMax.
      const params: Record<string, string> =
        scope === "following" ? { view: "following", viewer: addr(3) } : {};
      const profile = scope === "profile" ? addr(1) : undefined;
      const first = await activity(
        f.env,
        url({ ...params, limit: "1" }),
        profile,
      );
      expect(first.nextCursor).toBeTruthy();
      const oldRevision = Number(
        f.sql.prepare("SELECT revision FROM activity_state").get()!.revision,
      );
      const continuation = () =>
        activity(f.env, url({ ...params, cursor: first.nextCursor! }), profile);
      const expected = await continuation();
      f.sql.exec("UPDATE possessions SET expires=expires-10");
      expect(await continuation()).toEqual(expected);
      f.sql.exec("DELETE FROM possessions");
      expect(await continuation()).toEqual(expected);
      f.publish(1); // A replacement generation must not revive the old event.
      f.publish(2);
      expect(await continuation()).toEqual(expected);
      expect(
        f.sql.prepare("SELECT revision FROM activity_state").get()!.revision,
      ).toBeGreaterThan(oldRevision); // Preserve preceding-Worker invalidation.
    },
  );
  it.each(["everyone", "profile", "following"])(
    "ignores publications added after the %s snapshot's public-ID bound",
    async (scope) => {
      const f = fixture();
      await f.profile(2);
      await f.profile(2, 1, "Edited");
      await f.profile(3);
      await f.relation(3, 2);
      await f.mint(1);
      const params: Record<string, string> =
        scope === "following" ? { view: "following", viewer: addr(3) } : {};
      const profile = scope === "profile" ? addr(2) : undefined;
      const first = await activity(
        f.env,
        url({ ...params, limit: "1" }),
        profile,
      );
      expect(first.nextCursor).toBeTruthy();
      const continuation = () =>
        activity(f.env, url({ ...params, cursor: first.nextCursor! }), profile);
      const expected = await continuation();
      f.publish(1);
      expect(await continuation()).toEqual(expected);
      expect(
        (await activity(f.env, url(params), profile)).events.some(
          (e) => e.kind === "published",
        ),
      ).toBe(true);
      f.sql.exec("UPDATE possessions SET owner='" + addr(3) + "'");
      expect(await continuation()).toEqual(expected);
      f.sql.exec("DELETE FROM possessions");
      expect(await continuation()).toEqual(expected);
    },
  );
  it.each(["everyone", "profile", "following"])(
    "refreshes %s when a bound publication changes or is withdrawn",
    async (scope) => {
      const f = fixture();
      await f.profile(2);
      await f.profile(2, 1, "Edited");
      await f.profile(3);
      await f.relation(3, 2);
      await f.mint(1);
      f.publish(1);
      const params: Record<string, string> =
        scope === "following" ? { view: "following", viewer: addr(3) } : {};
      const profile = scope === "profile" ? addr(2) : undefined;
      for (const write of [
        "UPDATE possessions SET expires=expires-10",
        "DELETE FROM possessions",
      ]) {
        const first = await activity(
          f.env,
          url({ ...params, limit: "1" }),
          profile,
        );
        expect(first.nextCursor).toBeTruthy();
        f.sql.exec(write);
        await expect(
          activity(
            f.env,
            url({ ...params, cursor: first.nextCursor! }),
            profile,
          ),
        ).rejects.toMatchObject({ status: 409 });
      }
      expect(
        (await activity(f.env, url(params), profile)).events.some(
          (e) => e.kind === "published",
        ),
      ).toBe(false);
    },
  );
  it("keeps pagination valid across unsuccessful metadata retries", async () => {
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    await f.mint(1);
    f.objects.clear();
    f.sql.exec("UPDATE discovery_metadata SET valid=0,retry_at=0");
    await projectDiscovery(f.env); // First invalid result becomes the baseline.
    const first = await activity(f.env, url({ limit: "1" }));
    f.sql.exec("UPDATE discovery_metadata SET retry_at=0");
    await projectDiscovery(f.env);
    expect(
      (await activity(f.env, url({ cursor: first.nextCursor! }))).events,
    ).toHaveLength(1);
  });
  it("keeps an Everyone snapshot when newly minted artwork is indexed beyond its bounds", async () => {
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    const first = await activity(f.env, url({ limit: "1" }));
    const oldRevision = Number(
      f.sql.prepare("SELECT revision FROM activity_state").get()!.revision,
    );
    await f.mint(1);
    // The preceding Worker still gets its conservative invalidation on rollback.
    expect(
      f.sql.prepare("SELECT revision FROM activity_state").get()!.revision,
    ).toBeGreaterThan(oldRevision);
    const next = await activity(f.env, url({ cursor: first.nextCursor! }));
    expect(next.events).toHaveLength(1);
    expect(next.events[0].source).toBe("public");
    expect(next.events[0].id).not.toBe(first.events[0].id);
    expect(next.nextCursor).toBeNull();
    expect(
      (await activity(f.env, url())).events.some((e) => e.kind === "minted"),
    ).toBe(true);
  });
  it.each(["profile", "following"])(
    "ignores other creators' metadata backfill in %s activity",
    async (scope) => {
      const f = fixture();
      for (let n = 1; n <= 3; n++) await f.profile(n);
      await f.relation(3, 1);
      await f.mint(1, addr(2), "block1", addr(2));
      await f.mint(10); // Both tokens are within the pinned block range.
      f.sql.exec("DELETE FROM discovery_metadata WHERE token_id='1'");
      const params: Record<string, string> =
        scope === "following" ? { view: "following", viewer: addr(3) } : {};
      const profile = scope === "profile" ? addr(1) : undefined;
      const first = await activity(
        f.env,
        url({ ...params, limit: "1" }),
        profile,
      );
      expect(first.nextCursor).toBeTruthy();
      await projectDiscovery(f.env);
      const next = await activity(
        f.env,
        url({ ...params, cursor: first.nextCursor! }),
        profile,
      );
      expect(next.events.length).toBeGreaterThan(0);
      expect(next.events.every((e) => e.item?.tokenId !== "1")).toBe(true);
    },
  );
  it.each(["everyone", "profile", "following"])(
    "refreshes %s when metadata reveals or removes a publication in its snapshot",
    async (scope) => {
      const f = fixture();
      await f.profile(2);
      await f.profile(2, 1, "Edited");
      await f.profile(3);
      await f.relation(3, 2);
      await f.mint(1); // Creator 1 is outside profile 2 / Following scope.
      f.publish(1); // Profile 2's publication still makes its metadata relevant.
      f.sql.exec("DELETE FROM discovery_metadata");
      const params: Record<string, string> =
        scope === "following" ? { view: "following", viewer: addr(3) } : {};
      const profile = scope === "profile" ? addr(2) : undefined;
      const missing = await activity(
        f.env,
        url({ ...params, limit: "1" }),
        profile,
      );
      expect(missing.nextCursor).toBeTruthy();
      await projectDiscovery(f.env);
      await expect(
        activity(
          f.env,
          url({ ...params, cursor: missing.nextCursor! }),
          profile,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const visible = await activity(
        f.env,
        url({ ...params, limit: "1" }),
        profile,
      );
      expect(visible.nextCursor).toBeTruthy();
      f.sql.exec("DELETE FROM discovery_metadata");
      await expect(
        activity(
          f.env,
          url({ ...params, cursor: visible.nextCursor! }),
          profile,
        ),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
  it.each([1, 2])(
    "offers a refresh for version-%i cursors after the publication-scope upgrade",
    async (version) => {
      const f = fixture();
      await f.profile(1);
      await f.profile(2);
      const first = await activity(f.env, url({ limit: "1" }));
      const decoded = JSON.parse(
        Buffer.from(first.nextCursor!, "base64url").toString(),
      );
      expect(decoded.v).toBe(3);
      delete decoded.publicationRevision;
      if (version === 1) delete decoded.metadataRevision;
      decoded.v = version;
      const legacy = Buffer.from(JSON.stringify(decoded)).toString("base64url");
      await expect(
        activity(f.env, url({ cursor: legacy })),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
  it.each([
    "UPDATE possessions SET expires=expires-10",
    "UPDATE possessions SET owner='" + addr(3) + "'",
    "UPDATE discovery_metadata SET valid=0",
    "UPDATE discovery_metadata SET version=2",
    "UPDATE discovery_metadata SET metadata_json=json_set(metadata_json,'$.name','Changed')",
  ])("still invalidates visibility-changing writes: %s", async (write) => {
    const f = fixture();
    await f.profile(2);
    await f.mint(1);
    f.publish(1);
    const first = await activity(f.env, url({ limit: "1" }));
    expect(first.nextCursor).toBeTruthy();
    f.sql.exec(write);
    await expect(
      activity(f.env, url({ cursor: first.nextCursor! })),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("invalidates when renewal makes an expired publication visible again", async () => {
    const f = fixture();
    await f.profile(2);
    await f.mint(1);
    f.publish(1);
    f.sql.exec("UPDATE possessions SET expires=0");
    const first = await activity(f.env, url({ limit: "1" }));
    expect(first.nextCursor).toBeTruthy();
    f.publish(1);
    await expect(
      activity(f.env, url({ cursor: first.nextCursor! })),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await activity(f.env, url())).events.some((e) => e.kind === "published"),
    ).toBe(true);
  });
  it.each(["profile", "following"])(
    "ignores unrelated publication expiry in the %s feed",
    async (scope) => {
      const f = fixture();
      await f.profile(1);
      await f.profile(1, 1, "Edited");
      await f.profile(2);
      await f.profile(3);
      await f.mint(1);
      f.publish(1); // Profile 2's publication is outside both feeds.
      await f.relation(3, 1);
      const params: Record<string, string> =
        scope === "following" ? { view: "following", viewer: addr(3) } : {};
      const profile = scope === "profile" ? addr(1) : undefined;
      const first = await activity(
        f.env,
        url({ ...params, limit: "1" }),
        profile,
      );
      expect(first.nextCursor).toBeTruthy();
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
      expect(
        (
          await activity(
            f.env,
            url({ ...params, cursor: first.nextCursor! }),
            profile,
          )
        ).events.length,
      ).toBeGreaterThan(0);
    },
  );
  it("ignores expiry on legacy possessions without a publication event", async () => {
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    await f.mint(1);
    // Simulate a possession retained from before the journal migration.
    f.sql.exec("DROP TRIGGER activity_publication_insert");
    f.publish(1);
    const first = await activity(f.env, url({ limit: "1" }));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    expect(
      (await activity(f.env, url({ cursor: first.nextCursor! }))).events.length,
    ).toBeGreaterThan(0);
  });
  it("shows historical published epochs but suppresses expired, reverted and replacement-mint associations", async () => {
    const f = fixture();
    await f.profile(2);
    await f.mint(1);
    f.publish(1);
    f.sql
      .prepare("INSERT INTO chain_events VALUES(2,0,?,?,?,?,?,?,?,?)")
      .run("fork", "tx2", "Transfer", "1", addr(1), addr(3), null, null);
    expect(
      (await activity(f.env, url(), addr(2))).events.some(
        (e) => e.kind === "published",
      ),
    ).toBe(true);
    f.publish(1, "1", addr(3));
    expect(
      (await activity(f.env, url(), addr(2))).events.filter(
        (e) => e.kind === "published",
      ),
    ).toHaveLength(2);
    const first = await activity(f.env, url({ limit: "1" }));
    f.sql.exec("DELETE FROM chain_events WHERE block_number=2");
    await expect(
      activity(f.env, url({ cursor: first.nextCursor! })),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await activity(f.env, url(), addr(2))).events.filter(
        (e) => e.kind === "published",
      ),
    ).toHaveLength(1);
    f.sql.exec("DELETE FROM chain_events");
    await f.mint(1, addr(1), "replacement");
    expect(
      (await activity(f.env, url(), addr(2))).events.some(
        (e) => e.kind === "published",
      ),
    ).toBe(false);
  });
  it("never promotes raw transfers into social actions or duplicates mint Transfers", async () => {
    const f = fixture();
    await f.profile(1);
    await f.profile(2);
    await f.mint(1);
    f.sql
      .prepare("INSERT INTO chain_events VALUES(2,0,?,?,?,?,?,?,?,?)")
      .run("block2", "tx2", "Transfer", "1", addr(1), addr(2), null, null);
    const page = await activity(f.env, url());
    expect(page.events.filter((e) => e.source === "chain")).toHaveLength(2);
    expect(page.events.find((e) => e.kind === "transferred")).toMatchObject({
      actor: null,
      target: null,
      item: { href: "/item/1" },
      occurredAt: null,
    });
    expect(
      (await activity(f.env, url(), addr(2))).events.some(
        (e) => e.source === "chain",
      ),
    ).toBe(false);
    await f.relation(2, 1);
    const followed = await activity(
      f.env,
      url({ view: "following", viewer: addr(2) }),
    );
    expect(followed.events.some((e) => e.kind === "minted")).toBe(true);
    expect(followed.events.some((e) => e.kind === "transferred")).toBe(false);
    f.sql.exec("UPDATE discovery_metadata SET valid=0");
    expect((await activity(f.env, url())).events.some((e) => e.item)).toBe(
      false,
    );
  });
  it("backfills real block times only after checking hash, with bounded work and fork cleanup", async () => {
    const f = fixture();
    for (let n = 1; n <= 9; n++) await f.mint(n);
    const client = {
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
        hash: `block${blockNumber}`,
        timestamp: 1791000000n + blockNumber,
      })),
    } as unknown as Parameters<typeof projectEventTimes>[1];
    expect(await projectEventTimes(f.db, client)).toBe(true);
    expect(
      f.sql.prepare("SELECT COUNT(*) n FROM chain_event_times").get(),
    ).toMatchObject({ n: 8 });
    expect(await projectEventTimes(f.db, client)).toBe(false);
    expect(
      (await activity(f.env, url())).events.find((e) => e.item?.tokenId === "1")
        ?.occurredAt,
    ).toBe(1791000001000);
    f.sql.exec("DELETE FROM chain_events WHERE block_number=1");
    expect(
      f.sql
        .prepare("SELECT * FROM chain_event_times WHERE block_number=1")
        .get(),
    ).toBeUndefined();
    await f.mint(1, addr(1), "fork");
    await expect(projectEventTimes(f.db, client)).rejects.toThrow(
      "Event block changed",
    );
    expect(
      f.sql
        .prepare("SELECT * FROM chain_event_times WHERE block_number=1")
        .get(),
    ).toBeUndefined();
  });
  it("expires publication activity and rejects a page that crosses its expiry", async () => {
    const f = fixture();
    await f.profile(2);
    await f.mint(1);
    f.publish(1);
    const page = await activity(f.env, url({ limit: "1" }));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61000);
    try {
      await expect(
        activity(f.env, url({ cursor: page.nextCursor! })),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await activity(f.env, url())).events.some(
          (e) => e.kind === "published",
        ),
      ).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });
  it.each(["visibility", "metadata", "publication"])(
    "rejects results if %s changes while a page is being read",
    async (change) => {
      const f = fixture();
      await f.profile(1);
      await f.mint(1);
      f.publish(1);
      const original = f.db.prepare.bind(f.db);
      vi.spyOn(f.db, "prepare").mockImplementation((query: string) => {
        const statement = original(query);
        if (query.startsWith("WITH feed")) {
          const bind = statement.bind.bind(statement);
          statement.bind = (...values: unknown[]) => {
            const bound = bind(...values),
              all = bound.all.bind(bound);
            bound.all = async <T = Record<string, unknown>>() => {
              const result = await all<T>();
              f.sql.exec(
                change === "metadata"
                  ? "UPDATE discovery_metadata SET valid=0"
                  : change === "publication"
                    ? "DELETE FROM possessions"
                    : "UPDATE activity_state SET revision=revision+1",
              );
              return result;
            };
            return bound;
          };
        }
        return statement;
      });
      await expect(activity(f.env, url())).rejects.toMatchObject({
        status: 409,
      });
    },
  );
  it("does not backfill fictional social history and permits the preceding Worker insert shape", () => {
    const sql = new DatabaseSync(":memory:");
    for (const migration of ["0001_public.sql", "0002_discovery.sql"])
      sql.exec(readFileSync(`migrations/${migration}`, "utf8"));
    sql
      .prepare("INSERT INTO profiles VALUES(?,?,?,NULL,1,?)")
      .run(addr(1), "Old", "", Date.now());
    sql
      .prepare("INSERT INTO relations VALUES(?,?,?,?)")
      .run(addr(1), "follow", addr(2), Date.now());
    sql.exec(readFileSync("migrations/0003_activity.sql", "utf8"));
    expect(
      sql.prepare("SELECT COUNT(*) n FROM public_events").get(),
    ).toMatchObject({ n: 0 });
    sql
      .prepare("INSERT INTO profiles VALUES(?,?,?,NULL,1,?)")
      .run(addr(2), "New", "", Date.now());
    expect(sql.prepare("SELECT kind FROM public_events").get()).toMatchObject({
      kind: "profile_created",
    });
    sql
      .prepare("INSERT INTO possessions VALUES(?,?,?,?,?,?,?)")
      .run(
        addr(2),
        "1",
        addr(1),
        "0",
        "sig",
        Math.floor(Date.now() / 1000) + 60,
        Date.now(),
      );
    const tables = ["public_events", "activity_publications", "possessions"];
    const before = tables.map((table) =>
      sql.prepare(`SELECT * FROM ${table}`).all(),
    );
    sql.exec(readFileSync("migrations/0004_activity_invalidation.sql", "utf8"));
    sql.exec(
      readFileSync("migrations/0005_activity_metadata_scope.sql", "utf8"),
    );
    sql.exec(
      readFileSync("migrations/0006_activity_publication_scope.sql", "utf8"),
    );
    expect(
      tables.map((table) => sql.prepare(`SELECT * FROM ${table}`).all()),
    ).toEqual(before);
    sql
      .prepare("INSERT INTO profiles VALUES(?,?,?,NULL,1,?)")
      .run(addr(3), "Still compatible", "", Date.now());
    expect(
      sql.prepare("SELECT COUNT(*) n FROM public_events").get(),
    ).toMatchObject({ n: 3 });
  });
});
