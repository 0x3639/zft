import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { encodeDeployData, keccak256 } from "viem";
import { poseidonContract } from "../shielded-lab/node_modules/circomlibjs/main.js";
import { validatePins, verifyDeployment } from "../shielded-lab/chain.mjs";
import { digest } from "../shielded-lab/core.mjs";
import { RPC, GENESIS } from "./prepare.mjs";
import { withRunner, check, maybe, saveNew, json } from "./runner.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  build = resolve(root, "research/shielded-lab/build");
const sha = (b) => createHash("sha256").update(b).digest("hex");
export function approvedPlan() {
  const plan = JSON.parse(
    readFileSync(
      resolve(root, "research/shielded-devnet/evidence/preparation.json"),
    ),
  );
  check(
    plan.rpc === RPC &&
      plan.chainId === "7340469" &&
      plan.genesisHash === GENESIS,
    "Wrong approved plan",
  );
  for (const [p, h] of Object.entries(plan.sourceSha256))
    check(
      sha(readFileSync(resolve(root, p))) === h,
      "Source differs from approved plan",
    );
  for (const [p, h] of Object.entries(plan.artifactsSha256))
    check(
      sha(readFileSync(resolve(build, p))) === h,
      "Artifact differs from approved plan",
    );
  const c = JSON.parse(
    readFileSync(resolve(build, "contracts.json")),
  ).contracts;
  const artifacts = [
    {
      abi: poseidonContract.generateABI(2),
      bytecode: poseidonContract.createCode(2),
    },
    c.CreateGroth16Verifier,
    c.VerifierAdapter,
    c.SpendGroth16Verifier,
    c.VerifierAdapter,
    c.ShieldedRegistry,
  ];
  check(plan.contracts.length === 6, "Wrong deployment count");
  for (let i = 0; i < 6; i++) {
    const entry = plan.contracts[i],
      data = encodeDeployData({ ...artifacts[i], args: entry.constructorArgs });
    check(
      sha(Buffer.from(data.slice(2), "hex")) === entry.initCodeSha256,
      "Init code changed",
    );
    entry.data = data;
    entry.initCodeKeccak256 = keccak256(data);
  }
  return plan;
}
async function main() {
  const [directory, output, approval, ...extra] = process.argv.slice(2);
  check(
    directory &&
      output &&
      approval === "--execute-approved-devnet" &&
      !extra.length,
    "Explicit approved-devnet execution required",
  );
  const plan = approvedPlan();
  await withRunner(directory, plan, async (r) => {
    const balance = BigInt(
      await r.rpc("eth_getBalance", [r.account.address, "latest"]),
    );
    if (
      balance < 10n ** 18n &&
      !maybe(directory, "faucet-request.json") &&
      r.entries.length === 0
    ) {
      saveNew(directory, "faucet-request.json", {
        time: new Date().toISOString(),
        address: r.account.address,
        endpoint: "https://devnet.zenon.foo/zvm/api/faucet",
      });
      const response = await fetch("https://devnet.zenon.foo/zvm/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: r.account.address }),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      saveNew(directory, "faucet-response.json", {
        httpStatus: response.status,
        time: new Date().toISOString(),
      });
      check(response.ok, "Faucet request not accepted; recheck public balance");
      console.log(
        JSON.stringify({
          stage: "faucet",
          httpStatus: response.status,
          address: r.account.address,
        }),
      );
    }
    const fundingDeadline = Date.now() + 60000;
    while (
      BigInt(await r.rpc("eth_getBalance", [r.account.address, "latest"])) <
      BigInt(plan.totalMaxDeploymentFeeWei)
    ) {
      check(
        Date.now() < fundingDeadline,
        "Devnet faucet balance still pending",
      );
      await delay(2000);
    }
    const receipts = [];
    for (const entry of plan.contracts) {
      if (
        !r.entries.find((e) => e.label === "deploy-" + entry.name.toLowerCase())
      )
        check(
          (await r.rpc("eth_getCode", [entry.address, "latest"])) === "0x",
          "Unexpected code at planned address",
        );
      const receipt = await r.send(
        "deploy-" + entry.name.toLowerCase(),
        null,
        entry.data,
      );
      check(
        receipt.contractAddress?.toLowerCase() === entry.address,
        "Unexpected deployment address",
      );
      check(
        keccak256(
          await r.rpc("eth_getCode", [entry.address, receipt.blockNumber]),
        ) === entry.runtimeKeccak256,
        "Observed runtime differs from simulation",
      );
      receipts.push(receipt);
    }
    const files = {
      createWasm: "create_js/create.wasm",
      spendWasm: "spend_js/spend.wasm",
      createKey: "create-groth16.zkey",
      spendKey: "spend-groth16.zkey",
      createVerificationKey: "create-groth16.vkey.json",
      spendVerificationKey: "spend-groth16.vkey.json",
    };
    const pins = validatePins({
      format: "zft-shielded-local-deployment-v1",
      chainId: "7340469",
      genesisHash: GENESIS,
      deploymentBlock: BigInt(receipts[5].blockNumber).toString(),
      system: "groth16",
      contracts: Object.fromEntries(
        plan.contracts.map((c) => [
          c.name,
          { address: c.address, codeHash: c.runtimeKeccak256 },
        ]),
      ),
      artifacts: Object.fromEntries(
        Object.entries(files).map(([n, p]) => [
          n,
          digest(readFileSync(resolve(build, p))),
        ]),
      ),
    });
    const head = await verifyDeployment(r.client, pins);
    const retained = maybe(directory, "pins.json");
    if (retained) check(json(retained) === json(pins), "Retained pins differ");
    else saveNew(directory, "pins.json", pins);
    const report = {
      format: "zft-shielded-devnet-deployment-v1",
      recordedAt: new Date().toISOString(),
      rpc: RPC,
      pins,
      feeAccount: r.account.address,
      transactions: receipts,
      observedHead: { number: head.number.toString(), hash: head.hash },
      maxReservedFeeWei: r.entries
        .reduce((s, e) => s + BigInt(e.gas) * BigInt(e.gasPrice), 0n)
        .toString(),
      observedFeeWei: receipts
        .reduce(
          (s, e) => s + BigInt(e.gasUsed) * BigInt(e.effectiveGasPrice),
          0n,
        )
        .toString(),
      scope:
        "Six new isolated devnet contracts with disposable setup; RPC-observed successful receipts and two descendant blocks per transaction, not independently verified finality. No v1 or hosted application changes.",
    };
    writeFileSync(output, json(report), { flag: "wx", mode: 0o600 });
    console.log(
      JSON.stringify({
        stage: "deployment-complete",
        registry: pins.contracts.registry.address,
        observedFeeWei: report.observedFeeWei,
      }),
    );
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(
      JSON.stringify({
        error:
          e.message?.startsWith("Devnet") ||
          e.message?.startsWith("Transaction") ||
          e.message?.startsWith("Broadcast")
            ? e.message
            : "Devnet deployment stopped; inspect retained journal",
        rpcCode: e.rpcCode ?? null,
      }),
    );
    process.exitCode = 1;
  });
