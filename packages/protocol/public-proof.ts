import { sha256, verifyMessage, type Hex } from "viem";
import { digest, sameAddress, type Metadata } from "./index";
import { possessionText, publicationSchema, type Publication } from "./public";

export type Evidence = {
  tokenId: string;
  metadata: Metadata;
  metadataHash: string;
  owner?: string;
  nonce?: string;
  chainVerified?: boolean;
  blockNumber?: string;
  blockHash?: string;
  observedAt?: string;
  publication?: Publication | null;
  chainError?: string;
};
export type CheckState =
  | "pass"
  | "fail"
  | "unknown"
  | "absent"
  | "expired"
  | "historical";
export async function verifyPublicEvidence(
  item: Evidence,
  image?: Uint8Array,
  now = Date.now(),
  expectedProfile?: string,
) {
  const metadata =
    digest(item.metadata) === item.metadataHash &&
    BigInt(item.metadata.imageHash).toString() === item.tokenId;
  const integrity: CheckState = !metadata
    ? "fail"
    : !image
      ? "unknown"
      : sha256(image) === item.metadata.imageHash
        ? "pass"
        : "fail";
  let binding: CheckState = "absent",
    current: CheckState = "absent";
  const p = item.publication;
  if (p) {
    const parsed = publicationSchema.safeParse(p);
    let valid = false;
    if (
      parsed.success &&
      p.tokenId === item.tokenId &&
      (!expectedProfile || sameAddress(p.profile, expectedProfile))
    )
      try {
        valid = await verifyMessage({
          address: p.owner,
          message: possessionText(p.profile, p),
          signature: p.signature as Hex,
        });
      } catch {
        /* Invalid evidence is not an outage. */
      }
    binding = valid ? (p.expires * 1000 > now ? "pass" : "expired") : "fail";
    current = !item.chainVerified
      ? "unknown"
      : !valid
        ? "fail"
        : !sameAddress(p.owner, item.owner ?? "") || p.nonce !== item.nonce
          ? "historical"
          : binding === "expired"
            ? "expired"
            : "pass";
  }
  return { integrity, binding, current };
}
