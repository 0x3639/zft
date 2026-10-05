// Real devnet SDK canary with a generated test wallet. This does not exercise MetaMask UI.
import "fake-indexeddb/auto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { encode } from "fast-png";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256, type Hex } from "viem";
import { Vault, unbase64 } from "../packages/vault";
import {
  CANONICALIZER,
  digest,
  rotationMessage,
  rotationTypes,
  type Deployment,
} from "../packages/protocol";
import { exportFile } from "../packages/file-codec";
import { ownership } from "../packages/protocol/client";
import { api } from "../apps/web/src/api";
import * as flows from "../apps/web/src/flows";
import {
  prepareWalletFile,
  authorizeWalletFile,
  moveFileToWallet,
} from "../apps/web/src/wallet-flows";
import { network, type WalletSession } from "../apps/web/src/wallet";
import manifest from "../packages/protocol/deployment.json";

const d = manifest as Deployment,
  origin = process.env.ZFT_TEST_ORIGIN ?? "https://devnet.zft.foo";
if (!["https://devnet.zft.foo", "http://localhost:5173"].includes(origin))
  throw new Error("Use the isolated local or hosted devnet environment.");
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
const prefix = origin.startsWith("https")
  ? "hosted-wallet-canary"
  : "local-wallet-canary";
let testKey: Hex;
try {
  testKey = JSON.parse(
    await readFile(`.local/${prefix}-keys.json`, "utf8"),
  ).wallet;
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  testKey = generatePrivateKey();
  await writeFile(
    `.local/${prefix}-keys.json`,
    JSON.stringify({ wallet: testKey }),
    { mode: 0o600, flag: "wx" },
  );
}
const wallet = privateKeyToAccount(testKey);
const session: WalletSession = {
  account: wallet.address,
  chainId: network.chainId,
  provider: {
    request: async ({ method, params }) => {
      if (method === "eth_chainId") return network.chainId;
      if (method === "eth_accounts") return [wallet.address];
      if (method !== "eth_signTypedData_v4")
        throw new Error(`Unexpected method ${method}`);
      const typed = JSON.parse(String(params![1]));
      return wallet.signTypedData({
        domain: typed.domain,
        types: rotationTypes,
        primaryType: "RotateOwnership",
        message: rotationMessage(typed.message),
      });
    },
  },
};
const vault = await Vault.open(d, prefix);
async function persist() {
  await writeFile(
    `.local/${prefix}.zft-recovery`,
    (await vault.backup()).text,
    { mode: 0o600 },
  );
}
async function backup() {
  const b = await vault.backup();
  await writeFile(`.local/${prefix}.zft-recovery`, b.text, { mode: 0o600 });
  await vault.acknowledgeBackup(b.revision);
}
try {
  await vault.restore(
    await readFile(`.local/${prefix}.zft-recovery`, "utf8"),
    crypto.randomUUID(),
  );
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  await vault.create(crypto.randomUUID());
  await backup();
}
const save = vault.saveItem.bind(vault);
vault.saveItem = async (record, expected) => {
  await save(record, expected);
  await persist();
};
type Evidence = {
  phase: number;
  contract: string;
  origin: string;
  wallet: string;
  tokenId?: string;
  transactions: { action: string; hash: string; block?: string }[];
  checks: string[];
};
let evidence: Evidence;
try {
  evidence = JSON.parse(
    await readFile(`.local/${prefix}-progress.json`, "utf8"),
  );
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  evidence = {
    phase: 0,
    contract: d.contract,
    origin,
    wallet: wallet.address,
    transactions: [],
    checks: [],
  };
}
if (
  evidence.contract !== d.contract ||
  evidence.origin !== origin ||
  evidence.wallet !== wallet.address
)
  throw new Error("Canary identity mismatch");
