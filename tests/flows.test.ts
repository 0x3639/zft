import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Vault, ItemRecord } from "../packages/vault";
import {
  type Deployment,
  type Operation,
  digest,
  operationDigest,
} from "../packages/protocol";
import { contract, envelope, source, key } from "./fixtures";
const chainMocks = vi.hoisted(() => ({
  check: vi.fn(),
  owner: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../packages/protocol/client", () => ({
  checkDeployment: chainMocks.check,
  ownership: chainMocks.owner,
  publicClient: { readContract: chainMocks.read },
}));
const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../apps/web/src/api", async (original) => ({
  ...(await original<typeof import("../apps/web/src/api")>()),
  api: apiMocks.get,
  signedRequest: apiMocks.post,
}));
import { ApiError } from "../apps/web/src/api";
import { submit, reconcile } from "../apps/web/src/flows";
const d: Deployment = {
  contract,
  chainId: 7340469,
  genesisHash: digest("genesis"),
  codeHash: digest("code"),
  deploymentBlock: "0",
  deploymentBlockHash: digest("block"),
  metadataOrigin: "https://zft.foo",
};
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
function pendingClaim(deadline = "1"): ItemRecord {
  const privateKey = generatePrivateKey();
  const operation: Operation = {
    kind: "rotate",
    authorization: {
      tokenId: "42",
      newOwner: privateKeyToAccount(privateKey).address,
      ownershipNonce: "0",
      deadline,
    },
    signature: ("0x" + "11".repeat(65)) as `0x${string}`,
  };
  return {
    kind: "item",
    tokenId: "42",
    privateKey,
    previousKeys: [key],
    image: "",
    metadata: envelope(source()).metadata,
    nonce: "1",
    status: "pending",
    operation,
    operationId: operationDigest(contract, operation),
  };
}
it.each(["absent", "failed"])(
  "keeps a %s claim resumable and retries with the same recipient",
  async (jobState) => {
    const original = pendingClaim();
    let saved = { ...original, status: "stale" as ItemRecord["status"] };
    const vault = {
      requireBackup: vi.fn(),
      profile: async () => privateKeyToAccount(key),
      saveItem: async (next: ItemRecord, expected: ItemRecord) => {
        expect(expected).toEqual(saved);
        saved = next;
      },
    } as unknown as Vault;
    if (jobState === "absent")
      apiMocks.get.mockRejectedValue(new ApiError(404, "Unknown operation"));
    else
      apiMocks.get.mockResolvedValue({
        state: "failed",
        txHash: digest("failed"),
        operationId: original.operationId,
      });
    chainMocks.owner.mockResolvedValue({
      owner: privateKeyToAccount(key).address,
      nonce: "0",
      metadataHash: digest(original.metadata),
    });
    await reconcile(vault, d, saved);
    expect(saved).toMatchObject({
      status: "pending",
      nonce: "1",
      privateKey: original.privateKey,
      previousKeys: [key],
      operation: original.operation,
    });
    apiMocks.post.mockImplementation(async (_path: string, op: Operation) => {
      expect(saved.operation).toEqual(op); // Renewed signature must already be durable.
      return {
        operationId: operationDigest(contract, op),
        txHash: digest("new"),
        state: "submitted",
      };
    });
    await submit(vault, d, saved);
    expect(saved.operationId).not.toBe(original.operationId);
    expect(saved.privateKey).toBe(original.privateKey);
    expect(saved.nonce).toBe("1");
    expect(saved.operation?.authorization).toMatchObject({
      newOwner: privateKeyToAccount(original.privateKey).address,
      ownershipNonce: "0",
    });
  },
);
it("renews a failed job before expiry with a distinct digest inside the sponsor deadline limit", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const now = Math.floor(Date.now() / 1000),
    original = pendingClaim(String(now + 900));
  const save = vi.fn();
  const vault = {
    requireBackup: vi.fn(),
    profile: async () => privateKeyToAccount(key),
    saveItem: save,
  } as unknown as Vault;
  apiMocks.get.mockResolvedValue({
    state: "failed",
    operationId: original.operationId,
    txHash: digest("failed"),
  });
  chainMocks.owner.mockResolvedValue({
    owner: privateKeyToAccount(key).address,
    nonce: "0",
  });
  apiMocks.post.mockImplementation(async (_path: string, op: Operation) => ({
    operationId: operationDigest(contract, op),
    txHash: digest("new"),
    state: "submitted",
  }));
  await submit(vault, d, original);
  const renewed = save.mock.calls[0][0] as ItemRecord;
  expect(renewed.operationId).not.toBe(original.operationId);
  expect(Number(renewed.operation?.authorization.deadline)).toBe(now + 899);
  expect(renewed.privateKey).toBe(original.privateKey);
});
it.each(["submitted", "included", "confirmed"])(
  "does not replace a %s job even after its signature expires",
  async (state) => {
    const original = pendingClaim(),
      job = { state, operationId: original.operationId, txHash: digest("tx") },
      save = vi.fn();
    const vault = {
      requireBackup: vi.fn(),
      profile: async () => privateKeyToAccount(key),
      saveItem: save,
    } as unknown as Vault;
    apiMocks.get.mockResolvedValue(job);
    apiMocks.post.mockResolvedValue(job);
    await submit(vault, d, original);
    expect(chainMocks.owner).not.toHaveBeenCalled();
    expect(apiMocks.post.mock.calls[0][1]).toEqual(original.operation);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].privateKey).toBe(original.privateKey);
  },
);
it("marks a claim stale when a different key wins the race", async () => {
  const original = pendingClaim(),
    save = vi.fn();
  const vault = { saveItem: save } as unknown as Vault;
  apiMocks.get.mockRejectedValue(new ApiError(404, "Unknown operation"));
  chainMocks.owner.mockResolvedValue({
    owner: privateKeyToAccount(generatePrivateKey()).address,
    nonce: "2",
    metadataHash: digest(original.metadata),
  });
  await reconcile(vault, d, original);
  expect(save.mock.calls[0][0]).toMatchObject({
    status: "stale",
    nonce: "2",
    privateKey: original.privateKey,
    previousKeys: [key],
  });
});
it("renews an expired unsent claim without replacing its durably saved recipient key", async () => {
  const newKey = generatePrivateKey(),
    recipient = privateKeyToAccount(newKey).address;
  const operation: Operation = {
    kind: "rotate",
    authorization: {
      tokenId: "42",
      newOwner: recipient,
      ownershipNonce: "0",
      deadline: "1",
    },
    signature: ("0x" + "11".repeat(65)) as `0x${string}`,
  };
  const item: ItemRecord = {
    kind: "item",
    tokenId: "42",
    privateKey: newKey,
    previousKeys: [key],
    image: "",
    metadata: envelope(source()).metadata,
    nonce: "1",
    status: "pending",
    operation,
    operationId: digest("old"),
  };
  const saved: ItemRecord[] = [];
  const vault = {
    requireBackup: vi.fn(),
    profile: async () => privateKeyToAccount(generatePrivateKey()),
    saveItem: async (r: ItemRecord) => {
      saved.push(r);
    },
  } as unknown as Vault;
  apiMocks.get.mockRejectedValue(new ApiError(404, "Unknown operation"));
  chainMocks.owner.mockResolvedValue({
    owner: privateKeyToAccount(key).address,
    nonce: "0",
  });
  apiMocks.post.mockImplementation(async (_path: string, op: Operation) => {
    expect(saved).toHaveLength(1);
    expect(saved[0].operation).toEqual(op);
    return {
      operationId: digest("new"),
      txHash: digest("tx"),
      state: "submitted",
    };
  });
  await submit(vault, d, item);
  expect(saved[0].privateKey).toBe(newKey);
  expect(saved[0].previousKeys).toEqual([key]);
  expect(saved[0].operation?.authorization).toMatchObject({
    newOwner: recipient,
    ownershipNonce: "0",
  });
});
it("does not renew or discard a pending request when job lookup is unavailable", async () => {
  const save = vi.fn(),
    op: Operation = {
      kind: "mint",
      authorization: {
        imageHash: digest("image"),
        metadataHash: digest("meta"),
        initialOwner: contract,
        creator: contract,
        creatorNonce: "0",
        deadline: "1",
      },
      signature: ("0x" + "11".repeat(65)) as `0x${string}`,
    };
  const vault = {
    requireBackup: vi.fn(),
    profile: async () => privateKeyToAccount(key),
    saveItem: save,
  } as unknown as Vault;
  apiMocks.get.mockRejectedValue(new ApiError(503, "Unavailable"));
  await expect(
    submit(vault, d, {
      operation: op,
      operationId: digest("old"),
    } as ItemRecord),
  ).rejects.toThrow("Unavailable");
  expect(save).not.toHaveBeenCalled();
  expect(apiMocks.post).not.toHaveBeenCalled();
});
