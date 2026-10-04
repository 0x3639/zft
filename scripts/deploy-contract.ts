import { readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseTransaction,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  chain,
  GENESIS_HASH,
  RELAY_PRIORITY_FLOOR,
} from "../packages/protocol";
const manifest = JSON.parse(
  await readFile("packages/protocol/deployment.json", "utf8"),
);
if (manifest.contract)
  throw new Error(
    "Deployment already pinned. A new deployment requires an explicit manifest migration.",
  );
const client = createPublicClient({ chain, transport: http() }),
  keys = JSON.parse(await readFile(".local/devnet-keys.json", "utf8")) as {
    deployer: Hex;
  };
const account = privateKeyToAccount(keys.deployer),
  wallet = createWalletClient({ account, chain, transport: http() });
if (
  (await client.getChainId()) !== chain.id ||
  (await client.getBlock({ blockNumber: 0n })).hash !== GENESIS_HASH
)
  throw new Error("Unexpected devnet identity.");
const artifact = JSON.parse(await readFile("contracts/out/ZFT.json", "utf8"));
// Journal the raw deployment transaction before broadcast; reruns resume that exact deployment.
let journal: { raw: Hex; hash: Hex };
try {
  journal = JSON.parse(
    await readFile(".local/deployment-transaction.json", "utf8"),
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const { encodeDeployData } = await import("viem");
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    args: [manifest.metadataOrigin],
  });
  const gas = ((await client.estimateGas({ account, data })) * 12n) / 10n,
    gasPrice =
      ((await client.getGasPrice()) * 12n) / 10n + RELAY_PRIORITY_FLOOR;
  if (gas > 5_000_000n || gasPrice > 100_000_000_000n)
    throw new Error("Deployment exceeds the devnet gas cap.");
  const raw = await wallet.signTransaction({
    data,
    value: 0n,
    gas,
    gasPrice,
    nonce: await client.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
    type: "legacy",
  });
  journal = { raw, hash: keccak256(raw) };
  await writeFile(
    ".local/deployment-transaction.json",
    JSON.stringify(journal),
    { flag: "wx", mode: 0o600 },
  );
}
if (process.argv.includes("--replace-relay-fee")) {
  const old = parseTransaction(journal.raw);
  if (old.to || old.chainId !== chain.id || old.type !== "legacy")
    throw new Error("Unexpected journaled deployment.");
  const gasPrice =
    ((await client.getGasPrice()) * 12n) / 10n + RELAY_PRIORITY_FLOOR;
  if (gasPrice > 100_000_000_000n || gasPrice <= old.gasPrice!)
    throw new Error("Replacement fee outside bounds.");
  await writeFile(
    `.local/deployment-previous-${journal.hash}.json`,
    JSON.stringify(journal),
    { flag: "wx", mode: 0o600 },
  );
  const raw = await wallet.signTransaction({
    data: old.data,
    value: old.value ?? 0n,
    gas: old.gas!,
    gasPrice,
    nonce: old.nonce!,
    type: "legacy",
  });
  journal = { raw, hash: keccak256(raw) };
  await writeFile(
    ".local/deployment-transaction.json",
    JSON.stringify(journal),
    { mode: 0o600 },
  );
}
try {
  await client.sendRawTransaction({ serializedTransaction: journal.raw });
} catch (error) {
  const existing = await client
    .getTransaction({ hash: journal.hash })
    .catch(() => null);
  if (!existing)
    throw new Error(
      `Relayer did not acknowledge the deployment: ${(error as { shortMessage?: string }).shortMessage ?? "submission failed"}`,
    );
}
console.log(`Deployment transaction: ${journal.hash}`);
const receipt = await client.waitForTransactionReceipt({
  hash: journal.hash,
  confirmations: 7,
  timeout: 240_000,
  pollingInterval: 5000,
});
if (receipt.status !== "success" || !receipt.contractAddress)
  throw new Error("Deployment did not succeed.");
const code = await client.getCode({ address: receipt.contractAddress });
if (!code) throw new Error("No runtime bytecode.");
const pinned = {
  ...manifest,
  contract: receipt.contractAddress,
  codeHash: keccak256(code),
  deploymentBlock: receipt.blockNumber.toString(),
  deploymentBlockHash: receipt.blockHash,
  deploymentTransaction: journal.hash,
  compiler: "0.8.30",
  evmVersion: "cancun",
};
await writeFile(
  "packages/protocol/deployment.json",
  JSON.stringify(pinned, null, 2) + "\n",
);
console.log(
  `Pinned ZFT devnet deployment ${receipt.contractAddress} at block ${receipt.blockNumber}`,
);