async function checkpoint(phase: number) {
  evidence.phase = phase;
  await writeFile(
    `.local/${prefix}-progress.json`,
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
}
const item = async () => (await vault.items())[0];
async function confirmed(action: string, expectedStatus: "owned" | "wallet") {
  for (let n = 0; n < 120; n++) {
    const current = await item();
    const job = await flows.reconcile(vault, d, current);
    if (job?.state === "failed") throw new Error(`${action} reverted`);
    if (job?.state === "confirmed") {
      if ((await item()).status !== expectedStatus)
        throw new Error(`${action}: unexpected owner`);
      evidence.transactions.push({
        action,
        hash: job.txHash,
        block: job.blockNumber,
      });
      console.log(`${action}: confirmed ${job.txHash}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`${action}: timeout; rerun to reconcile the saved journal`);
}
if (evidence.phase === 0) {
  if (!(await item())) {
    const pixels = new Uint8Array(64 * 64 * 4);
    const seed = Number(BigInt(wallet.address) & 255n);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels.set([(i / 4 + seed) % 256, 213, (i / 256 + seed) % 256, 255], i);
    }
    const bytes = encode({
      width: 64,
      height: 64,
      channels: 4,
      depth: 8,
      data: pixels,
    });
    await flows.mint(
      vault,
      d,
      { bytes, width: 64, height: 64, imageHash: sha256(bytes) },
      "Wallet custody canary",
      "Generated devnet acceptance fixture; no monetary value.",
    );
  } else await flows.submit(vault, d, await item());
  await confirmed("mint-file", "owned");
  evidence.tokenId = (await item()).tokenId;
  await checkpoint(1);
}
if (evidence.phase === 1) {
  const current = await item();
  if (current.walletTransfer?.direction !== "to-wallet")
    await moveFileToWallet(vault, d, session, current);
  else await flows.submit(vault, d, current);
  await confirmed("seed-wallet", "wallet");
  await checkpoint(2);
}
if (evidence.phase === 2) {
  let current = await item();
  if (current.walletTransfer?.direction !== "into-file")
    current = await prepareWalletFile(
      vault,
      d,
      session,
      current,
      unbase64(current.image),
    );
  await backup();
  await authorizeWalletFile(vault, d, session, current);
  await confirmed("wallet-to-file", "owned");
  await checkpoint(3);
}
if (evidence.phase === 3) {
  const current = await item();
  if (current.walletTransfer?.direction !== "to-wallet") {
    const state = await ownership(d.contract, current.tokenId);
    const file = await exportFile(unbase64(current.image), {
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
        ownershipNonce: state.nonce,
      },
    });
    await writeFile(`.local/${prefix}.zft.png`, file, { mode: 0o600 });
    await flows.readTransfer(new File([file as BlobPart], "test.zft.png"), d);
    await moveFileToWallet(vault, d, session, current);
  } else await flows.submit(vault, d, current);
  await confirmed("file-to-wallet", "wallet");
  await checkpoint(4);
}
const oldFile = await readFile(`.local/${prefix}.zft.png`);
let stale = false;
try {
  await flows.readTransfer(
    new File([new Uint8Array(oldFile)], "old.zft.png"),
    d,
  );
} catch (e) {
  if (!String(e).includes("stale")) throw e;
  stale = true;
}
if (!stale) throw new Error("Old transfer file is still spendable");
if (JSON.stringify(await vault.items()).includes(testKey))
  throw new Error("Wallet key entered item records");
let indexed = false;
for (let n = 0; n < 30 && !indexed; n++) {
  const inventory = await api<{ items: { tokenId: string }[] }>(
    `/api/wallets/${wallet.address}`,
  );
  indexed = inventory.items.some((i) => i.tokenId === evidence.tokenId);
  if (!indexed) await new Promise((resolve) => setTimeout(resolve, 5000));
}
if (!indexed)
  throw new Error("Wallet inventory has not caught up; rerun after indexing");
evidence.checks = [
  "real pinned-devnet wallet → backed-up file → wallet ownership",
  "old exported file rejected",
  "wallet private key absent from vault items",
  "wallet API inventory contains confirmed token",
  "SDK signer fixture only: actual MetaMask and phone acceptance remains open",
];
await checkpoint(4);
await writeFile(
  `research/${prefix}.json`,
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log("Wallet custody canary passed; public evidence saved.");
vault.close();
