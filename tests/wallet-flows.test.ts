import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData, zeroAddress, type Address } from "viem";
import { Vault, type ItemRecord } from "../packages/vault";
import {
  digest,
  domain,
  rotationTypes,
  rotationMessage,
  type Deployment,
  type Operation,
} from "../packages/protocol";
import { exportFile } from "../packages/file-codec";
import { contract, envelope, source } from "./fixtures";
const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  owner: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("../packages/protocol/client", () => ({
  checkDeployment: mocks.check,
  ownership: mocks.owner,
  publicClient: {},
}));
vi.mock("../apps/web/src/api", async (original) => ({
  ...(await original<typeof import("../apps/web/src/api")>()),
  api: mocks.get,
  signedRequest: mocks.post,
}));
import { ApiError } from "../apps/web/src/api";
import {
  prepareWalletFile,
  authorizeWalletFile,
  moveFileToWallet,
} from "../apps/web/src/wallet-flows";
import { reconcile, readTransfer, type Job } from "../apps/web/src/flows";
import { network, type WalletSession } from "../apps/web/src/wallet";

const deployment: Deployment = {
  contract,
  chainId: 7340469,
  genesisHash: digest("genesis"),
  codeHash: digest("code"),
  deploymentBlock: "0",
  deploymentBlockHash: digest("block"),
  metadataOrigin: "https://zft.foo",
};
const passphrase = "wallet test recovery password";
const image = source(),
  fixture = envelope(image);
const openVaults: Vault[] = [];
async function newVault(name = crypto.randomUUID()) {
  const vault = await Vault.open(deployment, name);
  openVaults.push(vault);
  return vault;
}
async function backup(vault: Vault) {
  const bundle = await vault.backup();
  await vault.acknowledgeBackup(bundle.revision);
  return bundle;
}
async function setup() {
  const name = crypto.randomUUID(),
    vault = await newVault(name);
  await vault.create(passphrase);
  await backup(vault);
  const walletKey = generatePrivateKey();
  const wallet = privateKeyToAccount(walletKey);
  const state = {
    owner: wallet.address,
    nonce: "0",
    metadataHash: digest(fixture.metadata),
    approved: zeroAddress,
  };
  mocks.owner.mockImplementation(async () => ({ ...state }));
  const active = {
    account: wallet.address as Address,
    chain: network.chainId,
    current: true,
  };
  const sign = vi.fn(async (encoded: string) => {
    const data = JSON.parse(encoded);
    return wallet.signTypedData({
      domain: data.domain,
      types: rotationTypes,
      primaryType: "RotateOwnership",
      message: rotationMessage(data.message),
    });
  });
  const session: WalletSession = {
    account: wallet.address,
    chainId: active.chain,
    isCurrent: () => active.current,
    provider: {
      request: async ({ method, params }) => {
        if (method === "eth_chainId") return active.chain;
        if (method === "eth_accounts") return [active.account];
        if (method === "eth_signTypedData_v4") return sign(String(params![1]));
        throw new Error(`Unexpected method ${method}`);
      },
    },
  };
  const prepare = () =>
    prepareWalletFile(vault, deployment, session, fixture, image);
  const saved = async () =>
    (await vault.get(`item:${fixture.tokenId}`)) as ItemRecord;
  const jobs = new Map<string, Job>();
  mocks.get.mockImplementation(async (path: string) => {
    const job = jobs.get(path.split("/").at(-1)!);
    if (!job) throw new ApiError(404, "Unknown operation");
    return job;
  });
  mocks.post.mockImplementation(async (_path: string, op: Operation) => {
    const record = await saved();
    expect(record.operation).toEqual(op); // Exact authority is durable before sending.
    const job: Job = {
      operationId: record.operationId!,
      txHash: digest(record.operationId!),
      state: "submitted",
    };
    jobs.set(job.operationId, job);
    return job;
  });
  return {
    name,
    vault,
    wallet,
    walletKey,
    state,
    active,
    sign,
    session,
    prepare,
    saved,
    jobs,
  };
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  for (const vault of openVaults.splice(0)) vault.close();
  vi.restoreAllMocks();
});

it("requires the new file key in an acknowledged recovery and restores it without a wallet private key", async () => {
  const s = await setup();
  const early = await s.vault.backup();
  const prepared = await s.prepare();
  await expect(
    authorizeWalletFile(s.vault, deployment, s.session, prepared),
  ).rejects.toThrow("recovery file");
  expect(s.sign).not.toHaveBeenCalled();
  const revisions = await s.vault.revisions();
  await reconcile(s.vault, deployment, prepared);
  expect(await s.saved()).toEqual(prepared);
  expect(await s.vault.revisions()).toEqual(revisions); // Status checks do not invalidate backups.
  const latest = await backup(s.vault);
  const restored = await newVault();
  await restored.restore(latest.text, passphrase);
  expect(await restored.items()).toEqual([prepared]);
  expect(JSON.stringify(await restored.items())).not.toContain(s.walletKey);
  expect(prepared.privateKey).not.toBe(s.walletKey);
  const old = await newVault();
  await old.restore(early.text, passphrase);
  expect(await old.items()).toEqual([]);
  await expect(s.prepare()).rejects.toThrow("saved operation");
  await authorizeWalletFile(s.vault, deployment, s.session, prepared);
  expect(s.sign).toHaveBeenCalledTimes(1);
  const signed = await s.saved();
  expect(signed.privateKey).toBe(prepared.privateKey);
  expect(signed.operation!.authorization).toMatchObject({
    newOwner: privateKeyToAccount(prepared.privateKey).address,
    ownershipNonce: "0",
  });
});

