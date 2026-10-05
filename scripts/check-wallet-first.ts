// SDK/Worker integration with generated devnet wallets; not MetaMask/device acceptance.
import "fake-indexeddb/auto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { encode } from "fast-png";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hexToString, sha256, type Hex } from "viem";
import { Vault, unbase64 } from "../packages/vault";
import {
  CANONICALIZER,
  digest,
  mintMessage,
  mintTypes,
  rotationMessage,
  rotationTypes,
  type Deployment,
} from "../packages/protocol";
import manifest from "../packages/protocol/deployment.json";
import { exportFile } from "../packages/file-codec";
import { ownership } from "../packages/protocol/client";
import { api, ApiError, signedRequest } from "../apps/web/src/api";
import { walletIdentity } from "../apps/web/src/identity";
import {
  WalletJournal,
  type WalletDraft,
} from "../apps/web/src/wallet-journal";
import {
  prepareWalletMint,
  prepareWalletClaim,
  submitWallet,
  reconcileWallet,
} from "../apps/web/src/wallet-direct";
import {
  prepareWalletFile,
  authorizeWalletFile,
} from "../apps/web/src/wallet-flows";
import { readTransfer, reconcile, type Job } from "../apps/web/src/flows";
import { network, type WalletSession } from "../apps/web/src/wallet";

const d = manifest as Deployment;
const origin = process.env.ZFT_TEST_ORIGIN ?? "https://devnet.zft.foo";
if (!["https://devnet.zft.foo", "http://localhost:5173"].includes(origin))
  throw new Error("Use local or hosted devnet only.");
const prefix = `${origin.startsWith("https") ? "hosted" : "local"}-wallet-first`;
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  nativeFetch(
    typeof input === "string" && input.startsWith("/") ? origin + input : input,
    {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        Origin: origin,
      },
    },
  );
