// Local workerd fixture only. No request reaches the real chain or sponsor.
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Sponsor } from "../../apps/api/sponsor";
import { json } from "../../apps/api/http";
import type { Env } from "../../apps/api/types";
import { publicClient } from "../../packages/protocol/client";
import manifest from "../../packages/protocol/deployment.json";
import { chain } from "../../packages/protocol";
import { key } from "../fixtures";

export class TestSponsor extends Sponsor {
  private calls: string[] = [];
  private held = new Set<string>();
  private releases = new Map<string, Set<() => void>>();
  private receipts = new Map<string, { state: string; block: string }>();
  private head = 106n;
  private mismatch = false;
  private nonce = 0;
  private pendingNonce?: number;
  private price = 1_000_000_000n;
  private broadcastError = false;
  private receiptError = false;
  private broadcasts: Hex[] = [];
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Patch only this test isolate's imported client and deployment object.
    manifest.codeHash = keccak256("0x6000");
    // viem's separate wallet client checks eth_chainId even when signing with a
    // local account. Handle that read locally and deny every other outbound call.
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== chain.rpcUrls.default.http[0])
        throw new Error("Unexpected fixture network destination");
      const rpc = (await request.json()) as { id: number; method: string };
      this.calls.push(`wallet:${rpc.method}`);
      if (rpc.method !== "eth_chainId")
        throw new Error("Unexpected fixture RPC method");
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: `0x${manifest.chainId.toString(16)}`,
      });
    };
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
        if (this.receiptError) throw new Error("Receipt RPC unavailable");
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
        this.broadcasts.push(serializedTransaction);
        await step("broadcastResponse");
        if (this.broadcastError) throw new Error("Ambiguous RPC delivery");
        return keccak256(serializedTransaction);
      },
      readContract: async () => privateKeyToAccount(key).address,
      estimateGas: async () => {
        await step("estimate");
        return 50_000n;
      },
      getGasPrice: async () => this.price,
      getTransactionCount: async ({ blockTag }: { blockTag: string }) =>
        blockTag === "pending" ? (this.pendingNonce ?? this.nonce) : this.nonce,
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
        removeReceipts?: string[];
        head?: string;
        mismatch?: boolean;
        nonce?: number;
        pendingNonce?: number;
        price?: string;
        broadcastError?: boolean;
        receiptError?: boolean;
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
        this.pendingNonce = undefined;
        this.price = 1_000_000_000n;
        this.broadcastError = false;
        this.receiptError = false;
        this.broadcasts = [];
      }
      if (data.put) await this.ctx.storage.put(data.put);
      for (const name of data.hold ?? []) this.held.add(name);
      for (const name of data.unhold ?? []) this.held.delete(name);
      for (const name of data.release ?? []) {
        this.held.delete(name);
        for (const release of this.releases.get(name) ?? []) release();
        this.releases.delete(name);
      }
      for (const hash of data.removeReceipts ?? []) this.receipts.delete(hash);
      for (const [hash, receipt] of data.receipts ?? [])
        this.receipts.set(hash, receipt);
      if (data.head) this.head = BigInt(data.head);
      if (data.nonce !== undefined) this.nonce = data.nonce;
      if (data.pendingNonce !== undefined)
        this.pendingNonce = data.pendingNonce;
      if (data.price !== undefined) this.price = BigInt(data.price);
      if (data.broadcastError !== undefined)
        this.broadcastError = data.broadcastError;
      if (data.receiptError !== undefined)
        this.receiptError = data.receiptError;
      if (data.mismatch !== undefined) this.mismatch = data.mismatch;
      return json({ ok: true });
    }
    if (path === "/__state")
      return json({
        calls: this.calls,
        broadcasts: this.broadcasts,
        waiting: [...this.releases.keys()],
        storage: Object.fromEntries(await this.ctx.storage.list()),
        alarm: await this.ctx.storage.getAlarm(),
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
