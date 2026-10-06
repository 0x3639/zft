import { z } from "zod";

export const PROFILE_MEDIA = {
  avatar: { width: 256, height: 256, maxBytes: 300_000 },
  cover: { width: 1280, height: 480, maxBytes: 2_600_000 },
} as const;
export type MediaKind = keyof typeof PROFILE_MEDIA;
export const PROFILE_BODY_LIMIT = 4_000_000;
export const mediaUpload = (kind: MediaKind) =>
  z
    .object({
      image: z
        .string()
        .min(4)
        .max(4 * Math.ceil(PROFILE_MEDIA[kind].maxBytes / 3)),
    })
    .strict()
    .nullable()
    .optional();
export function profileMediaURL(address: string, hash?: string | null) {
  return hash
    ? `/profile-media/${address.toLowerCase()}/${hash.slice(2)}.png`
    : null;
}
