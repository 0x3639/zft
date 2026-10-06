// Hosted smoke only: public reads plus one deliberately invalid authenticated
// request. No image/profile mutation, token operation, or funding is performed.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sha256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { challengeText, type Challenge } from "../packages/protocol/auth";
import { releaseConfig, releaseHealth } from "./release-health";

const origin = "https://devnet.zft.foo";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const headers = { Origin: origin, "Content-Type": "application/json" };
async function request(path: string, init?: RequestInit) {
  return fetch(origin + path, { ...init, signal: AbortSignal.timeout(10_000) });
}
const healthResponse = await request("/api/health");
assert.equal(healthResponse.status, 200);
const health = releaseHealth.parse(await healthResponse.json());
const configResponse = await request("/api/config");
assert.equal(configResponse.status, 200);
const config = releaseConfig.parse(await configResponse.json());
const historical = [
  {
    id: "0xa2a312f640a42d9b2c64065cb03e506622f491568adfa0ad1d4688840c3d91e1",
    txHash:
      "0xc041c43c3877a8897879a4ffc333e59a708d242788ce661e719ab53d828951c1",
  },
  {
    id: "0x790d8cf93e8d27630cf37730463e174ba7003c1d27f13339859509f683cc9639",
    txHash:
      "0x6b5b3dee2912168b2e30cc436b8ca54b01dfe8b48743c6be7f6953ec135b493e",
  },
];
const observations = [];
for (const known of historical) {
  const started = Date.now();
  const response = await request(`/api/operations/${known.id}`);
  assert.equal(response.status, 200);
  const job = (await response.json()) as {
    operationId: string;
    txHash: string;
    state: string;
    blockNumber: string;
  };
  assert.equal(job.operationId, known.id);
  assert.equal(job.txHash, known.txHash);
  assert.equal(job.state, "confirmed");
  assert(BigInt(job.blockNumber) > 0n);
  observations.push({ ...job, elapsedMs: Date.now() - started });
}
const unknown = await request(`/api/operations/0x${"0".repeat(64)}`);
assert.equal(unknown.status, 404);
const account = privateKeyToAccount(generatePrivateKey());
const body = "{}";
const input = {
  address: account.address,
  method: "POST" as const,
  path: "/api/operations" as const,
  bodyHash: sha256(new TextEncoder().encode(body)),
};
const start = Date.now();
const response = await request("/api/challenges", {
  method: "POST",
  headers,
  body: JSON.stringify(input),
});
assert.equal(response.status, 200);
const challenge = (await response.json()) as Challenge & { message: string };
assert.equal(challenge.origin, origin);
for (const [key, value] of Object.entries(input))
  assert.equal(challenge[key as keyof Challenge], value);
assert.equal(challenge.message, challengeText(challenge));
const signature = await account.signMessage({ message: challenge.message });
const proofHeaders = {
  ...headers,
  "x-zft-challenge": challenge.id,
  "x-zft-signature": signature,
};
const admitted = await request("/api/operations", {
  method: "POST",
  headers: proofHeaders,
  body,
});
assert.equal(admitted.status, 400);
assert.deepEqual(await admitted.json(), { error: "Invalid request format." });
const replay = await request("/api/operations", {
  method: "POST",
  headers: proofHeaders,
  body,
});
assert.equal(replay.status, 401);
const auth = {
  admittedToValidation: 400,
  replayRejected: 401,
  elapsedMs: Date.now() - start,
};
const html = await readFile("dist/web/index.html", "utf8");
const bundle = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
assert(bundle);
const asset = await request(bundle);
assert.equal(asset.status, 200);
const bundleHash = hash(new Uint8Array(await asset.arrayBuffer()));
assert.equal(bundleHash, hash(await readFile(`dist/web${bundle}`)));
await writeFile(
  "research/sponsor-isolation-deployment.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      origin,
      health,
      config,
      observations,
      unknownOperation: 404,
      auth,
      bundle: { path: bundle, sha256: bundleHash },
      scope:
        "Healthy hosted smoke; stalled RPC and concurrency faults are exercised only in local workerd.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ observations, auth, bundle, healthy: true }, null, 2),
);
