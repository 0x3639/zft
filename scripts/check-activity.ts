// Isolated generated-wallet public-action canary; no ownership transactions.
// Only local/hosted devnet. Keys stay in ignored .local; evidence is public.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createHash } from "node:crypto";
import type { Hex } from "viem";
import { api, ApiError, signedRequest } from "../apps/web/src/api";
import type { ActivityPage } from "../packages/protocol/activity";
import type { Profile } from "../packages/protocol/public";
const origin = process.env.ZFT_TEST_ORIGIN ?? "http://localhost:5173";
if (!["http://localhost:5173", "https://devnet.zft.foo"].includes(origin))
  throw new Error("Use local or hosted devnet only.");
const prefix = origin.startsWith("https") ? "hosted" : "local",
  nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  nativeFetch(
    typeof input === "string" && input.startsWith("/") ? origin + input : input,
    {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        Origin: origin,
      },
    },
  );
Object.defineProperty(globalThis, "location", {
  value: { origin },
  configurable: true,
});
await mkdir(".local", { recursive: true, mode: 0o700 });
const file = `.local/${prefix}-activity-keys.json`;
let keys: { a: Hex; b: Hex };
try {
  keys = JSON.parse(await readFile(file, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  keys = { a: generatePrivateKey(), b: generatePrivateKey() };
  await writeFile(file, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
}
const a = privateKeyToAccount(keys.a),
  b = privateKeyToAccount(keys.b);
async function saveProfile(account: typeof a, name: string, bio: string) {
  let revision = 0;
  try {
    revision = (
      await api<{ profile: Profile }>(`/api/profiles/${account.address}`)
    ).profile.revision;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  return signedRequest(
    "/api/profile",
    { name, bio, featured: null, revision },
    account,
  );
}
for (const [account, label] of [
  [a, "A"],
  [b, "B"],
] as const)
  await saveProfile(
    account,
    `Activity fixture ${label}`,
    "Generated ZFT devnet acceptance profile. No monetary value.",
  );
const feed = (query = "") => api<ActivityPage>(`/api/activity?${query}`);
const personal = (account: typeof a) =>
  api<ActivityPage>(`/api/profiles/${account.address}/activity`);
const action = (kind: "follow" | "like", active: boolean) =>
  signedRequest("/api/social", { target: b.address, kind, active }, a);
await action("follow", false);
await action("like", false);
assert.equal((await feed("view=following")).state, "guest");
assert.equal(
  (await feed(`view=following&viewer=${a.address}`)).state,
  "no-follows",
);
for (const kind of ["follow", "like"] as const) {
  const before = (await personal(a)).events.map((e) => e.id);
  await action(kind, true);
  const first = (await personal(a)).events;
  assert(
    first.some((e) => e.kind === kind && !before.includes(e.id)),
    `${kind} did not append an event`,
  );
  await action(kind, true);
  assert.deepEqual(
    (await personal(a)).events.map((e) => e.id),
    first.map((e) => e.id),
    `${kind} retry duplicated a journal event`,
  );
}
const following = await feed(`view=following&viewer=${a.address}`);
assert.equal(following.state, "ready");
assert(following.events.length > 0);
assert(
  following.events.every((e) => e.actor?.address === b.address.toLowerCase()),
);
await action("follow", false);
await action("like", false);
const history = await personal(a);
assert(history.events.some((e) => e.kind === "unfollow"));
assert(history.events.some((e) => e.kind === "unlike"));
await action("follow", true);
await saveProfile(
  b,
  "Activity fixture B",
  "Updated by the activity acceptance canary. Public profile action only.",
);
const seen = new Set<string>();
let cursor: string | null = null;
let pageCount = 0;
do {
  const page = await feed(
    `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  assert(
    page.nextCursor === null || page.nextCursor !== cursor,
    "Pagination cursor did not advance",
  );
  for (const e of page.events) {
    assert(!seen.has(e.id), "Duplicate page row");
    seen.add(e.id);
    if (e.source === "chain") {
      assert(e.chain);
      assert(e.item);
      assert(e.occurredAt, "Wait for event-time backfill and retry");
      if (e.kind === "transferred") assert.equal(e.actor, null);
    }
  }
  cursor = page.nextCursor;
  pageCount++;
  assert(pageCount < 100, "Unexpectedly large canary dataset");
} while (cursor);
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  origin,
  profiles: { a: a.address, b: b.address },
  events: seen.size,
  pages: pageCount,
  checks: [
    "Generated-wallet signed profile/social actions accepted",
    "Guest and zero-follow states differ",
    "Repeated follow/like requests append exactly one event",
    "Reversals stay in the journal",
    "Following includes only followed actors",
    "Deterministic pagination returns no duplicate IDs",
    "Chain events have real timestamps; transfers claim no human actor",
  ],
  limitations: [
    "SDK signer fixture, not an actual MetaMask extension",
    "Publication/unpublish and reorg races covered in local SQLite tests",
  ],
};
if (prefix === "hosted") {
  const html = await readFile("dist/web/index.html", "utf8"),
    entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)![1];
  for (const path of [
    "/activity",
    "/activity?view=following",
    `/p/${b.address.toLowerCase()}?tab=activity`,
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    const content = await response.text();
    assert(content.includes(entry));
    if (path.startsWith("/activity"))
      assert(content.includes("Around the network."));
  }
  const remote = new Uint8Array(
      await (await fetch(origin + entry)).arrayBuffer(),
    ),
    local = await readFile("dist/web" + entry),
    hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
  assert.equal(hash(remote), hash(local));
  report.entry = entry;
  report.assetSha256 = hash(remote);
}
await writeFile(
  `research/${prefix}-activity.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
