import { openDB, type IDBPDatabase } from "idb";
import { z } from "zod";
import {
  canonical,
  digest,
  sameAddress,
  operationDigest,
  addressSchema,
  hashSchema,
  uintSchema,
  metadataSchema,
  operationSchema,
  type Deployment,
} from "../../../packages/protocol";

const walletDraft = z
  .object({
    kind: z.enum(["mint", "claim"]),
    wallet: addressSchema,
    tokenId: uintSchema,
    metadata: metadataSchema,
    image: z.string().max(14_000_000),
    sourceOwner: addressSchema.optional(),
    sourceNonce: uintSchema.optional(),
    operation: operationSchema.optional(),
    operationId: hashSchema.optional(),
    job: z
      .object({
        operationId: hashSchema,
        txHash: hashSchema,
        state: z.enum(["submitted", "included", "confirmed", "failed"]),
        blockNumber: z.string().optional(),
        confirmationPolicy: z.string().max(256).optional(),
      })
      .strict()
      .optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((record, ctx) => {
    const fail = () =>
      ctx.addIssue({
        code: "custom",
        message:
          "Saved wallet operation does not match its recipient or artwork.",
      });
    if (BigInt(record.metadata.imageHash).toString() !== record.tokenId) fail();
    if (
      record.kind === "mint" &&
      !sameAddress(record.metadata.creator, record.wallet)
    )
      fail();
    if (
      record.kind === "claim" &&
      (!record.sourceOwner || record.sourceNonce === undefined)
    )
      fail();
    const op = record.operation;
    if (!!op !== !!record.operationId) fail();
    if (record.job && record.job.operationId !== record.operationId) fail();
    if (!op) return;
    if (op.kind === "mint") {
      if (
        record.kind !== "mint" ||
        op.authorization.imageHash !== record.metadata.imageHash ||
        op.authorization.metadataHash !== digest(record.metadata) ||
        !sameAddress(op.authorization.creator, record.wallet) ||
        !sameAddress(op.authorization.initialOwner, record.wallet)
      )
        fail();
    } else if (
      record.kind !== "claim" ||
      op.authorization.tokenId !== record.tokenId ||
      op.authorization.ownershipNonce !== record.sourceNonce ||
      !sameAddress(op.authorization.newOwner, record.wallet)
    )
      fail();
  });
export type WalletDraft = z.infer<typeof walletDraft>;

// Public pixels and narrowly scoped signed operations only. Never store file or wallet keys here.
export class WalletJournal {
  private constructor(
    private db: IDBPDatabase,
    private contract: Deployment["contract"],
  ) {}
  static async open(
    d: Pick<Deployment, "chainId" | "contract">,
    name = "zft-wallet-operations",
  ) {
    return new WalletJournal(
      await openDB(`${name}:${d.chainId}:${d.contract.toLowerCase()}`, 1, {
        upgrade(db) {
          db.createObjectStore("operations");
        },
      }),
      d.contract,
    );
  }
  private id(wallet: string, tokenId: string) {
    return `${wallet.toLowerCase()}:${tokenId}`;
  }
  private parse(value: unknown) {
    const record = walletDraft.parse(value);
    if (
      record.operation &&
      operationDigest(this.contract, record.operation) !== record.operationId
    )
      throw new Error("Saved operation digest does not match this deployment.");
    return record;
  }
  async get(wallet: string, tokenId: string): Promise<WalletDraft | undefined> {
    const value = await this.db.get("operations", this.id(wallet, tokenId));
    return value ? this.parse(value) : undefined;
  }
  async list(wallet: string): Promise<WalletDraft[]> {
    const prefix = `${wallet.toLowerCase()}:`;
    return (
      await this.db.getAll(
        "operations",
        IDBKeyRange.bound(prefix, `${prefix}\uffff`),
      )
    ).map((v) => this.parse(v));
  }
  async save(value: WalletDraft, expected: WalletDraft | null) {
    const next = this.parse({
      ...value,
      revision: (expected?.revision ?? -1) + 1,
    });
    const tx = this.db.transaction("operations", "readwrite"),
      id = this.id(next.wallet, next.tokenId);
    if (canonical((await tx.store.get(id)) ?? null) !== canonical(expected)) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error(
        "This wallet operation changed in another tab. Refresh before continuing.",
      );
    }
    await tx.store.put(next, id);
    await tx.done;
    return next;
  }
  async assertCurrent(record: WalletDraft) {
    if (
      canonical((await this.get(record.wallet, record.tokenId)) ?? null) !==
      canonical(record)
    )
      throw new Error(
        "This wallet operation changed. Refresh before continuing.",
      );
  }
  close() {
    this.db.close();
  }
}
