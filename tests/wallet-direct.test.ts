import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hexToString, verifyTypedData, type Hex } from "viem";
import {
  WalletJournal,
  type WalletDraft,
} from "../apps/web/src/wallet-journal";
import {
  CANONICALIZER,
  digest,
  domain,
  mintMessage,
  mintTypes,
  rotationMessage,
  rotationTypes,
  type Deployment,
  type Operation,
} from "../packages/protocol";
import { contract, envelope, source, key } from "./fixtures";
import { network, type WalletSession } from "../apps/web/src/wallet";
const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  owner: vi.fn(),
  read: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("../packages/protocol/client", () => ({
  checkDeployment: mocks.check,
  ownership: mocks.owner,
  publicClient: { readContract: mocks.read },
}));
vi.mock("../apps/web/src/api", async (original) => ({
  ...(await original<typeof import("../apps/web/src/api")>()),
  api: mocks.get,
  signedRequest: mocks.post,
}));
import { ApiError } from "../apps/web/src/api";
import {
  prepareWalletMint,
  prepareWalletClaim,
  reconcileWallet,
  submitWallet,
} from "../apps/web/src/wallet-direct";
import { walletIdentity } from "../apps/web/src/identity";
const d: Deployment = {
  contract,
  chainId: 7340469,
  genesisHash: digest("genesis"),
  codeHash: digest("code"),
  deploymentBlock: "0",
  deploymentBlockHash: digest("block"),
  metadataOrigin: "https://zft.foo",
};
const journals: WalletJournal[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(0n);
});
afterEach(() => {
  journals.splice(0).forEach((j) => j.close());
  vi.restoreAllMocks();
});
async function setup() {
  const walletKey = generatePrivateKey(),
    wallet = privateKeyToAccount(walletKey),
    name = crypto.randomUUID();
  const journal = await WalletJournal.open(d, name);
  journals.push(journal);
  const active = {
    account: wallet.address,
    chain: network.chainId,
    connected: true,
  };
  const typed = vi.fn(async (data: string) => {
    const value = JSON.parse(data);
    return wallet.signTypedData({
      domain: value.domain,
      types: mintTypes,
      primaryType: "Mint",
      message: mintMessage(value.message),
    });
  });
  const personal = vi.fn(async (data: Hex) =>
    wallet.signMessage({ message: hexToString(data) }),
  );
  const session: WalletSession = {
    account: wallet.address,
    chainId: active.chain,
    isCurrent: () => active.connected,
    provider: {
      request: async ({ method, params }) => {
        if (method === "eth_chainId") return active.chain;
        if (method === "eth_accounts") return [active.account];
        if (method === "eth_signTypedData_v4") return typed(String(params![1]));
        if (method === "personal_sign") return personal(params![0] as Hex);
        throw new Error(`Unexpected wallet method ${method}`);
      },
    },
  };
  const image = source(),
    fixture = envelope(image);
  mocks.owner.mockResolvedValue({
    owner: privateKeyToAccount(key).address,
    nonce: fixture.authority.ownershipNonce,
    metadataHash: digest(fixture.metadata),
  });
  mocks.get.mockRejectedValue(new ApiError(404, "Unknown operation"));
  mocks.post.mockImplementation(async (path: string, operation: Operation) => {
    if (path === "/api/uploads") return {};
    const saved = await journal.get(wallet.address, fixture.tokenId);
    expect(saved?.operation).toEqual(operation);
    return {
      operationId: saved!.operationId!,
      txHash: digest("tx"),
      state: "submitted",
    };
  });
  const prepare = () =>
    prepareWalletMint(
      journal,
      d,
      session,
      {
        bytes: image,
        width: fixture.metadata.width,
        height: fixture.metadata.height,
        imageHash: fixture.imageHash,
      },
      "Wallet artwork",
      "",
    );
  return {
    journal,
    wallet,
    walletKey,
    name,
    session,
    active,
    typed,
    personal,
    image,
    fixture,
    prepare,
  };
}
it("mints directly to the wallet and restores the exact pending request after reload without any private keys", async () => {
  const s = await setup(),
    record = await s.prepare();
  expect(record.metadata.creator).toBe(s.wallet.address);
  expect(record.metadata.canonicalizer).toBe(CANONICALIZER);
  expect(mocks.post).not.toHaveBeenCalled();
  mocks.post.mockRejectedValueOnce(new Error("Upload unavailable"));
  await expect(submitWallet(s.journal, d, s.session, record)).rejects.toThrow(
    "Upload unavailable",
  );
  s.journal.close();
  const reopened = await WalletJournal.open(d, s.name);
  journals.push(reopened);
  const saved = (await reopened.list(s.wallet.address))[0];
  const op = saved.operation!;
  if (op.kind !== "mint") throw new Error("Expected mint");
  expect(op.authorization.initialOwner).toBe(s.wallet.address);
  expect(
    await verifyTypedData({
      address: s.wallet.address,
      domain: domain(contract),
      types: mintTypes,
      primaryType: "Mint",
      message: mintMessage(op.authorization),
      signature: op.signature,
    }),
  ).toBe(true);
  mocks.post.mockImplementation(async () => ({
    operationId: saved.operationId!,
    txHash: digest("tx"),
    state: "submitted",
    confirmationPolicy:
      "6 subsequent EVM blocks; application policy, not a protocol-finality guarantee",
  }));
  await submitWallet(reopened, d, s.session, saved);
  expect(s.typed).toHaveBeenCalledOnce();
  expect(
    (await reopened.get(s.wallet.address, saved.tokenId))!.operation,
  ).toEqual(op);
  expect(
    (await reopened.get(s.wallet.address, saved.tokenId))!.job
      ?.confirmationPolicy,
  ).toContain("6 subsequent EVM blocks");
  const db = await openDB(`${s.name}:${d.chainId}:${contract.toLowerCase()}`);
  const raw = JSON.stringify(await db.getAll("operations"));
  db.close();
  expect(raw).not.toContain(s.walletKey);
  expect(raw).not.toContain('"privateKey"');
});
it.each(["reject", "account", "chain", "disconnect", "recipient"])(
  "keeps the unsigned mint draft and sends nothing when the wallet changes: %s",
  async (change) => {
    const s = await setup(),
      record = await s.prepare();
    s.typed.mockImplementation(async (encoded) => {
      if (change === "reject") throw new Error("User rejected request");
      const data = JSON.parse(encoded);
      if (change === "account") s.active.account = contract;
      if (change === "chain") s.active.chain = "0x1";
      if (change === "disconnect") s.active.connected = false;
      if (change === "recipient") data.message.initialOwner = contract;
      return s.wallet.signTypedData({
        domain: data.domain,
        types: mintTypes,
        primaryType: "Mint",
        message: mintMessage(data.message),
      });
    });
    await expect(
      submitWallet(s.journal, d, s.session, record),
    ).rejects.toThrow();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(await s.journal.get(s.wallet.address, record.tokenId)).toEqual(
      record,
    );
  },
);
it("claims a file into the wallet without persisting its disposable key", async () => {
  const s = await setup(),
    transfer = { image: s.image, envelope: s.fixture };
  const record = await prepareWalletClaim(s.journal, d, s.session, transfer);
  await submitWallet(s.journal, d, s.session, record, transfer);
  const saved = (await s.journal.list(s.wallet.address))[0],
    op = saved.operation!;
  if (op.kind !== "rotate") throw new Error("Expected rotate");
  expect(op.authorization.newOwner).toBe(s.wallet.address);
  expect(
    await verifyTypedData({
      address: privateKeyToAccount(key).address,
      domain: domain(contract),
      types: rotationTypes,
      primaryType: "RotateOwnership",
      message: rotationMessage(op.authorization),
      signature: op.signature,
    }),
  ).toBe(true);
  expect(JSON.stringify(saved)).not.toContain(key);
  expect(JSON.stringify(saved)).not.toContain(s.walletKey);
  expect(s.typed).not.toHaveBeenCalled();
  mocks.owner.mockResolvedValue({
    owner: contract,
    nonce: "1",
    metadataHash: digest(s.fixture.metadata),
  });
  await expect(
    prepareWalletClaim(s.journal, d, s.session, transfer),
  ).rejects.toThrow("stale");
});
it("preserves an ambiguous job, renews expired mint consent and requires the original file to renew a claim", async () => {
  const s = await setup(),
    record = await s.prepare();
  await submitWallet(s.journal, d, s.session, record);
  const saved = (await s.journal.list(s.wallet.address))[0];
  mocks.get.mockRejectedValueOnce(new ApiError(503, "Unknown outcome"));
  await expect(submitWallet(s.journal, d, s.session, saved)).rejects.toThrow(
    "Unknown outcome",
  );
  expect(await s.journal.get(s.wallet.address, saved.tokenId)).toEqual(saved);
  mocks.get.mockResolvedValue({ ...saved.job, state: "failed" });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 901_000);
  await submitWallet(s.journal, d, s.session, saved);
  expect(s.typed).toHaveBeenCalledTimes(2);
  const renewed = (await s.journal.list(s.wallet.address))[0];
  expect(renewed.operationId).not.toBe(saved.operationId);
  expect(renewed.operation?.authorization).toMatchObject({
    initialOwner: s.wallet.address,
  });
  const other = await setup(),
    transfer = { image: other.image, envelope: other.fixture };
  const claim = await prepareWalletClaim(
    other.journal,
    d,
    other.session,
    transfer,
  );
  await expect(
    submitWallet(other.journal, d, other.session, claim),
  ).rejects.toThrow("original transfer file");
});
it("rejects competing journal edits during the wallet prompt and isolates accounts", async () => {
  const s = await setup(),
    record = await s.prepare();
  const b = await WalletJournal.open(d, s.name);
  journals.push(b);
  s.typed.mockImplementation(async (data) => {
    await b.save(
      { ...record, metadata: { ...record.metadata, name: "Concurrent edit" } },
      record,
    );
    return s.wallet.signTypedData({
      domain: domain(contract),
      types: mintTypes,
      primaryType: "Mint",
      message: mintMessage(JSON.parse(data).message),
    });
  });
  await expect(submitWallet(s.journal, d, s.session, record)).rejects.toThrow(
    "changed",
  );
  expect(mocks.post).not.toHaveBeenCalled();
  expect(await s.journal.list(contract)).toEqual([]);
  await expect(
    s.journal.save({ ...record, privateKey: key } as WalletDraft, null),
  ).rejects.toThrow();
});
it("renews an absent mint when another mint consumed its nonce, but preserves a pending job", async () => {
  const s = await setup(),
    record = await s.prepare();
  mocks.post.mockRejectedValueOnce(new Error("Upload unavailable"));
  await expect(submitWallet(s.journal, d, s.session, record)).rejects.toThrow(
    "Upload unavailable",
  );
  const before = (await s.journal.list(s.wallet.address))[0];
  mocks.read.mockResolvedValue(1n);
  await submitWallet(s.journal, d, s.session, before);
  const after = (await s.journal.list(s.wallet.address))[0];
  expect(after.operationId).not.toBe(before.operationId);
  expect(after.operation?.authorization).toMatchObject({
    creatorNonce: "1",
    initialOwner: s.wallet.address,
  });
  expect(s.typed).toHaveBeenCalledTimes(2);
  mocks.read.mockResolvedValue(2n);
  mocks.get.mockResolvedValue(after.job);
  await submitWallet(s.journal, d, s.session, after);
  expect(s.typed).toHaveBeenCalledTimes(2);
  expect((await s.journal.list(s.wallet.address))[0].operation).toEqual(
    after.operation,
  );
});
it("authenticates a wallet profile with scoped personal_sign and rejects a changed account or signature", async () => {
  const s = await setup(),
    identity = walletIdentity(s.session);
  expect(await identity.signMessage({ message: "ZFT scoped request" })).toMatch(
    /^0x/,
  );
  s.personal.mockImplementationOnce(async () => {
    s.active.account = contract;
    return s.wallet.signMessage({ message: "ZFT scoped request" });
  });
  await expect(
    identity.signMessage({ message: "ZFT scoped request" }),
  ).rejects.toThrow("account changed");
  s.active.account = s.wallet.address;
  s.personal.mockImplementationOnce(() =>
    s.wallet.signMessage({ message: "Other request" }),
  );
  await expect(
    identity.signMessage({ message: "ZFT scoped request" }),
  ).rejects.toThrow("different request");
});
