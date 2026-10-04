import "fake-indexeddb/auto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { Vault } from "../packages/vault";
import { type Deployment, digest } from "../packages/protocol";
import { possessionText } from "../packages/protocol/public";
import manifest from "../packages/protocol/deployment.json";
import { api, signedRequest, ApiError } from "../apps/web/src/api";
import type { Profile } from "../packages/protocol/public";

const origin = process.env.ZFT_TEST_ORIGIN ?? "http://localhost:5173";
const htmlOrigin =
  process.env.ZFT_HTML_ORIGIN ??
  (origin === "http://localhost:5173" ? "http://localhost:8787" : origin);
const fetchNative = globalThis.fetch;
globalThis.fetch = (input, init) =>
  fetchNative(
    typeof input === "string" && input.startsWith("/") ? origin + input : input,
    {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), origin },
    },
  );
Object.defineProperty(globalThis, "location", {
  value: { origin },
  configurable: true,
});
const alice = await Vault.open(manifest as Deployment, "public-canary-alice");
const carol = await Vault.open(manifest as Deployment, "public-canary-carol");
for (const [vault, label] of [
  [alice, "alice"],
  [carol, "carol"],
] as const)
  await vault.restore(
    await readFile(`.local/canary-${label}.zft-recovery`, "utf8"),
    crypto.randomUUID(),
  );
const creator = await alice.profile(),
  collector = await carol.profile(),
  record = (await carol.items())[0];
async function publish(
  vault: Vault,
  name: string,
  bio: string,
  featured: string | null,
) {
  const account = await vault.profile();
  let revision = 0;
  try {
    revision = (
      await api<{ profile: Profile }>(`/api/profiles/${account.address}`)
    ).profile.revision;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  await signedRequest(
    "/api/profile",
    { name, bio, featured, revision },
    account,
  );
}
await publish(
  alice,
  "First Momentum",
  "A real ZFT devnet test collection. Mint a picture, keep the file, and pass it on.",
  record.tokenId,
);
await publish(
  carol,
  "Canary Collector",
  "Acceptance-test profile for file claims and public ownership proofs.",
  null,
);
const p = {
  tokenId: record.tokenId,
  owner: privateKeyToAccount(record.privateKey).address,
  nonce: record.nonce,
  expires: Math.floor(Date.now() / 1000) + 86400 * 30,
};
await signedRequest(
  "/api/possessions",
  {
    ...p,
    signature: await privateKeyToAccount(record.privateKey).signMessage({
      message: possessionText(collector.address, p),
    }),
  },
  collector,
);
for (let i = 0; i < 2; i++)
  await signedRequest(
    "/api/social",
    { kind: "follow", target: creator.address, active: true },
    collector,
  );
await signedRequest(
  "/api/social",
  { kind: "like", target: creator.address, active: true },
  collector,
);
const profile = await api<{ counts: { followers: number; likes: number } }>(
  `/api/profiles/${creator.address}`,
);
if (profile.counts.followers !== 1 || profile.counts.likes !== 1)
  throw new Error("Social retry changed counts");
const held = await api<{ items: { tokenId: string }[] }>(
  `/api/profiles/${collector.address}/collection`,
);
if (!held.items.some((i) => i.tokenId === record.tokenId))
  throw new Error("Published holding missing");
const routes = [
  "/",
  `/p/${creator.address}`,
  `/p/${collector.address}`,
  `/p/${creator.address}?nft=${record.tokenId}`,
  `/item/${record.tokenId}`,
];
const checks: unknown[] = [];
await mkdir("research/sharing", { recursive: true });
for (let i = 0; i < routes.length; i++) {
  const response = await fetchNative(htmlOrigin + routes[i]),
    html = await response.text();
  const img = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  if (
    response.status !== 200 ||
    !img ||
    [...html.matchAll(/<title>/g)].length !== 1
  )
    throw new Error("Sharing HTML failed");
  const image = await fetchNative(img),
    bytes = new Uint8Array(await image.arrayBuffer()),
    view = new DataView(bytes.buffer);
  if (
    image.status !== 200 ||
    image.headers.get("content-type") !== "image/png" ||
    view.getUint32(16) !== 1200 ||
    view.getUint32(20) !== 630 ||
    bytes.length > 1048576
  )
    throw new Error("Sharing PNG failed");
  await writeFile(`research/sharing/page-${i}.png`, bytes);
  checks.push({
    path: routes[i],
    image: img,
    bytes: bytes.length,
    width: 1200,
    height: 630,
  });
}
if (
  new Set(checks.map((c) => (c as { image: string }).image)).size !==
  routes.length
)
  throw new Error("Image cache isolation failed");
const unknown = await fetchNative(
  `${htmlOrigin}/api/og/page/home.png?v=${"0".repeat(64)}`,
);
if (unknown.status !== 404)
  throw new Error("Unknown revision generated an image");
await writeFile(
  "research/public-canary.json",
  JSON.stringify(
    {
      origin,
      at: new Date().toISOString(),
      creator: creator.address,
      collector: collector.address,
      tokenId: record.tokenId,
      checks,
      assertions: [
        "Signed profile publication",
        "Current-owner collection proof",
        "Idempotent follow retries",
        "Signed like",
        "Initial HTML and unique PNG per page",
        "Unknown image revision rejected",
      ],
    },
    null,
    2,
  ) + "\n",
);
alice.close();
carol.close();
console.log(
  "Public canary passed:",
  routes.length,
  "distinct 1200×630 PNGs, signed profiles, possession proof, follow/like idempotency.",
);
