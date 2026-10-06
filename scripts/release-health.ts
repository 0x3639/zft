import { z } from "zod";

// Hosted help acceptance expects the configured devnet sponsor and a caught-up index.
export const releaseHealth = z.object({
  ready: z.literal(true),
  network: z.literal("ZVM devnet"),
  sponsorEnabled: z.literal(true),
  index: z
    .object({
      block: z.number().int().nonnegative(),
      head: z.number().int().nonnegative(),
      syncedAt: z.number().int().positive(),
      error: z.null(),
      lag: z.number().int().nonnegative(),
      confirmations: z.literal(6),
    })
    .refine(
      (index) =>
        index.head >= index.block &&
        index.lag === index.head - index.block &&
        index.lag <= index.confirmations,
      "Index must be caught up to its confirmation window",
    ),
});
