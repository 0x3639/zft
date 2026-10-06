// Local workerd fixture only. No request reaches the real chain or sponsor.
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Sponsor } from "../../apps/api/sponsor";
import { json } from "../../apps/api/http";
import type { Env } from "../../apps/api/types";
import { publicClient } from "../../packages/protocol/client";
import manifest from "../../packages/protocol/deployment.json";
import { key } from "../fixtures";

export class TestSponsor extends Sponsor {
  private calls: string[] = [];
  private held = new Set<string>();
  private releases = new Map<string, Set<() => void>>();
  private receipts = new Map<string, { state: string; block: string }>();
  private head = 106n;
  private mismatch = false;
  private nonce = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Patch only this test isolate's imported client and deployment object.
    manifest.codeHash = keccak256("0x6000");
    const step = async (name: string) => {
      this.calls.push(name);
      if (this.held.has(name))
        await new Promise<void>((resolve) => {
          const waiters = this.releases.get(name) ?? new Set();
          waiters.add(resolve);
          this.releases.set(name, waiters);
        });
    };
    Object.assign(publicClient, {
      getChainId: async () => manifest.chainId,
      getCode: async () => "0x6000",
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
        hash:
          blockNumber === 0n
            ? manifest.genesisHash
            : blockNumber === BigInt(manifest.deploymentBlock)
              ? manifest.deploymentBlockHash
              : this.mismatch
                ? "0xwrong"
                : "0xblock",
      }),
      getBlockNumber: async () => this.head,
      getTransactionReceipt: async ({ hash }: { hash: string }) => {
        // Capture the response before stalling to exercise a genuinely stale read.
        const receipt = this.receipts.get(hash);
        await step(`receipt:${hash}`);
        if (!receipt) {
          const error = new Error("No receipt");
          error.name = "TransactionReceiptNotFoundError";
          throw error;
        }
        return {
          status: receipt.state,
          blockNumber: BigInt(receipt.block),
          blockHash: "0xblock",
        };
      },
      sendRawTransaction: async ({
        serializedTransaction,
      }: {
        serializedTransaction: Hex;
      }) => {
        await step("broadcast");
        return keccak256(serializedTransaction);
      },
      readContract: async () => privateKeyToAccount(key).address,
      estimateGas: async () => {
        await step("estimate");
        return 50_000n;
      },
      getGasPrice: async () => 1_000_000_000n,
      getTransactionCount: async () => this.nonce,
    });
  }
  override async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/__fixture") {
      const data = (await request.json()) as {
        reset?: boolean;
        put?: Record<string, unknown>;
        hold?: string[];
        unhold?: string[];
        release?: string[];
        receipts?: [string, { state: string; block: string }][];
        head?: string;
        mismatch?: boolean;
        nonce?: number;
      };
      if (data.reset) {
        // A failed assertion may skip the test's release. Unblock all RPCs and
        // drain serialized delivery before erasing storage for the next test.
        this.held.clear();
        for (const waiters of this.releases.values())
          for (const release of waiters) release();
        this.releases.clear();
        await super.fetch(new Request("https://fixture.invalid/gallery"));
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        this.calls = [];
        this.receipts.clear();
        this.mismatch = false;
        this.head = 106n;
        this.nonce = 0;
      }
      if (data.put) await this.ctx.storage.put(data.put);
      for (const name of data.hold ?? []) this.held.add(name);
      for (const name of data.unhold ?? []) this.held.delete(name);
      for (const name of data.release ?? []) {
        this.held.delete(name);
        for (const release of this.releases.get(name) ?? []) release();
        this.releases.delete(name);
      }
      for (const [hash, receipt] of data.receipts ?? [])
        this.receipts.set(hash, receipt);
      if (data.head) this.head = BigInt(data.head);
      if (data.nonce !== undefined) this.nonce = data.nonce;
      if (data.mismatch !== undefined) this.mismatch = data.mismatch;
      return json({ ok: true });
    }
    if (path === "/__state")
      return json({
        calls: this.calls,
        waiting: [...this.releases.keys()],
        storage: Object.fromEntries(await this.ctx.storage.list()),
      });
    if (path === "/__alarm") {
      await this.alarm();
      return json({ ok: true });
    }
    return super.fetch(request);
  }
}
export default {
  fetch(request: Request, env: Env) {
    return env.SPONSOR.get(env.SPONSOR.idFromName("test")).fetch(request);
  },
};
