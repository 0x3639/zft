import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { keccak256, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  domain,
  operationDigest,
  rotationMessage,
  rotationTypes,
} from "../packages/protocol";
import type { Job } from "../apps/api/sponsor";
import manifest from "../packages/protocol/deployment.json";
import { key } from "./fixtures";

type Snapshot = {
  calls: string[];
  broadcasts: Hex[];
  waiting: string[];
  storage: Record<string, unknown>;
  alarm: number | null;
};
const account = privateKeyToAccount(key);
let child: ChildProcess | undefined;
let exited: Promise<NodeJS.Signals | null>;
let origin: string;
let directory: string;

async function start() {
  child = spawn(
    process.execPath,
    ["--import", "tsx", "tests/fixtures/sponsor-runtime.ts", directory],
    { detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const runtime = child;
  exited = new Promise((resolve) => {
    runtime.once("exit", (_code, signal) => resolve(signal));
    runtime.once("error", () => resolve(null));
  });
  let logs = "";
  for (const stream of [runtime.stdout, runtime.stderr])
    stream?.on("data", (data) => {
      logs = (logs + data.toString()).slice(-6000);
    });
  origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Runtime startup timed out: ${logs}`)),
      20_000,
    );
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    runtime.once("error", fail);
    runtime.once("exit", () =>
      fail(new Error(`Runtime exited before readiness: ${logs}`)),
    );
    runtime.once("message", (message: { port?: number }) => {
      clearTimeout(timer);
      if (!message.port)
        reject(
          new Error(`Invalid runtime readiness: ${JSON.stringify(message)}`),
        );
      else resolve(`http://127.0.0.1:${message.port}`);
    });
  });
}

async function crash(assertKilled = false) {
  if (!child) return;
  const runtime = child;
  child = undefined;
  // The detached group belongs only to this test's launcher and workerd. Never
  // find/kill processes by executable name or touch a shared development server.
  if (runtime.pid) {
    try {
      process.kill(-runtime.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  const signal = await exited;
  if (assertKilled) expect(signal).toBe("SIGKILL");
}

function request(path: string, data?: unknown) {
  return fetch(`${origin}${path}`, {
    ...(data === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(10_000),
  });
}
async function fixture(data: unknown) {
  expect((await request("/__fixture", data)).status).toBe(200);
}
async function state(): Promise<Snapshot> {
  const response = await request("/__state");
  expect(response.status).toBe(200);
  return response.json();
}
async function entered(name: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await state()).waiting.includes(name)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`RPC did not reach ${name}`);
}
async function rotation(tokenId = "1") {
  const authorization = {
    tokenId,
    newOwner: account.address,
    ownershipNonce: "0",
    deadline: String(Math.floor(Date.now() / 1000) + 900),
  };
  const operation = {
    kind: "rotate" as const,
    authorization,
    signature: await account.signTypedData({
      domain: domain(manifest.contract as Hex),
      types: rotationTypes,
      primaryType: "RotateOwnership",
      message: rotationMessage(authorization),
    }),
  };
  return { operation, profile: account.address };
}
function reservations(snapshot: Snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.storage).filter(
      ([key]) =>
        key === "active" ||
        key === "lastNonce" ||
        key.startsWith("job:") ||
        key.startsWith("gas:") ||
        key.includes(":operation:"),
    ),
  );
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "zft-sponsor-recovery-"));
  await start();
}, 30_000);
afterEach(async () => {
  await crash();
  if (directory) await rm(directory, { recursive: true, force: true });
}, 15_000);

it("can retry after a process kill before the outbox without consuming a transaction nonce or gas budget", async () => {
  const input = await rotation();
  await fixture({ hold: ["estimate"] });
  const abandoned = request("/submit", input).catch(() => undefined);
  await entered("estimate");
  expect(reservations(await state())).toEqual({});
  await crash(true);
  await abandoned;
  await start();
  expect(reservations(await state())).toEqual({});
  const reply = await request("/submit", input);
  expect(reply.status).toBe(202);
  const id = operationDigest(manifest.contract as Hex, input.operation);
  const saved = await state();
  expect(saved.storage[`job:${id}`]).toMatchObject({
    nonce: 0,
    state: "submitted",
  });
  expect(saved.storage.active).toBe(id);
  expect(saved.broadcasts).toHaveLength(1);
});

