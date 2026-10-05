import {
  defineChain,
  getAddress,
  hashTypedData,
  parseAbi,
  sha256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";

export const CHAIN_ID = 7340469;
export const RPC_URL = "https://devnet.zenon.foo/zvm/rpc";
// Observed from the public relayer's rejection on 2026-10-04. eth_gasPrice omits this floor.
export const RELAY_PRIORITY_FLOOR = 50_000_000_000n;
export const GENESIS_HASH =
  "0x2a55e0b69e552a105d559e99b12e0cae28d6e07a3c7a9f264a1543a040ef8ea4";
export const chain = defineChain({
  id: CHAIN_ID,
  name: "ZVM Devnet",
  nativeCurrency: { name: "Devnet ZNN", symbol: "ZNN", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
export const abi = parseAbi([
  "function mint((bytes32 imageHash,bytes32 metadataHash,address initialOwner,address creator,uint256 creatorNonce,uint256 deadline) authorization,bytes signature) returns (uint256)",
  "function rotateOwnership((uint256 tokenId,address newOwner,uint256 ownershipNonce,uint256 deadline) authorization,bytes signature)",
  "function ownerOf(uint256) view returns (address)",
  "function ownershipNonce(uint256) view returns (uint256)",
  "function creatorNonces(address) view returns (uint256)",
  "function creatorOf(uint256) view returns (address)",
  "function metadataHashOf(uint256) view returns (bytes32)",
  "function getApproved(uint256) view returns (address)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function tokenURI(uint256) view returns (string)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "event ApprovalForAll(address indexed owner,address indexed operator,bool approved)",
  "event Minted(uint256 indexed tokenId,address indexed creator,address indexed initialOwner,bytes32 imageHash,bytes32 metadataHash)",
  "event OwnershipRotated(uint256 indexed tokenId,address indexed previousOwner,address indexed newOwner,uint256 ownershipNonce)",
  "error ExpiredAuthorization(uint256 deadline)",
  "error InvalidCreatorNonce(uint256 supplied,uint256 expected)",
  "error InvalidOwnershipNonce(uint256 supplied,uint256 expected)",
  "error DuplicateImage(bytes32 imageHash)",
  "error InvalidSigner(address recovered,address expected)",
  "error ZeroHash()",
  "error ZeroAddress()",
  "error SameOwner()",
]);
export const mintTypes = {
  Mint: [
    { name: "imageHash", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" },
    { name: "initialOwner", type: "address" },
    { name: "creator", type: "address" },
    { name: "creatorNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const rotationTypes = {
  RotateOwnership: [
    { name: "tokenId", type: "uint256" },
    { name: "newOwner", type: "address" },
    { name: "ownershipNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const domain = (contract: Address, chainId = CHAIN_ID) =>
  ({
    name: "ZFT",
    version: "1",
    chainId,
    verifyingContract: contract,
  }) as const;
export const addressSchema = z
  .string()
  .regex(/^0x[\da-fA-F]{40}$/)
  .transform((v) => getAddress(v));
export const hashSchema = z
  .string()
  .regex(/^0x[\da-f]{64}$/)
  .transform((v) => v as Hex);
export const uintSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,77})$/)
  .pipe(z.string().refine((v) => BigInt(v) < 2n ** 256n));
export const signatureSchema = z
  .string()
  .regex(/^0x[\da-fA-F]{130}$/)
  .transform((v) => v as Hex);
export const mintSchema = z
  .object({
    imageHash: hashSchema,
    metadataHash: hashSchema,
    initialOwner: addressSchema,
    creator: addressSchema,
    creatorNonce: uintSchema,
    deadline: uintSchema,
  })
  .strict();
export const rotationSchema = z
  .object({
    tokenId: uintSchema,
    newOwner: addressSchema,
    ownershipNonce: uintSchema,
    deadline: uintSchema,
  })
  .strict();
export type Mint = z.infer<typeof mintSchema>;
export type Rotation = z.infer<typeof rotationSchema>;
export const mintMessage = (a: Mint) => ({
  ...a,
  creatorNonce: BigInt(a.creatorNonce),
  deadline: BigInt(a.deadline),
});
export const rotationMessage = (a: Rotation) => ({
  ...a,
  tokenId: BigInt(a.tokenId),
  ownershipNonce: BigInt(a.ownershipNonce),
  deadline: BigInt(a.deadline),
});
export const operationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mint"),
      authorization: mintSchema,
      signature: signatureSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("rotate"),
      authorization: rotationSchema,
      signature: signatureSchema,
    })
    .strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export function operationDigest(contract: Address, op: Operation): Hex {
  return op.kind === "mint"
    ? hashTypedData({
        domain: domain(contract),
        types: mintTypes,
        primaryType: "Mint",
        message: mintMessage(op.authorization),
      })
    : hashTypedData({
        domain: domain(contract),
        types: rotationTypes,
        primaryType: "RotateOwnership",
        message: rotationMessage(op.authorization),
      });
}
export const CANONICALIZER = "zft-png/1";
export const metadataSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
    image: z.string().url().max(256),
    imageHash: hashSchema,
    canonicalizer: z.literal(CANONICALIZER),
    mediaType: z.literal("image/png"),
    width: z.number().int().positive().max(24000000),
    height: z.number().int().positive().max(24000000),
    creator: addressSchema,
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine((m) => m.width * m.height <= 24_000_000);
export type Metadata = z.infer<typeof metadataSchema>;
export const envelopeSchema = z
  .object({
    format: z.literal("zft"),
    version: z.literal(1),
    canonicalizer: z.literal(CANONICALIZER),
    chainId: z.literal("7340469"),
    contract: addressSchema,
    tokenId: uintSchema,
    imageHash: hashSchema,
    metadataHash: hashSchema,
    metadata: metadataSchema,
    authority: z
      .object({
        scheme: z.literal("secp256k1"),
        privateKey: hashSchema,
        ownershipNonce: uintSchema,
      })
      .strict(),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
// Our schema is a bounded I-JSON subset: finite integers, well-formed strings, no optional/undefined values.
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") {
    if (
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        value,
      )
    )
      throw new Error("Invalid Unicode");
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            canonical(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  throw new Error("Not canonical JSON");
}
export const digest = (value: unknown): Hex =>
  sha256(stringToBytes(canonical(value)));
export const sameAddress = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
export interface Deployment {
  chainId: number;
  contract: Address;
  genesisHash: Hex;
  codeHash: Hex;
  deploymentBlock: string;
  deploymentBlockHash: Hex;
  metadataOrigin: string;
}