it("authorizes an acknowledged key after an unrelated new key changes the vault, while keeping the new key gated", async () => {
  const s = await setup(),
    prepared = await s.prepare();
  const snapshot = await backup(s.vault);
  const unrelated: ItemRecord = {
    ...prepared,
    tokenId: "1",
    privateKey: generatePrivateKey(),
  };
  await s.vault.saveItem(unrelated, null);
  expect(await s.vault.revisions()).toEqual({
    current: snapshot.revision + 1,
    backedUp: snapshot.revision,
  });

  await authorizeWalletFile(s.vault, deployment, s.session, prepared);
  expect(s.sign).toHaveBeenCalledOnce();
  expect(mocks.post).toHaveBeenCalledOnce();
  const submitted = await s.saved();
  expect(submitted.privateKey).toBe(prepared.privateKey);
  expect(submitted.operation?.authorization).toMatchObject({
    newOwner: privateKeyToAccount(prepared.privateKey).address,
  });
  await expect(
    authorizeWalletFile(s.vault, deployment, s.session, unrelated),
  ).rejects.toThrow("recovery file");
  expect(s.sign).toHaveBeenCalledOnce();
  expect(mocks.post).toHaveBeenCalledOnce();
});

it("requires legacy vaults without an acknowledged-key inventory to back up before prompting the wallet", async () => {
  const s = await setup(),
    prepared = await s.prepare();
  await backup(s.vault);
  const db = await openDB(`${s.name}:${s.vault.namespace}`);
  try {
    const header = await db.get("meta", "header");
    delete header.backedUpKeys;
    await db.put("meta", header, "header");
  } finally {
    db.close();
  }
  const revisions = await s.vault.revisions();
  expect(revisions.backedUp).toBe(revisions.current);
  await expect(
    authorizeWalletFile(s.vault, deployment, s.session, prepared),
  ).rejects.toThrow("recovery file");
  expect(s.sign).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
  expect(await s.saved()).toEqual(prepared);

  await backup(s.vault);
  await authorizeWalletFile(s.vault, deployment, s.session, prepared);
  expect(s.sign).toHaveBeenCalledOnce();
  expect(mocks.post).toHaveBeenCalledOnce();
});

it.each(["reject", "account", "chain", "disconnect", "different recipient"])(
  "keeps the prepared key and submits nothing after wallet %s during the prompt",
  async (change) => {
    const s = await setup(),
      prepared = await s.prepare();
    await backup(s.vault);
    s.sign.mockImplementation(async (encoded) => {
      if (change === "reject") throw new Error("User rejected request");
      const data = JSON.parse(encoded);
      if (change === "account")
        s.active.account = privateKeyToAccount(generatePrivateKey()).address;
      if (change === "chain") s.active.chain = "0x1";
      if (change === "disconnect") s.active.current = false;
      if (change === "different recipient") data.message.newOwner = contract;
      return s.wallet.signTypedData({
        domain: data.domain,
        types: rotationTypes,
        primaryType: "RotateOwnership",
        message: rotationMessage(data.message),
      });
    });
    await expect(
      authorizeWalletFile(s.vault, deployment, s.session, prepared),
    ).rejects.toThrow();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(await s.saved()).toEqual(prepared);
  },
);

it("recovers a lost sponsor response and transaction hash without another wallet signature", async () => {
  const s = await setup(),
    prepared = await s.prepare();
  await backup(s.vault);
  mocks.post.mockImplementationOnce(async () => {
    const saved = await s.saved();
    s.jobs.set(saved.operationId!, {
      operationId: saved.operationId!,
      txHash: digest("lost"),
      state: "submitted",
    });
    throw new Error("Response lost");
  });
  await expect(
    authorizeWalletFile(s.vault, deployment, s.session, prepared),
  ).rejects.toThrow("Response lost");
  expect((await s.saved()).txHash).toBeUndefined();
  await authorizeWalletFile(s.vault, deployment, s.session, await s.saved());
  expect((await s.saved()).txHash).toBe(digest("lost"));
  expect(s.sign).toHaveBeenCalledTimes(1);
  expect(mocks.post).toHaveBeenCalledTimes(1);
});

