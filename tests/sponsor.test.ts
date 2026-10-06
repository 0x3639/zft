import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";
import { privateKeyToAccount } from "viem/accounts";
import { type Hex } from "viem";
import {
  domain,
  operationDigest,
  rotationMessage,
  rotationTypes,
} from "../packages/protocol";
import type { Challenge } from "../packages/protocol/auth";
import type { Job } from "../apps/api/sponsor";
import manifest from "../packages/protocol/deployment.json";
import { key } from "./fixtures";

let worker: Unstable_DevWorker;
const account = privateKeyToAccount(key);
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
async function post(path: string, data: unknown) {
  return worker.fetch(path, { method: "POST", body: JSON.stringify(data) });
}
async function fixture(data: unknown) {
  expect((await post("/__fixture", data)).ok).toBe(true);
}
async function state() {
  return (await worker.fetch("/__state")).json() as Promise<{
    calls: string[];
    waiting: string[];
    storage: Record<string, unknown>;
  }>;
}
async function bounded<T>(promise: Promise<T>, ms = 2000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Blocked behind RPC")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function entered(name: string) {
  for (let i = 0; i < 100; i++) {
    if ((await state()).waiting.includes(name)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`RPC did not enter ${name}`);
}
function job(n = 1): Job {
  return {
    id: hash(n),
    hash: hash(n + 100),
    raw: "0x1234",
    nonce: 0,
    state: "submitted",
    created: Date.now(),
    operation: {
      kind: "rotate",
      signature: "0x1234",
      authorization: {
        tokenId: "1",
        newOwner: account.address,
        ownershipNonce: "0",
        deadline: String(Math.floor(Date.now() / 1000) + 900),
      },
    },
  };
}
async function challenge(ip = "ip", path: Challenge["path"] = "/api/profile") {
  const input = {
    address: account.address,
    method: "POST",
    path,
    bodyHash: hash(99),
  };
  const response = await post("/challenge", { input, ip });
  expect(response.status).toBe(200);
  const c = (await response.json()) as Challenge & { message: string };
  const signature = await account.signMessage({ message: c.message });
  return {
    id: c.id,
    signature,
    method: input.method,
    path,
    bodyHash: input.bodyHash,
    ip,
  };
}
beforeAll(async () => {
  worker = await unstable_dev("tests/fixtures/sponsor-worker.ts", {
    config: "tests/fixtures/wrangler.sponsor.jsonc",
    local: true,
    port: 0,
    inspectorPort: 0,
    persist: false,
    logLevel: "error",
    experimental: {
      disableExperimentalWarning: true,
      disableDevRegistry: true,
      watch: false,
    },
  });
}, 30_000);
afterAll(async () => {
  await worker?.stop();
});
beforeEach(async () => {
  await fixture({ reset: true });
});

it("serves challenges, one-use authentication and fresh status during a stalled broadcast", async () => {
  const j = job();
  await fixture({
    put: { [`job:${j.id}`]: j, active: j.id },
    hold: ["broadcast"],
  });
  const alarm = worker.fetch("/__alarm");
  await entered("broadcast");
  try {
    const proof = await bounded(challenge());
    const replies = await bounded(
      Promise.all([post("/authenticate", proof), post("/authenticate", proof)]),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 401]);
    await fixture({ receipts: [[j.hash, { state: "success", block: "100" }]] });
    const poll = await bounded(worker.fetch(`/operation/${j.id}`));
    expect(await poll.json()).toMatchObject({
      state: "confirmed",
      blockNumber: "100",
    });
    expect((await state()).storage[`job:${j.id}`]).toMatchObject({
      state: "submitted",
    });
  } finally {
    await fixture({ release: ["broadcast"] });
    await alarm;
  }
  await worker.fetch("/__alarm");
  expect((await state()).storage[`job:${j.id}`]).toMatchObject({
    state: "confirmed",
  });
  expect((await state()).storage.active).toBeUndefined();
});

it("bounds stalled status reads, coalesces polls, and keeps authentication responsive", async () => {
  const j = job(),
    wait = `receipt:${j.hash}`;
  await fixture({ put: { [`job:${j.id}`]: j }, hold: [wait] });
  const start = Date.now();
  const polls = [
    worker.fetch(`/operation/${j.id}`),
    worker.fetch(`/operation/${j.id}`),
  ];
  await entered(wait);
  try {
    expect(
      (await bounded(post("/authenticate", await challenge()))).status,
    ).toBe(200);
    const replies = await bounded(Promise.all(polls), 7000);
    expect(replies.map((r) => r.status)).toEqual([503, 503]);
    expect(Date.now() - start).toBeLessThan(7000);
    expect((await state()).calls.filter((c) => c === wait)).toHaveLength(1);
  } finally {
    await fixture({ release: [wait] });
  }
});

it("a delayed older poll cannot overwrite reconciliation or release its nonce reservation", async () => {
  const j = job(),
    wait = `receipt:${j.hash}`;
  await fixture({ put: { [`job:${j.id}`]: j, active: j.id }, hold: [wait] });
  const poll = worker.fetch(`/operation/${j.id}`);
  await entered(wait);
  try {
    // Only the first observation is stalled; the alarm sees a newer chain view.
    await fixture({
      unhold: [wait],
      receipts: [[j.hash, { state: "success", block: "100" }]],
    });
    await bounded(worker.fetch("/__alarm"));
    expect((await state()).storage[`job:${j.id}`]).toMatchObject({
      state: "confirmed",
      block: "100",
    });
    await fixture({ put: { active: hash(2) } });
  } finally {
    await fixture({ release: [wait] });
  }
  expect(await (await poll).json()).toMatchObject({ state: "submitted" });
  const stored = (await state()).storage;
  expect(stored[`job:${j.id}`]).toMatchObject({
    state: "confirmed",
    block: "100",
  });
  expect(stored.active).toBe(hash(2));
});

