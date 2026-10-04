import { beforeEach, it, expect, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Vault, ItemRecord } from "../packages/vault";
import { type Deployment, type Operation, digest } from "../packages/protocol";
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
import { submit } from "../apps/web/src/flows";
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
