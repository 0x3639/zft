// Read-only staging preparation. No faucet, signing, transaction or deployment RPC.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  encodeDeployData,
  getContractAddress,
  keccak256,
  encodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  stringToHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { poseidonContract } from "../shielded-lab/node_modules/circomlibjs/main.js";

export const RPC = "https://devnet.zenon.foo/zvm/rpc";
export const CHAIN_ID = "0x7001b5";
export const GENESIS =
  "0x2a55e0b69e552a105d559e99b12e0cae28d6e07a3c7a9f264a1543a040ef8ea4";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  build = resolve(root, "research/shielded-lab/build"),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  hex = (n) => "0x" + BigInt(n).toString(16);
const METHODS = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_getBalance",
  "eth_blockNumber",
  "eth_getLogs",
  "eth_gasPrice",
  "eth_estimateGas",
  "eth_call",
]);
function check(ok, message) {
  if (!ok) throw Error(message);
}
export function readonlyRpc(fetcher = fetch) {
  let next = 0;
  return async (method, params = []) => {
    check(METHODS.has(method), "Read-only method required");
    const id = ++next;
    const response = await fetcher(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    check(response.ok, "Devnet RPC unavailable");
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        check(size <= 2 * 1024 * 1024, "RPC response bound exceeded");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    check(
      result.jsonrpc === "2.0" &&
        result.id === id &&
        !result.error &&
        Object.hasOwn(result, "result"),
      "Devnet RPC rejected read",
    );
    return result.result;
  };
}
export function feePolicy(estimate, advertisedPrice) {
  check(
    BigInt(estimate) > 0n && BigInt(advertisedPrice) >= 0n,
    "Invalid gas or fee cap input",
  );
  const gas = (BigInt(estimate) * 12n + 9n) / 10n,
    // Historical devnet relay floor; revalidate before any future broadcast.
    gasPrice = (BigInt(advertisedPrice) * 12n + 9n) / 10n + 50_000_000_000n;
  check(gas > 0n && gas <= 5_000_000n, "Deployment exceeds gas cap");
  check(
    gasPrice > 0n && gasPrice <= 100_000_000_000n,
    "Deployment exceeds fee cap",
  );
  return {
    gas: gas.toString(),
    gasPrice: gasPrice.toString(),
    maxFeeWei: (gas * gasPrice).toString(),
  };
}
export async function identity(rpc) {
  const chain = await rpc("eth_chainId"),
    genesis = await rpc("eth_getBlockByNumber", ["0x0", false]);
  check(
    chain === CHAIN_ID && genesis?.hash === GENESIS,
    "Selected devnet identity mismatch",
  );
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  check(
    /^0x[0-9a-f]+$/.test(block?.number) && /^0x[0-9a-f]{64}$/.test(block?.hash),
    "Devnet block unavailable",
  );
  return block;
}
export async function prepare(address, rpc = readonlyRpc()) {
  const block = await identity(rpc),
    number = block.number;
  check(
    (await rpc("eth_getTransactionCount", [address, "pending"])) === "0x0",
    "Fresh fee account required",
  );
  check(
    (await rpc("eth_getCode", [address, number])) === "0x",
    "Fee account contains code",
  );
  const advertisedPrice = await rpc("eth_gasPrice"),
    compiledBytes = readFileSync(resolve(build, "contracts.json")),
    compiled = JSON.parse(compiledBytes),
    c = compiled.contracts;
  check(
    compiled.compiler.startsWith("0.8.30+commit.73712a01") &&
      compiled.settings.evmVersion === "cancun",
    "Unexpected compiler profile",
  );
  for (const [source, hash] of Object.entries(compiled.sources)) {
    const generated =
      /^generated\/(Create|Spend)(Groth16|Plonk)Verifier.sol$/.exec(source);
    let content;
    if (generated) {
      const system = generated[2].toLowerCase(),
        name = generated[1].toLowerCase();
      content = readFileSync(
        resolve(build, `${name}-${system}.sol`),
        "utf8",
      ).replace(
        `contract ${generated[2] === "Groth16" ? "Groth16" : "Plonk"}Verifier`,
        `contract ${generated[1]}${generated[2]}Verifier`,
      );
    } else {
      check(
        [
          "contracts/shielded/ShieldedRegistry.sol",
          "contracts/shielded/VerifierAdapter.sol",
        ].includes(source),
        "Unexpected compilation source",
      );
      content = readFileSync(resolve(root, source));
    }
    check(sha(content) === hash, "Compiled source changed");
  }
  const names = [
      "hasher",
      "creationVerifier",
      "creationAdapter",
      "spendVerifier",
      "spendAdapter",
      "registry",
    ],
    addresses = {};
  names.forEach(
    (name, i) =>
      (addresses[name] = getContractAddress({
        from: address,
        nonce: BigInt(i),
      }).toLowerCase()),
  );
  const artifacts = [
    [
      {
        abi: poseidonContract.generateABI(2),
        bytecode: poseidonContract.createCode(2),
      },
      [],
    ],
    [c.CreateGroth16Verifier, []],
    [c.VerifierAdapter, [addresses.creationVerifier, false]],
    [c.SpendGroth16Verifier, []],
    [c.VerifierAdapter, [addresses.spendVerifier, false]],
    [
      c.ShieldedRegistry,
      [addresses.hasher, addresses.creationAdapter, addresses.spendAdapter],
    ],
  ];
  const overrides = { [address]: { balance: hex(10n ** 20n), nonce: "0x0" } },
    contracts = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i],
      target = addresses[name];
    check(
      (await rpc("eth_getCode", [target, number])) === "0x",
      "Predicted address contains code",
    );
    check(
      (await rpc("eth_getTransactionCount", [target, number])) === "0x0",
      "Predicted address has nonce",
    );
    overrides[address].nonce = hex(i);
    const [artifact, args] = artifacts[i],
      data = encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
      }),
      tx = { from: address, data, value: "0x0", gas: "0x4c4b40" },
      runtime = await rpc("eth_call", [tx, number, overrides]),
      estimate = await rpc("eth_estimateGas", [tx, number, overrides]);
    check(/^0x(?:[0-9a-f]{2})+$/.test(runtime), "Constructor returned no code");
    const fees = feePolicy(estimate, advertisedPrice);
    check(BigInt(fees.gas) <= BigInt(block.gasLimit), "Block gas cap exceeded");
    contracts.push({
      name,
      address: target,
      nonce: i,
      constructorArgs: args,
      initCodeSha256: sha(Buffer.from(data.slice(2), "hex")),
      initCodeBytes: (data.length - 2) / 2,
      runtimeKeccak256: keccak256(runtime),
      runtimeBytes: (runtime.length - 2) / 2,
      estimatedGas: BigInt(estimate).toString(),
      ...fees,
    });
    overrides[target] = { code: runtime, nonce: "0x1" };
  }
  const simulatedRelationships = [];
  for (const [name, abi, functionName, expected] of [
    [
      "creationAdapter",
      c.VerifierAdapter.abi,
      "verifier",
      addresses.creationVerifier,
    ],
    [
      "spendAdapter",
      c.VerifierAdapter.abi,
      "verifier",
      addresses.spendVerifier,
    ],
    ["registry", c.ShieldedRegistry.abi, "hasher", addresses.hasher],
    [
      "registry",
      c.ShieldedRegistry.abi,
      "creationVerifier",
      addresses.creationAdapter,
    ],
    [
      "registry",
      c.ShieldedRegistry.abi,
      "spendVerifier",
      addresses.spendAdapter,
    ],
    [
      "registry",
      c.ShieldedRegistry.abi,
      "domain",
      BigInt(
        keccak256(
          encodeAbiParameters(
            [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
            [
              keccak256(stringToHex("ZFT_SHIELDED_LOCAL_V1")),
              BigInt(CHAIN_ID),
              addresses.registry,
            ],
          ),
        ),
      ) %
        21888242871839275222246405745257275088548364400416034343698204186575808495617n,
    ],
  ]) {
    const data = encodeFunctionData({ abi, functionName });
    const result = await rpc("eth_call", [
      { to: addresses[name], data },
      number,
      overrides,
    ]);
    const actual = decodeFunctionResult({ abi, functionName, data: result });
    check(
      String(actual).toLowerCase() === String(expected).toLowerCase(),
      "Simulated constructor relationship mismatch",
    );
    simulatedRelationships.push({ contract: name, functionName, passed: true });
  }
  const after = await rpc("eth_getBlockByNumber", [number, false]);
  check(after?.hash === block.hash, "Observed devnet block changed");
  const sourceSha256 = Object.fromEntries(
    [
      "contracts/shielded/ShieldedRegistry.sol",
      "contracts/shielded/VerifierAdapter.sol",
      "circuits/shielded/create.circom",
      "circuits/shielded/spend.circom",
      "research/shielded-lab/package.json",
      "research/shielded-lab/pnpm-lock.yaml",
    ].map((p) => [p, sha(readFileSync(resolve(root, p)))]),
  );
  const artifactsSha256 = Object.fromEntries(
    [
      "contracts.json",
      "compile.json",
      "create-groth16.setup.json",
      "spend-groth16.setup.json",
      "create-groth16.zkey",
      "spend-groth16.zkey",
      "create_js/create.wasm",
      "spend_js/spend.wasm",
    ].map((p) => [p, sha(readFileSync(resolve(build, p)))]),
  );
  return {
    format: "zft-shielded-devnet-preparation-v1",
    recordedAt: new Date().toISOString(),
    rpc: RPC,
    chainId: "7340469",
    genesisHash: GENESIS,
    block: { number, hash: block.hash },
    feeAccount: address,
    contracts,
    totalMaxDeploymentFeeWei: contracts
      .reduce((s, c) => s + BigInt(c.maxFeeWei), 0n)
      .toString(),
    sourceSha256,
    artifactsSha256,
    compiledBundleSha256: sha(compiledBytes),
    simulatedRelationships,
    transactionsSent: 0,
    scope:
      "Read-only constructor simulations and estimates using temporary state overrides. No faucet, funding, signing, broadcast, deployment, receipt or finality acceptance. Runtime hashes include proposed constructor immutables; storage effects were not persisted.",
    next: "Explicit isolated devnet deployment authorization; recheck identity, nonce, code, artifacts, fees and simulation immediately before sending. Existing v1 and hosted app unchanged.",
    setup:
      "Existing disposable Groth16 keys. Valueless devnet experiments only; not a production ceremony.",
  };
}
async function main() {
  const [directory, output, ...extra] = process.argv.slice(2);
  check(
    directory && output && extra.length === 0,
    "Pass a new private fee-account directory and new report path",
  );
  mkdirSync(directory, { mode: 0o700 });
  const key = generatePrivateKey(),
    account = privateKeyToAccount(key);
  writeFileSync(
    resolve(directory, "fee-key.json"),
    JSON.stringify({
      scope: "Disposable ZVM devnet gas only; no spending secrets",
      address: account.address,
      privateKey: key,
    }),
    { mode: 0o600, flag: "wx" },
  );
  const report = await prepare(account.address);
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      status: "read-only-devnet-preparation-passed",
      contracts: report.contracts.length,
      feeAccount: account.address,
      totalMaxDeploymentFeeWei: report.totalMaxDeploymentFeeWei,
      transactionsSent: 0,
    }),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error("Devnet preparation failed; no transactions sent");
    process.exitCode = 1;
  });
