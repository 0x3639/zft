import { z } from "zod";
import { addressSchema, hashSchema, CHAIN_ID } from "./index";
export const challengeInput = z
  .object({
    address: addressSchema,
    method: z.enum(["POST", "PUT"]),
    path: z.enum([
      "/api/uploads",
      "/api/operations",
      "/api/profile",
      "/api/social",
      "/api/possessions",
      "/api/unpublish",
    ]),
    bodyHash: hashSchema,
  })
  .strict();
export type Challenge = z.infer<typeof challengeInput> & {
  id: string;
  expires: number;
  origin: string;
};
export const challengeText = (c: Challenge) =>
  `ZFT request\nOrigin: ${c.origin}\nChain: ${CHAIN_ID}\nProfile: ${c.address}\nMethod: ${c.method}\nPath: ${c.path}\nBody SHA256: ${c.bodyHash}\nNonce: ${c.id}\nExpires: ${c.expires}`;