Object.defineProperty(globalThis, "location", {
  value: { origin },
  configurable: true,
});
await mkdir(".local", { recursive: true, mode: 0o700 });
async function optional<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
async function privateSave(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}
const keyPath = `.local/${prefix}-keys.json`;
let keys = await optional<{ a: Hex; b: Hex }>(keyPath);
if (!keys) {
  keys = { a: generatePrivateKey(), b: generatePrivateKey() };
  await writeFile(keyPath, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
}
function session(key: Hex): WalletSession {
  const wallet = privateKeyToAccount(key);
  return {
    account: wallet.address,
    chainId: network.chainId,
    provider: {
      request: async ({ method, params }) => {
        if (method === "eth_chainId") return network.chainId;
        if (method === "eth_accounts") return [wallet.address];
        if (method === "personal_sign")
          return wallet.signMessage({
            message: hexToString(params![0] as Hex),
          });
        if (method !== "eth_signTypedData_v4")
          throw new Error("Unexpected provider method");
        const data = JSON.parse(String(params![1]));
        return data.primaryType === "Mint"
          ? wallet.signTypedData({
              domain: data.domain,
              types: mintTypes,
              primaryType: "Mint",
              message: mintMessage(data.message),
            })
          : wallet.signTypedData({
              domain: data.domain,
              types: rotationTypes,
              primaryType: "RotateOwnership",
              message: rotationMessage(data.message),
            });
      },
    },
  };
}
const a = session(keys.a),
  b = session(keys.b);
type Evidence = {
  phase: number;
  origin: string;
  contract: string;
  walletA: string;
  walletB: string;
  tokenId?: string;
  transactions: { action: string; txHash: string; block?: string }[];
  checks: string[];
};
const progressPath = `.local/${prefix}-progress.json`;
const evidence: Evidence = (await optional<Evidence>(progressPath)) ?? {
  phase: 0,
  origin,
  contract: d.contract,
  walletA: a.account,
  walletB: b.account,
  transactions: [],
  checks: [],
};
if (
  evidence.origin !== origin ||
  evidence.contract !== d.contract ||
  evidence.walletA !== a.account ||
  evidence.walletB !== b.account
)
  throw new Error("Canary identity mismatch");
const journal = await WalletJournal.open(d, prefix);
for (const record of (await optional<WalletDraft[]>(
  `.local/${prefix}-journal.json`,
)) ?? [])
  await journal.save(record, null);
const saveJournal = journal.save.bind(journal);
journal.save = async (record, expected) => {
  const next = await saveJournal(record, expected);
  await privateSave(`.local/${prefix}-journal.json`, [
    ...(await journal.list(a.account)),
    ...(await journal.list(b.account)),
  ]);
  return next;
};
const saved = async (s: WalletSession) => (await journal.list(s.account))[0];
async function checkpoint(phase: number) {
  evidence.phase = phase;
  await privateSave(progressPath, evidence);
}
function tx(action: string, job: Job) {
  evidence.transactions.push({
    action,
    txHash: job.txHash,
    block: job.blockNumber,
  });
  console.log(`${action}: confirmed ${job.txHash}`);
}
async function waitWallet(s: WalletSession, action: string) {
  for (let n = 0; n < 120; n++) {
    const record = await reconcileWallet(journal, await saved(s));
    if (record.job?.state === "failed") throw new Error(`${action} reverted`);
    if (record.job?.state === "confirmed") {
      tx(action, record.job);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`${action} timed out; rerun to resume its journal`);
}

if (evidence.phase === 0) {
  // This proves direct wallet minting does not create a file vault.
  let draft = await saved(a);
  if (!draft) {
    const pixels = new Uint8Array(64 * 64 * 4),
      seed = Number(BigInt(a.account) & 0xffffffn);
    for (let i = 0; i < pixels.length; i += 4)
      pixels.set(
        [
          (seed + i / 4) % 256,
          (seed / 256 + i / 128) % 256,
          (seed / 65536 + i / 1024) % 256,
          255,
        ],
        i,
      );
    const bytes = encode({
      width: 64,
      height: 64,
      channels: 4,
      depth: 8,
      data: pixels,
    });
    draft = await prepareWalletMint(
      journal,
      d,
      a,
      { bytes, width: 64, height: 64, imageHash: sha256(bytes) },
      "Wallet-first canary",
      "Generated ZVM devnet fixture; no monetary value.",
    );
  }
  await submitWallet(journal, d, a, draft);
  await waitWallet(a, "mint-direct-to-wallet");
  const minted = await ownership(d.contract, draft.tokenId);
  if (minted.owner.toLowerCase() !== a.account.toLowerCase())
    throw new Error("Mint recipient mismatch");
  evidence.tokenId = draft.tokenId;
  await checkpoint(1);
}
if (evidence.phase === 1) {
  const current = await api<{ profile: { revision: number } }>(
    `/api/profiles/${a.account}`,
  ).catch((e) => {
    if (e instanceof ApiError && e.status === 404)
      return { profile: { revision: 0 } };
    throw e;
  });
  const result = await signedRequest<{
    profile: { address: string; name: string };
  }>(
    "/api/profile",
    {
      name: "Wallet-first canary",
      bio: "Isolated SDK/Worker devnet test identity.",
      featured: null,
      revision: current.profile.revision,
    },
    walletIdentity(a),
  );
  if (result.profile.address.toLowerCase() !== a.account.toLowerCase())
    throw new Error("Wallet profile mismatch");
  await checkpoint(2);
}
let recovery: string | undefined;
try {
  recovery = await readFile(`.local/${prefix}.zft-recovery`, "utf8");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const vault = await Vault.session(d, recovery);
async function backup() {
  const snapshot = await vault.backup();
  await writeFile(`.local/${prefix}.zft-recovery`, snapshot.text, {
    mode: 0o600,
  });
  await vault.acknowledgeBackup(snapshot.revision);
}
const saveItem = vault.saveItem.bind(vault);
vault.saveItem = async (record, expected) => {
  await saveItem(record, expected);
  await backup();
};
const item = async () => (await vault.items())[0];
if (evidence.phase === 2) {
  const draft = await saved(a);
  const record =
    (await item()) ??
    (await prepareWalletFile(vault, d, a, draft, unbase64(draft.image)));
  await backup();
  await authorizeWalletFile(vault, d, a, record);
  let confirmed = false;
  for (let n = 0; n < 120; n++) {
    const job = await reconcile(vault, d, await item());
    if (job?.state === "failed") throw new Error("Wallet-to-file reverted");
    if (job?.state === "confirmed") {
      if ((await item()).status !== "owned")
        throw new Error("File owner mismatch");
      tx("wallet-to-session-file", job);
      confirmed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!confirmed) throw new Error("Wallet-to-file timeout; rerun to resume");
  const current = await item();
  const bytes = await exportFile(unbase64(current.image), {
    format: "zft",
    version: 1,
    canonicalizer: CANONICALIZER,
    chainId: "7340469",
    contract: d.contract,
    tokenId: current.tokenId,
    imageHash: current.metadata.imageHash,
    metadataHash: digest(current.metadata),
    metadata: current.metadata,
    authority: {
      scheme: "secp256k1",
      privateKey: current.privateKey,
      ownershipNonce: current.nonce,
    },
  });
  await writeFile(`.local/${prefix}.zft.png`, bytes, { mode: 0o600 });
  await checkpoint(3);
}
if (evidence.phase === 3) {
  let draft = await saved(b);
  if (draft?.operationId) await submitWallet(journal, d, b, draft);
  else {
    const bytes = new Uint8Array(await readFile(`.local/${prefix}.zft.png`));
    const transfer = await readTransfer(new File([bytes], "canary.zft.png"), d);
    draft = await prepareWalletClaim(journal, d, b, transfer);
    await submitWallet(journal, d, b, draft, transfer);
  }
  await waitWallet(b, "claim-file-direct-to-other-wallet");
  await checkpoint(4);
}
const state = await ownership(d.contract, evidence.tokenId!);
if (state.owner.toLowerCase() !== b.account.toLowerCase())
  throw new Error("Claim recipient mismatch");
let stale = false;
try {
  await readTransfer(
    new File(
      [new Uint8Array(await readFile(`.local/${prefix}.zft.png`))],
      "old.zft.png",
    ),
    d,
  );
} catch (e) {
  if (!String(e).includes("stale")) throw e;
  stale = true;
}
if (!stale) throw new Error("Old file is still current");
const rawJournal = JSON.stringify([
  ...(await journal.list(a.account)),
  ...(await journal.list(b.account)),
]);
if (
  rawJournal.includes(keys.a) ||
  rawJournal.includes(keys.b) ||
  rawJournal.includes((await item()).privateKey)
)
  throw new Error("A private key entered wallet storage");
if (
  JSON.stringify(await vault.items()).includes(keys.a) ||
  JSON.stringify(await vault.items()).includes(keys.b)
)
  throw new Error("A wallet key entered file storage");
evidence.checks = [
  "direct wallet mint with no file vault",
  "wallet profile authenticated with scoped personal_sign",
  "wallet-to-file with acknowledged session recovery",
  "file claimed directly into a second wallet",
  "old file rejected",
  "wallet journal contains no wallet or imported file keys",
  "generated SDK provider only; MetaMask/device acceptance remains open",
];
await checkpoint(4);
await writeFile(
  `research/${prefix}.json`,
  JSON.stringify(evidence, null, 2) + "\n",
);
journal.close();
vault.close();
console.log("Wallet-first canary passed; public evidence saved.");