it("renews an expired absent authorization to the same backed-up key but fails closed on an unavailable job lookup", async () => {
  const s = await setup(),
    prepared = await s.prepare();
  await backup(s.vault);
  mocks.post.mockRejectedValueOnce(new Error("Sponsor unavailable"));
  await expect(
    authorizeWalletFile(s.vault, deployment, s.session, prepared),
  ).rejects.toThrow("Sponsor unavailable");
  const before = await s.saved();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 901_000);
  mocks.get.mockRejectedValueOnce(new ApiError(503, "Job lookup unavailable"));
  await expect(
    authorizeWalletFile(s.vault, deployment, s.session, before),
  ).rejects.toThrow("Job lookup unavailable");
  expect(s.sign).toHaveBeenCalledTimes(1);
  await authorizeWalletFile(s.vault, deployment, s.session, before);
  expect((await s.saved()).privateKey).toBe(prepared.privateKey);
  expect((await s.saved()).operationId).not.toBe(before.operationId);
  expect(s.sign).toHaveBeenCalledTimes(2);
});

it("performs the custody round trip with scoped signatures and rejects the old exported file after wallet ownership", async () => {
  const s = await setup(),
    prepared = await s.prepare();
  await backup(s.vault);
  const into = await authorizeWalletFile(
    s.vault,
    deployment,
    s.session,
    prepared,
  );
  s.state.owner = privateKeyToAccount(prepared.privateKey).address;
  s.state.nonce = "1";
  s.jobs.set(into.operationId, { ...into, state: "confirmed" });
  await reconcile(s.vault, deployment, await s.saved());
  expect((await s.saved()).status).toBe("owned");
  const bytes = await exportFile(image, {
    ...fixture,
    authority: {
      scheme: "secp256k1",
      privateKey: prepared.privateKey,
      ownershipNonce: "1",
    },
  });
  const file = new File([bytes as BlobPart], "transfer.zft.png");
  await expect(readTransfer(file, deployment)).resolves.toBeDefined();
  const out = await moveFileToWallet(
    s.vault,
    deployment,
    s.session,
    await s.saved(),
  );
  const op = (await s.saved()).operation!;
  if (op.kind !== "rotate") throw new Error("Expected rotation");
  expect(
    await verifyTypedData({
      address: s.state.owner,
      domain: domain(contract),
      types: rotationTypes,
      primaryType: "RotateOwnership",
      message: rotationMessage(op.authorization),
      signature: op.signature,
    }),
  ).toBe(true);
  expect(op.authorization.newOwner).toBe(s.wallet.address);
  s.jobs.set(out.operationId, { ...out, state: "confirmed" });
  s.state.owner = s.wallet.address;
  s.state.nonce = "2";
  await reconcile(s.vault, deployment, await s.saved());
  expect((await s.saved()).status).toBe("wallet");
  await expect(readTransfer(file, deployment)).rejects.toThrow("stale");
  expect(s.sign).toHaveBeenCalledTimes(1); // Returning custody never needs or exports a wallet private key.
  const next = await s.prepare();
  expect(next.privateKey).not.toBe(prepared.privateKey);
  expect(next.previousKeys).toContain(prepared.privateKey);
});
it("renews a reverted wallet transfer in the same second without replacing its backed-up key", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  const s = await setup(),
    prepared = await s.prepare();
  await backup(s.vault);
  const first = await authorizeWalletFile(
    s.vault,
    deployment,
    s.session,
    prepared,
  );
  const before = await s.saved();
  s.jobs.set(first.operationId, { ...first, state: "failed" });
  await authorizeWalletFile(s.vault, deployment, s.session, before);
  const after = await s.saved();
  expect(after.operationId).not.toBe(before.operationId);
  expect(after.privateKey).toBe(before.privateKey);
  expect(after.operation?.authorization).toMatchObject({
    newOwner: privateKeyToAccount(before.privateKey).address,
  });
  expect(s.sign).toHaveBeenCalledTimes(2);
});

it("preserves a newer record when another tab edits during the signature prompt", async () => {
  const s = await setup(),
    prepared = await s.prepare();
  await backup(s.vault);
  s.sign.mockImplementationOnce(async (encoded) => {
    await s.vault.saveItem({ ...prepared, status: "stale" }, prepared);
    const data = JSON.parse(encoded);
    return s.wallet.signTypedData({
      domain: data.domain,
      types: rotationTypes,
      primaryType: "RotateOwnership",
      message: rotationMessage(data.message),
    });
  });
  await expect(
    authorizeWalletFile(s.vault, deployment, s.session, prepared),
  ).rejects.toThrow("changed");
  expect(mocks.post).not.toHaveBeenCalled();
  expect((await s.saved()).status).toBe("stale");
  await expect(s.vault.saveItem(prepared, prepared)).rejects.toThrow("changed");
});

it("refuses stale on-chain ownership and RPC failure before preparing another key", async () => {
  const s = await setup();
  s.state.owner = contract;
  await expect(s.prepare()).rejects.toThrow("no longer owns");
  expect(await s.vault.items()).toEqual([]);
  mocks.owner.mockRejectedValueOnce(new Error("RPC unavailable"));
  await expect(s.prepare()).rejects.toThrow("RPC unavailable");
  expect(await s.vault.items()).toEqual([]);
});
