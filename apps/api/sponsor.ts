import { DurableObject } from "cloudflare:workers";
import {
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  verifyMessage,
  verifyTypedData,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  abi,
  chain,
  domain,
  digest,
  metadataSchema,
  mintMessage,
  mintTypes,
  operationDigest,
  operationSchema,
  rotationMessage,
  rotationTypes,
  sameAddress,
  RELAY_PRIORITY_FLOOR,
  type Deployment,
  type Operation,
} from "../../packages/protocol";
import {
  challengeInput,
  challengeText,
  type Challenge,
} from "../../packages/protocol/auth";
import { checkDeployment, publicClient } from "../../packages/protocol/client";
import manifest from "../../packages/protocol/deployment.json";
import type { Env } from "./types";

export type Job = {
  id: Hex;
  operation: Operation;
  hash: Hex;
  nonce: number;
  raw: Hex;
  state: "submitted" | "included" | "confirmed" | "failed";
  block?: string;
  blockHash?: Hex;
  created: number;
};
import { HttpError, json } from "./http";
export { HttpError, json } from "./http";
// Nonce/outbox mutations share one queue. Authentication has its own queue, and
// status observations never mutate the journal or wait for transaction delivery.
export class Sponsor extends DurableObject<Env> {
  private tail: Promise<unknown> = Promise.resolve();
  private authTail: Promise<unknown> = Promise.resolve();
  private observations = new Map<string, Promise<Job>>();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.tail.then(fn);
    this.tail = task.catch(() => {});
    return task;
  }
  async fetch(request: Request) {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/challenge" || path === "/authenticate") {
        // Keep challenge consumption and every authentication quota update in
        // the same critical section, including signature verification awaits.
        const task = this.authTail.then(() => this.route(request));
        this.authTail = task.catch(() => {});
        return await task;
      }
      if (path.startsWith("/operation/")) return await this.route(request);
      return await this.serial(() => this.route(request));
    } catch (error) {
      return json(
        {
          error:
            error instanceof HttpError
              ? error.message
              : "Operation unavailable. Your saved keys remain in your vault.",
        },
        error instanceof HttpError ? error.status : 503,
      );
    }
  }
  alarm() {
    return this.serial(async () => {
      const active = await this.ctx.storage.get<Hex>("active");
      if (active) {
        const job = await this.ctx.storage.get<Job>(`job:${active}`);
        if (job) {
          try {
            await this.reconcile(job, true);
          } catch {
            /* The journal is retained for the next alarm. */
          }
        }
      }
      if (await this.ctx.storage.get("active"))
        await this.ctx.storage.setAlarm(Date.now() + 15_000);
    });
  }
  private async counter(key: string, max: number) {
    const day = Math.floor(Date.now() / 86_400_000),
      k = `quota:${day}:${key}`;
    const n = (await this.ctx.storage.get<number>(k)) ?? 0;
    if (n >= max)
      throw new HttpError(
        429,
        "Devnet daily quota reached. Try again tomorrow.",
      );
    await this.ctx.storage.put(k, n + 1);
  }
  private deployment(): Deployment {
    if (!manifest.contract || !manifest.codeHash)
      throw new HttpError(503, "The ZFT contract is not configured.");
    return manifest as unknown as Deployment;
  }
  private async route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/challenge") {
      const { input, ip } = (await request.json()) as {
        input: unknown;
        ip: string;
      };
      const parsed = challengeInput.parse(input);
      await this.counter(`challenge:${ip}`, 120);
      const c: Challenge = {
        ...parsed,
        id: crypto.randomUUID(),
        expires: Math.floor(Date.now() / 1000) + 300,
        origin: this.env.PUBLIC_ORIGIN,
      };
      await this.ctx.storage.put(`challenge:${c.id}`, c);
      // Challenges are bounded by admission quota; remove expired challenges opportunistically.
      for (const [key, old] of await this.ctx.storage.list<Challenge>({
        prefix: "challenge:",
        limit: 1000,
      }))
        if (old.expires < Date.now() / 1000) await this.ctx.storage.delete(key);
      return json({ ...c, message: challengeText(c) });
    }
    if (path === "/authenticate") {
      const data = (await request.json()) as {
        id: string;
        signature: Hex;
        method: string;
        path: string;
        bodyHash: Hex;
        ip: string;
      };
      if (!/^[a-f0-9-]{36}$/.test(data.id))
        throw new HttpError(401, "Invalid request proof.");
      const key = `challenge:${data.id}`,
        c = await this.ctx.storage.get<Challenge>(key);
      if (
        !c ||
        c.expires < Date.now() / 1000 ||
        c.method !== data.method ||
        c.path !== data.path ||
        c.bodyHash !== data.bodyHash ||
        !(await verifyMessage({
          address: c.address,
          message: challengeText(c),
          signature: data.signature,
        }))
      )
        throw new HttpError(401, "Expired or invalid request proof.");
      await this.ctx.storage.delete(key);
      await this.counter(`request:${data.ip}`, 80);
      await this.counter(
        `${data.path}:${c.address.toLowerCase()}`,
        data.path === "/api/uploads" ? 10 : 60,
      );
      return json({ address: c.address });
    }
    if (path === "/publish") {
      const item = (await request.json()) as {
        tokenId: string;
        metadataHash: Hex;
      };
      await this.ctx.storage.put(`item:${item.tokenId}`, item);
      return json({ ok: true });
    }
    if (path === "/gallery") {
      const items = [
        ...(
          await this.ctx.storage.list({
            prefix: "item:",
            limit: 50,
            reverse: true,
          })
        ).values(),
      ];
      return json({ items });
    }
    if (path.startsWith("/operation/")) {
      const id = path.slice("/operation/".length);
      const job = await this.ctx.storage.get<Job>(`job:${id}`);
      if (!job) throw new HttpError(404, "Operation not found.");
      return json(this.publicJob(await this.status(job)));
    }
    if (path === "/submit") {
      if (this.env.SPONSOR_ENABLED !== "true" || !this.env.SPONSOR_PRIVATE_KEY)
        throw new HttpError(503, "Devnet sponsorship is not enabled yet.");
      const d = this.deployment(),
        { operation, profile } = (await request.json()) as {
          operation: unknown;
          profile: Hex;
        };
      const op = operationSchema.parse(operation),
        id = operationDigest(d.contract, op);
      const existing = await this.ctx.storage.get<Job>(`job:${id}`);
      if (existing)
        return json(this.publicJob(await this.reconcile(existing, true)), 202);
      const active = await this.ctx.storage.get<Hex>("active");
      if (active) {
        const previous = await this.ctx.storage.get<Job>(`job:${active}`);
        if (previous) await this.reconcile(previous, true);
        if (await this.ctx.storage.get("active"))
          throw new HttpError(
            503,
            "Sponsor is waiting for its previous transaction. Retry this saved operation shortly.",
          );
      }
      await checkDeployment(d);
      const expiry = BigInt(op.authorization.deadline),
        now = BigInt(Math.floor(Date.now() / 1000));
      if (expiry <= now || expiry > now + 900n)
        throw new HttpError(
          400,
          "Authorization must expire within 15 minutes.",
        );
      let call: Hex;
      if (op.kind === "mint") {
        const a = op.authorization;
        const uploaded = await this.env.MEDIA.get(
          `metadata/${a.metadataHash.slice(2)}.json`,
        );
        if (!sameAddress(profile, a.creator) || !uploaded)
          throw new HttpError(
            400,
            "Mint requires the creator’s admitted image and metadata.",
          );
        const metadata = metadataSchema.parse(await uploaded.json());
        if (
          digest(metadata) !== a.metadataHash ||
          metadata.imageHash !== a.imageHash ||
          !sameAddress(metadata.creator, a.creator)
        )
          throw new HttpError(
            400,
            "Mint metadata does not match its authorization.",
          );
        if (
          !(await verifyTypedData({
            address: a.creator,
            domain: domain(d.contract),
            types: mintTypes,
            primaryType: "Mint",
            message: mintMessage(a),
            signature: op.signature,
          }))
        )
          throw new HttpError(401, "Invalid mint signature.");
        call = encodeFunctionData({
          abi,
          functionName: "mint",
          args: [mintMessage(a), op.signature],
        });
      } else {
        const owner = await publicClient.readContract({
          address: d.contract,
          abi,
          functionName: "ownerOf",
          args: [BigInt(op.authorization.tokenId)],
        });
        if (
          !(await verifyTypedData({
            address: owner,
            domain: domain(d.contract),
            types: rotationTypes,
            primaryType: "RotateOwnership",
            message: rotationMessage(op.authorization),
            signature: op.signature,
          }))
        )
          throw new HttpError(401, "Invalid or stale ownership signature.");
        call = encodeFunctionData({
          abi,
          functionName: "rotateOwnership",
          args: [rotationMessage(op.authorization), op.signature],
        });
      }
      const account = privateKeyToAccount(this.env.SPONSOR_PRIVATE_KEY);
      const [estimated, price, pending, latest] = await Promise.all([
        publicClient.estimateGas({
          account,
          to: d.contract,
          data: call,
          value: 0n,
        }),
        publicClient.getGasPrice(),
        publicClient.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        }),
        publicClient.getTransactionCount({
          address: account.address,
          blockTag: "latest",
        }),
      ]);
      const last = await this.ctx.storage.get<number>("lastNonce");
      if (pending !== latest || (last !== undefined && pending !== last + 1))
        throw new HttpError(
          503,
          "Sponsor nonce reconciliation is required. No new transaction was signed.",
        );
      const gas = (estimated * 12n) / 10n + 10_000n,
        gasPrice = (price * 12n) / 10n + RELAY_PRIORITY_FLOOR;
      if (gas > 600_000n || gasPrice > 100_000_000_000n)
        throw new HttpError(503, "Gas exceeds the devnet sponsor limit.");
      const day = Math.floor(Date.now() / 86_400_000),
        budgetKey = `gas:${day}`,
        spent = BigInt((await this.ctx.storage.get<string>(budgetKey)) ?? "0");
      if (spent + gas * gasPrice > 100_000_000_000_000_000n)
        throw new HttpError(429, "Daily sponsor gas budget reached.");
      await this.counter(
        `operation:${op.kind}:${profile.toLowerCase()}`,
        op.kind === "mint" ? 10 : 50,
      );
      const wallet = createWalletClient({ account, chain, transport: http() });
      const raw = await wallet.signTransaction({
        to: d.contract,
        data: call,
        value: 0n,
        nonce: pending,
        gas,
        gasPrice,
        type: "legacy",
      });
      const job: Job = {
        id,
        operation: op,
        hash: keccak256(raw),
        nonce: pending,
        raw,
        state: "submitted",
        created: Date.now(),
      };
      // Durable outbox precedes broadcast. A timeout retries exactly these bytes.
      await this.ctx.storage.transaction(async (tx) => {
        await tx.put({
          [`job:${id}`]: job,
          active: id,
          lastNonce: pending,
          [budgetKey]: (spent + gas * gasPrice).toString(),
        });
        await tx.setAlarm(Date.now() + 15_000);
      });
      try {
        await publicClient.sendRawTransaction({ serializedTransaction: raw });
      } catch {
        /* Ambiguous delivery stays submitted. */
      }
      return json(this.publicJob(job), 202);
    }
    throw new HttpError(404, "Unknown sponsor route.");
  }
  private publicJob(j: Job) {
    return {
      operationId: j.id,
      txHash: j.hash,
      state: j.state,
      blockNumber: j.block,
      confirmationPolicy:
        "6 EVM blocks; application policy, not a protocol-finality guarantee",
    };
  }
  private async status(job: Job) {
    let observation = this.observations.get(job.id);
    if (!observation) {
      // Coalesce repeated polls and bound outstanding RPC work across job IDs.
      // Keep the slot until the underlying RPC settles, even after a timeout.
      if (this.observations.size >= 16)
        throw new HttpError(503, "Status checks are busy. Retry shortly.");
      observation = this.observe(job);
      this.observations.set(job.id, observation);
      const cleanup = () => this.observations.delete(job.id);
      void observation.then(cleanup, cleanup);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        observation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new HttpError(
                  503,
                  "Chain status is unavailable. Keep your saved operation and retry shortly.",
                ),
              ),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async observe(saved: Job): Promise<Job> {
    // A poll can finish after an alarm or submission. Never write its potentially
    // older observation over the serialized durable journal.
    const job = { ...saved };
    const d = this.deployment();
    await checkDeployment(d);
    let receipt;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: job.hash });
    } catch (e) {
      if ((e as Error).name !== "TransactionReceiptNotFoundError") throw e;
      job.state = "submitted";
      delete job.block;
      delete job.blockHash;
      return job;
    }
    const current = await publicClient.getBlock({
      blockNumber: receipt.blockNumber,
    });
    if (current.hash !== receipt.blockHash)
      throw new HttpError(503, "Chain reorganization pending. Keep both keys.");
    const head = await publicClient.getBlockNumber();
    // A revert can be reorged out too. Neither outcome is terminal until the
    // same confirmation window has elapsed, so retries keep the existing job.
    job.state =
      head < receipt.blockNumber + 6n
        ? "included"
        : receipt.status === "reverted"
          ? "failed"
          : "confirmed";
    job.block = receipt.blockNumber.toString();
    job.blockHash = receipt.blockHash;
    return job;
  }
  private async reconcile(saved: Job, broadcast: boolean) {
    const job = await this.observe(saved);
    await this.ctx.storage.put(`job:${job.id}`, job);
    if (job.state === "submitted" && broadcast)
      try {
        await publicClient.sendRawTransaction({
          serializedTransaction: job.raw,
        });
      } catch {
        /* Retry retains the durable nonce reservation. */
      }
    // Keep the one-flight queue reserved through the confirmation window.
    if (job.state === "confirmed" || job.state === "failed") {
      if ((await this.ctx.storage.get("active")) === job.id)
        await this.ctx.storage.delete("active");
      if (job.state === "confirmed" && job.operation.kind === "mint") {
        const a = job.operation.authorization;
        await this.ctx.storage.put(`item:${BigInt(a.imageHash)}`, {
          tokenId: BigInt(a.imageHash).toString(),
          metadataHash: a.metadataHash,
        });
      }
    }
    return job;
  }
}
