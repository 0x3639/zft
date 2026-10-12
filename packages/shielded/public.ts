import { z } from "zod";
import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
  type Address,
} from "viem";
import { canonical, digest } from "../protocol";

export const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const utf8 = (limit: number) =>
  z.string().refine((v) => new TextEncoder().encode(v).length <= limit);
export const publicMetadata = z
  .object({
    format: z.literal("zft-shielded-metadata-v1"),
    name: utf8(256).refine((v) => v.length > 0),
    description: utf8(4096),
    imageHash: hash,
    canonicalizer: z.literal("zft-png/1"),
    mediaType: z.literal("image/png"),
    width: z.number().int().positive().safe(),
    height: z.number().int().positive().safe(),
    creator: z
      .string()
      .regex(/^0x[0-9a-f]{40}$/)
      .refine((v) => !/^0x0{40}$/.test(v)),
    createdAt: z
      .string()
      .datetime({ precision: 3 })
      .refine((v) => new Date(v).toISOString() === v),
  })
  .strict()
  .refine((v) => v.width * v.height <= 24_000_000)
  .refine((v) => {
    try {
      return new TextEncoder().encode(canonical(v)).length <= 8192;
    } catch {
      return false;
    }
  });
export type PublicMetadata = z.infer<typeof publicMetadata>;
export const publicationSchema = z
  .object({
    format: z.literal("zft-shielded-publication-v1"),
    assetId: hash,
    transactionHash: hash,
    metadata: publicMetadata,
    image: z.string().min(1).max(13_981_016),
  })
  .strict();
export type Publication = z.infer<typeof publicationSchema>;
export function publicAssetId(
  metadata: PublicMetadata,
  chainId: string,
  registry: Address,
) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex("ZFT_SHIELDED_ASSET_V1")),
        BigInt(chainId),
        registry,
        metadata.imageHash as `0x${string}`,
        digest(metadata),
      ],
    ),
  );
}
export type GalleryItem = {
  assetId: string;
  metadata: PublicMetadata;
  transactionHash: string;
  creationBlock: string;
  creationBlockHash: string;
  observedBlock: string;
  image: string;
};
export type GalleryPage = { items: GalleryItem[]; cursor: string | null };
