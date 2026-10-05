import { it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { sha256 } from "viem";
import {
  verifyPublicEvidence,
  type Evidence,
} from "../packages/protocol/public-proof";
import { possessionText } from "../packages/protocol/public";
import { digest, type Metadata } from "../packages/protocol";
const key = ("0x" + "11".repeat(32)) as `0x${string}`;
const owner = privateKeyToAccount(key);
it("separates authentic history, expiry, tampering and unavailable live state", async () => {
  const bytes = new Uint8Array([1, 2, 3]),
    hash = sha256(bytes),
    tokenId = BigInt(hash).toString();
  const metadata: Metadata = {
    name: "Proof test",
    description: "",
    image: `https://zft.foo/art/${hash.slice(2)}.png`,
    imageHash: hash,
    canonicalizer: "zft-png/1",
    mediaType: "image/png",
    width: 1,
    height: 1,
    creator: owner.address,
    createdAt: "2026-10-04T00:00:00.000Z",
  };
  const p = {
    profile: owner.address,
    tokenId,
    owner: owner.address,
    nonce: "0",
    expires: 2000,
    publishedAt: 1000,
    signature: "0x" as `0x${string}`,
  };
  p.signature = await owner.signMessage({
    message: possessionText(p.profile, p),
  });
  const item: Evidence = {
    tokenId,
    metadata,
    metadataHash: digest(metadata),
    owner: owner.address,
    nonce: "0",
    chainVerified: true,
    publication: p,
  };
  expect(await verifyPublicEvidence(item, bytes, 1500000)).toEqual({
    integrity: "pass",
    binding: "pass",
    current: "pass",
  });
  expect(
    (
      await verifyPublicEvidence(
        item,
        bytes,
        1500000,
        "0x2222222222222222222222222222222222222222",
      )
    ).binding,
  ).toBe("fail");
  expect(
    await verifyPublicEvidence({ ...item, nonce: "1" }, bytes, 1500000),
  ).toEqual({ integrity: "pass", binding: "pass", current: "historical" });
  expect(
    (
      await verifyPublicEvidence(
        { ...item, chainVerified: false },
        bytes,
        1500000,
      )
    ).current,
  ).toBe("unknown");
  expect((await verifyPublicEvidence(item, bytes, 2500000)).binding).toBe(
    "expired",
  );
  expect(
    (await verifyPublicEvidence(item, new Uint8Array([4]), 1500000)).integrity,
  ).toBe("fail");
  expect(
    (
      await verifyPublicEvidence(
        {
          ...item,
          publication: {
            ...p,
            profile: "0x2222222222222222222222222222222222222222",
          },
        },
        bytes,
        1500000,
      )
    ).binding,
  ).toBe("fail");
  expect(
    (await verifyPublicEvidence({ ...item, publication: null }, bytes, 1500000))
      .current,
  ).toBe("absent");
});
