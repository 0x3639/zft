// Generated-wallet signed profile actions only; no ownership transactions.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256, type Hex } from "viem";
import { decode, encode } from "fast-png";
import { api, ApiError, signedRequest } from "../apps/web/src/api";
import { base64 } from "../packages/vault";
import {
  PROFILE_MEDIA,
  profileMediaURL,
} from "../packages/protocol/profile-media";
import type { Profile } from "../packages/protocol/public";
const origin = process.env.ZFT_TEST_ORIGIN ?? "http://localhost:5173";
assert(["http://localhost:5173", "https://devnet.zft.foo"].includes(origin));
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
const path = `.local/${prefix}-profile-media-key.json`;
let key: Hex;
try {
  key = JSON.parse(await readFile(path, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  key = generatePrivateKey();
  await writeFile(path, JSON.stringify(key), { mode: 0o600, flag: "wx" });
}
const account = privateKeyToAccount(key);
const images = {} as Record<"avatar" | "cover", Uint8Array>;
for (const kind of ["avatar", "cover"] as const) {
  const { width, height } = PROFILE_MEDIA[kind],
    data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const stripe = (x + y * 2) % 160 < 40;
      data.set(
        stripe
          ? [0, 217, 148, 255]
          : [
              12 + Math.floor((x / width) * 15),
              30 + Math.floor((y / height) * 35),
              42,
              255,
            ],
        (y * width + x) * 4,
      );
    }
  images[kind] = encode({ width, height, data, depth: 8, channels: 4 });
  await writeFile(`.local/profile-${kind}.png`, images[kind]);
}
let revision = 0;
try {
  revision = (
    await api<{ profile: Profile }>(`/api/profiles/${account.address}`)
  ).profile.revision;
} catch (e) {
  if (!(e instanceof ApiError && e.status === 404)) throw e;
}
const save = (changes: Record<string, unknown>, expected = revision) =>
  signedRequest<{ profile: Profile }>(
    "/api/profile",
    {
      name: "Profile media fixture",
      bio: "Generated devnet acceptance profile. Public test pixels only.",
      featured: null,
      revision: expected,
      ...changes,
    },
    account,
  );
const initial = await save({ avatar: null, cover: null });
revision = initial.profile.revision;
const firstRevision = revision;
const updated = await save({
  avatar: { image: base64(images.avatar) },
  cover: { image: base64(images.cover) },
});
revision = updated.profile.revision;
for (const kind of ["avatar", "cover"] as const) {
  assert.equal(updated.profile[kind], sha256(images[kind]));
  const response = await fetch(
    profileMediaURL(account.address, updated.profile[kind])!,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control")!, /immutable/);
  assert.equal(
    sha256(new Uint8Array(await response.arrayBuffer())),
    updated.profile[kind],
  );
}
await assert.rejects(
  save({ avatar: null }, firstRevision),
  (e: unknown) => e instanceof ApiError && e.status === 409,
);
const kept = await save({}); // Preceding clients omit media.
revision = kept.profile.revision;
assert.equal(kept.profile.avatar, updated.profile.avatar);
assert.equal(kept.profile.cover, updated.profile.cover);
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  origin,
  address: account.address,
  profile: kept.profile,
  checks: [
    "Single signed request saves both images",
    "Immutable public PNG bytes match admitted hashes",
    "Stale save returns 409",
    "Older-client omission preserves both references",
  ],
  limitations: [
    "Generated SDK signer, not an actual MetaMask extension",
    "No ownership transactions",
  ],
};
if (prefix === "hosted") {
  const ogURL = async () => {
    const html = await (await fetch(`/p/${account.address}`)).text();
    return html
      .match(/property="og:image" content="([^"]+)"/)![1]
      .replaceAll("&amp;", "&");
  };
  const before = await ogURL();
  const fetchOG = async (url: string) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(bytes.length > 0 && bytes.length <= 1_048_576);
    const image = decode(bytes);
    assert.equal(image.width, 1200);
    assert.equal(image.height, 630);
    return { bytes, image };
  };
  const { bytes, image } = await fetchOG(before);
  await writeFile("research/r4-profile-og.png", bytes);
  const reset = await save({ avatar: null, cover: null });
  revision = reset.profile.revision;
  assert.equal(reset.profile.avatar, null);
  assert.equal(reset.profile.cover, null);
  const after = await ogURL();
  assert.notEqual(after, before);
  const resetImage = await fetchOG(after);
  assert.notDeepEqual(resetImage.image.data, image.data);
  const retainedImage = await fetchOG(before);
  assert.deepEqual(retainedImage.bytes, bytes);
  const restored = await save({
    avatar: { image: base64(images.avatar) },
    cover: { image: base64(images.cover) },
  });
  report.profile = restored.profile;
  report.og = {
    before,
    afterReset: after,
    bytes: bytes.length,
    width: image.width,
    height: image.height,
    sha256: sha256(bytes),
    reset: {
      bytes: resetImage.bytes.length,
      width: resetImage.image.width,
      height: resetImage.image.height,
      sha256: sha256(resetImage.bytes),
      pixelsChanged: true,
    },
    retainedSha256: sha256(retainedImage.bytes),
  };
}
await writeFile(
  `research/${prefix}-profile-media.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
