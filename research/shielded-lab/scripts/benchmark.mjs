import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import { startAnvil, artifacts, lab } from "../evm-test.mjs";
const evm = await startAnvil(),
  contracts = artifacts(),
  runs = [];
try {
  for (const name of ["create", "spend"])
    for (const system of ["groth16", "plonk"]) {
      const output = resolve(lab, `build/benchmark-${name}-${system}.json`);
      if (!process.argv.includes("--reuse-proofs"))
        execFileSync(
          process.execPath,
          [resolve(lab, "scripts/benchmark-worker.mjs"), name, system, output],
          { stdio: "inherit", timeout: 300000 },
        );
      const row = JSON.parse(readFileSync(output, "utf8"));
      const c =
          contracts[
            `${name === "create" ? "Create" : "Spend"}${system === "groth16" ? "Groth16" : "Plonk"}Verifier`
          ],
        address = await evm.deploy(c);
      assert.equal(
        await evm.client.readContract({
          address,
          abi: c.abi,
          functionName: "verifyProof",
          args: row.args,
        }),
        true,
        "Real generated verifier accepts",
      );
      const altered = structuredClone(row.args);
      altered.at(-1)[0] = "0x01";
      assert.equal(
        await evm.client.readContract({
          address,
          abi: c.abi,
          functionName: "verifyProof",
          args: altered,
        }),
        false,
        "Generated verifier binds domain",
      );
      const data = encodeFunctionData({
        abi: c.abi,
        functionName: "verifyProof",
        args: row.args,
      });
      // estimateGas can find an early false-return path after a precompile runs out of gas.
      // Measure a transaction with ample gas, after an eth_call with the same budget proves acceptance.
      assert.equal(
        await evm.client.readContract({
          address,
          abi: c.abi,
          functionName: "verifyProof",
          args: row.args,
          gas: 2000000n,
        }),
        true,
      );
      const tx = await evm.wallet.sendTransaction({
        to: address,
        data,
        gas: 2000000n,
      });
      const receipt = await evm.client.waitForTransactionReceipt({ hash: tx });
      assert.equal(receipt.status, "success");
      const gas = receipt.gasUsed;
      runs.push({
        ...row,
        args: undefined,
        proof: undefined,
        publicSignals: undefined,
        data: undefined,
        verifierGas: String(gas),
        calldataBytes: (data.length - 2) / 2,
        keyBytes: statSync(resolve(lab, `build/${name}-${system}.zkey`)).size,
        wasmBytes: statSync(resolve(lab, `build/${name}_js/${name}.wasm`)).size,
      });
      console.log(
        JSON.stringify({
          name,
          system,
          verifierGas: String(gas),
          calldataBytes: (data.length - 2) / 2,
        }),
      );
    }
  writeFileSync(
    resolve(lab, "build/benchmark.json"),
    JSON.stringify(
      {
        format: "zft-shielded-local-benchmark-v1",
        scope:
          "Five desktop samples per circuit/system; local Anvil only; not mobile or live ZVM qualification",
        runs,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await evm.stop();
}
