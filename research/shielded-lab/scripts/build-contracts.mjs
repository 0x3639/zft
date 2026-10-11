import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import solc from "solc";
const lab = fileURLToPath(new URL("../", import.meta.url)),
  root = resolve(lab, "../..");
if (!solc.version().startsWith("0.8.30+commit.73712a01"))
  throw Error("Wrong Solidity compiler");
const sources = {};
for (const n of ["ShieldedRegistry", "VerifierAdapter"])
  sources[`contracts/shielded/${n}.sol`] = {
    content: readFileSync(resolve(root, `contracts/shielded/${n}.sol`), "utf8"),
  };
for (const n of ["create", "spend"])
  for (const p of process.argv.includes("--groth16-only")
    ? ["groth16"]
    : ["groth16", "plonk"]) {
    const name = `${n === "create" ? "Create" : "Spend"}${p === "groth16" ? "Groth16" : "Plonk"}Verifier`;
    sources[`generated/${name}.sol`] = {
      content: readFileSync(
        resolve(lab, `build/${n}-${p}.sol`),
        "utf8",
      ).replace(
        p === "groth16" ? "contract Groth16Verifier" : "contract PlonkVerifier",
        `contract ${name}`,
      ),
    };
  }
const settings = {
  optimizer: { enabled: true, runs: 200 },
  evmVersion: "cancun",
  outputSelection: {
    "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
  },
};
const output = JSON.parse(
  solc.compile(JSON.stringify({ language: "Solidity", sources, settings }), {
    import: (p) => {
      if (!p.startsWith("@openzeppelin/contracts/") || p.includes(".."))
        return { error: "Unexpected import" };
      return {
        contents: readFileSync(resolve(root, "node_modules", p), "utf8"),
      };
    },
  }),
);
for (const error of output.errors ?? []) console.error(error.formattedMessage);
if (output.errors?.some((e) => e.severity === "error"))
  throw Error("Contract compile failed");
const contracts = {};
for (const [source, cs] of Object.entries(output.contracts))
  for (const [name, c] of Object.entries(cs))
    if (c.evm.bytecode.object)
      contracts[name] = {
        source,
        abi: c.abi,
        bytecode: "0x" + c.evm.bytecode.object,
        runtime: "0x" + c.evm.deployedBytecode.object,
      };
writeFileSync(
  resolve(lab, "build/contracts.json"),
  JSON.stringify(
    {
      compiler: solc.version(),
      settings,
      sources: Object.fromEntries(
        Object.entries(sources).map(([n, s]) => [
          n,
          createHash("sha256").update(s.content).digest("hex"),
        ]),
      ),
      contracts,
    },
    null,
    2,
  ) + "\n",
);
console.log("Compiled isolated contracts:", Object.keys(contracts).join(", "));