it("fails closed for a forked receipt and reports an unknown job without RPC", async () => {
  const j = job();
  expect((await worker.fetch(`/operation/${j.id}`)).status).toBe(404);
  expect((await state()).calls).toHaveLength(0);
  await fixture({
    put: { [`job:${j.id}`]: j },
    receipts: [[j.hash, { state: "success", block: "100" }]],
    mismatch: true,
  });
  expect((await worker.fetch(`/operation/${j.id}`)).status).toBe(503);
  expect((await state()).storage[`job:${j.id}`]).toMatchObject({
    state: "submitted",
  });
});

it("caps outstanding status RPC work and releases capacity only when it settles", async () => {
  const jobs = Array.from({ length: 17 }, (_, i) => job(i + 1));
  const waits = jobs.map((j) => `receipt:${j.hash}`);
  await fixture({
    put: Object.fromEntries(jobs.map((j) => [`job:${j.id}`, j])),
    hold: waits,
  });
  const polls = jobs
    .slice(0, 16)
    .map((j) => worker.fetch(`/operation/${j.id}`));
  try {
    for (const name of waits.slice(0, 16)) await entered(name);
    expect(
      (await bounded(worker.fetch(`/operation/${jobs[16].id}`))).status,
    ).toBe(503);
    expect((await state()).calls).not.toContain(waits[16]);
    await fixture({ release: waits });
    expect((await Promise.all(polls)).every((r) => r.status === 200)).toBe(
      true,
    );
    expect((await worker.fetch(`/operation/${jobs[16].id}`)).status).toBe(200);
  } finally {
    await fixture({ release: waits });
  }
});

it.each(["challenge", "request", "profile"])(
  "enforces the final %s quota slot under concurrent requests",
  async (kind) => {
    const day = Math.floor(Date.now() / 86_400_000);
    if (kind === "challenge") {
      await fixture({ put: { [`quota:${day}:challenge:ip`]: 119 } });
      const input = {
        address: account.address,
        method: "POST",
        path: "/api/profile",
        bodyHash: hash(99),
      };
      const replies = await Promise.all(
        Array.from({ length: 4 }, () =>
          post("/challenge", { input, ip: "ip" }),
        ),
      );
      expect(replies.map((r) => r.status).sort()).toEqual([200, 429, 429, 429]);
    } else {
      const proofs = await Promise.all(
        Array.from({ length: 4 }, () => challenge()),
      );
      const quota =
        kind === "request"
          ? `quota:${day}:request:ip`
          : `quota:${day}:/api/profile:${account.address.toLowerCase()}`;
      await fixture({ put: { [quota]: kind === "request" ? 79 : 59 } });
      const replies = await Promise.all(
        proofs.map((p) => post("/authenticate", p)),
      );
      expect(replies.map((r) => r.status).sort()).toEqual([200, 429, 429, 429]);
      for (const proof of proofs)
        expect((await post("/authenticate", proof)).status).toBe(401);
    }
  },
);

it("keeps concurrent submissions serialized through the durable outbox and recovers after failure", async () => {
  const authorization = {
    tokenId: "1",
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
  await fixture({ hold: ["estimate", "broadcast"] });
  const first = post("/submit", { operation, profile: account.address });
  await entered("estimate");
  const second = post("/submit", { operation, profile: account.address });
  const nextAuthorization = { ...authorization, tokenId: "2" };
  const competingOperation = {
    ...operation,
    authorization: nextAuthorization,
    signature: await account.signTypedData({
      domain: domain(manifest.contract as Hex),
      types: rotationTypes,
      primaryType: "RotateOwnership",
      message: rotationMessage(nextAuthorization),
    }),
  };
  const competing = post("/submit", {
    operation: competingOperation,
    profile: account.address,
  });
  try {
    expect(
      (await bounded(post("/authenticate", await challenge()))).status,
    ).toBe(200);
    await fixture({ release: ["estimate"] });
    await entered("broadcast");
    const stored = (await state()).storage;
    const id = operationDigest(manifest.contract as Hex, operation);
    expect(stored.active).toBe(id);
    expect(stored.lastNonce).toBe(0);
    expect(stored[`job:${id}`]).toMatchObject({ state: "submitted", nonce: 0 });
    expect((await state()).calls.filter((c) => c === "estimate")).toHaveLength(
      1,
    );
  } finally {
    await fixture({ release: ["estimate", "broadcast"] });
  }
  const replies = await Promise.all([first, second]);
  expect(replies.map((r) => r.status)).toEqual([202, 202]);
  expect(await replies[0].json()).toEqual(await replies[1].json());
  expect((await competing).status).toBe(503);
  expect((await state()).calls.filter((c) => c === "estimate")).toHaveLength(1);
  expect((await post("/submit", {})).status).toBe(503);
  expect((await post("/authenticate", await challenge())).status).toBe(200);
});
