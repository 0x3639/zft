import { z } from "zod";
import { addressSchema, uintSchema, signatureSchema, CHAIN_ID } from "./index";
import manifest from "./deployment.json";

export const profileInput = z
  .object({
    name: z.string().trim().min(1).max(64),
    bio: z.string().trim().max(320),
    featured: uintSchema.nullable(),
    revision: z.number().int().min(0).max(2_000_000_000),
  })
  .strict();
export const socialInput = z
  .object({
    kind: z.enum(["follow", "like"]),
    target: addressSchema,
    active: z.boolean(),
  })
  .strict();
export const possessionInput = z
  .object({
    tokenId: uintSchema,
    nonce: uintSchema,
    owner: addressSchema,
    expires: z.number().int().positive(),
    signature: signatureSchema,
  })
  .strict();
export const unpublishInput = z.object({ tokenId: uintSchema }).strict();
export const publicationSchema = possessionInput.extend({
  profile: addressSchema,
  publishedAt: z.number().int().nonnegative(),
});
export type Publication = z.infer<typeof publicationSchema>;
export const possessionText = (
  profile: string,
  p: { tokenId: string; nonce: string; expires: number },
) =>
  `ZFT public collection\nChain: ${CHAIN_ID}\nContract: ${manifest.contract.toLowerCase()}\nProfile: ${profile.toLowerCase()}\nToken: ${p.tokenId}\nOwnership nonce: ${p.nonce}\nExpires: ${p.expires}`;
export type Profile = {
  address: string;
  name: string;
  bio: string;
  featured: string | null;
  revision: number;
  updated_at: number;
};