it.each(["broadcast", "broadcastResponse"])(
  "recovers the exact durable transaction after a process kill at %s",
  async (checkpoint) => {
    const input = await rotation();
    const id = operationDigest(manifest.contract as Hex, input.operation);
    await fixture({ hold: [checkpoint] });
    const abandoned = request("/submit", input).catch(() => undefined);
    await entered(checkpoint);
    const before = await state();
    const job = before.storage[`job:${id}`] as Job;
    expect(job).toMatchObject({ id, nonce: 0, state: "submitted" });
    expect(job.hash).toBe(keccak256(job.raw));
    const signed = parseTransaction(job.raw);
    expect(signed).toMatchObject({
      nonce: 0,
      chainId: manifest.chainId,
      to: manifest.contract,
    });
    const budgetKey = Object.keys(before.storage).find((key) =>
      key.startsWith("gas:"),
    )!;
    expect(before.storage[budgetKey]).toBe(
      (signed.gas! * signed.gasPrice!).toString(),
    );
    expect(before.storage.active).toBe(id);
    expect(before.storage.lastNonce).toBe(0);
    expect(before.alarm).not.toBeNull();
    expect(before.broadcasts).toEqual(
      checkpoint === "broadcast" ? [] : [job.raw],
    );
    await crash(true);
    await abandoned;
    await start();
    const restored = await state();
    expect(reservations(restored)).toEqual(reservations(before));
    expect(restored.alarm).not.toBeNull();
    // A changed fee quote cannot replace/re-sign an uncertain transaction.
    await fixture({ price: "2000000000", broadcastError: true });
    expect((await request("/__alarm")).status).toBe(200);
    const retry = await request("/submit", input);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({
      operationId: id,
      txHash: job.hash,
      state: "submitted",
    });
    const retried = await state();
    expect(retried.broadcasts.length).toBeGreaterThanOrEqual(2);
    expect(retried.broadcasts.every((raw) => raw === job.raw)).toBe(true);
    expect(retried.calls).not.toContain("wallet:eth_chainId");
    expect(retried.calls).not.toContain("estimate");
    expect(reservations(retried)).toEqual(reservations(before));
    expect((await request("/submit", await rotation("2"))).status).toBe(503);

    // The mocked chain later reports inclusion, then six subsequent blocks.
    await fixture({
      head: "105",
      nonce: 1,
      receipts: [[job.hash, { state: "success", block: "100" }]],
    });
    await request("/__alarm");
    expect((await state()).storage.active).toBe(id);
    expect((await state()).storage[`job:${id}`]).toMatchObject({
      state: "included",
    });
    await fixture({ head: "106" });
    await request("/__alarm");
    const confirmed = await state();
    expect(confirmed.storage.active).toBeUndefined();
    expect(confirmed.storage[`job:${id}`]).toMatchObject({
      state: "confirmed",
      raw: job.raw,
      hash: job.hash,
      block: "100",
    });
    expect(confirmed.storage[budgetKey]).toBe(before.storage[budgetKey]);
    const next = await rotation("2");
    expect((await request("/submit", next)).status).toBe(202);
    expect(
      (await state()).storage[
        `job:${operationDigest(manifest.contract as Hex, next.operation)}`
      ],
    ).toMatchObject({ nonce: 1 });
  },
);

it("retains the outbox across ambiguous delivery and receipt outages without creating a fee replacement", async () => {
  const input = await rotation();
  await fixture({ broadcastError: true });
  expect((await request("/submit", input)).status).toBe(202);
  const before = await state();
  const id = operationDigest(manifest.contract as Hex, input.operation);
  const job = before.storage[`job:${id}`] as Job;
  await fixture({ receiptError: true });
  expect((await request(`/operation/${id}`)).status).toBe(503);
  expect((await request("/__alarm")).status).toBe(200);
  const outage = await state();
  expect(reservations(outage)).toEqual(reservations(before));
  expect(outage.alarm).not.toBeNull();
  expect(outage.broadcasts).toEqual([job.raw]);
  await fixture({ receiptError: false, price: "90000000000" });
  expect((await request("/submit", input)).status).toBe(202);
  const retry = await state();
  expect(retry.broadcasts).toEqual([job.raw, job.raw]);
  expect(reservations(retry)).toEqual(reservations(before));
  expect(
    retry.calls.filter((call) => call === "wallet:eth_chainId"),
  ).toHaveLength(1);
});

it.each([
  {
    name: "untracked pending nonce",
    nonce: 0,
    pendingNonce: 1,
    lastNonce: undefined,
  },
  { name: "node behind the journal", nonce: 0, pendingNonce: 0, lastNonce: 0 },
  { name: "external nonce advance", nonce: 2, pendingNonce: 2, lastNonce: 0 },
])(
  "refuses signing and new gas reservations for $name",
  async ({ nonce, pendingNonce, lastNonce }) => {
    await fixture({
      nonce,
      pendingNonce,
      put: lastNonce === undefined ? {} : { lastNonce },
    });
    const before = await state();
    const reply = await request("/submit", await rotation());
    expect(reply.status).toBe(503);
    expect(await reply.json()).toMatchObject({
      error:
        "Sponsor nonce reconciliation is required. No new transaction was signed.",
    });
    const after = await state();
    expect(reservations(after)).toEqual(reservations(before));
    expect(after.broadcasts).toEqual([]);
    expect(after.calls).not.toContain("wallet:eth_chainId");
    expect(after.alarm).toBeNull();
  },
);
