import { encode } from "fast-png";
import { privateKeyToAccount } from "viem/accounts";
import { sha256, type Hex } from "viem";
import {
  CANONICALIZER,
  digest,
  type Envelope,
  type Metadata,
} from "../packages/protocol";
export const key = ("0x" + "0".repeat(63) + "1") as Hex;
export const contract = "0x0000000000000000000000000000000000001234" as const;
export const source = () =>
  encode(
    {
      width: 2,
      height: 2,
      channels: 4,
      depth: 8,
      data: new Uint8Array([
        0, 213, 87, 255, 0, 97, 235, 255, 249, 22, 144, 255, 21, 21, 21, 0,
      ]),
    },
    { zlib: { level: 6 } },
  );
export function envelope(image: Uint8Array): Envelope {
  const imageHash = sha256(image);
  const metadata: Metadata = {
    name: "Momentum",
    description: "Protocol fixture",
    image: `https://zft.foo/art/${imageHash.slice(2)}.png`,
    imageHash,
    canonicalizer: CANONICALIZER,
    mediaType: "image/png",
    width: 2,
    height: 2,
    creator: privateKeyToAccount(key).address,
    createdAt: "2026-10-04T00:00:00.000Z",
  };
  return {
    format: "zft",
    version: 1,
    canonicalizer: CANONICALIZER,
    chainId: "7340469",
    contract,
    tokenId: BigInt(imageHash).toString(),
    imageHash,
    metadataHash: digest(metadata),
    metadata,
    authority: {
      scheme: "secp256k1",
      privateKey: key,
      ownershipNonce: "9007199254740993",
    },
  };
}
