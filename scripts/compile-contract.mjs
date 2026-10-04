import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import solc from "solc";
const input = {
  language: "Solidity",
  sources: {
    "contracts/src/ZFT.sol": {
      content: readFileSync("contracts/src/ZFT.sol", "utf8"),
    },
    "contracts/interfaces/IZFT.sol": {
      content: readFileSync("contracts/interfaces/IZFT.sol", "utf8"),
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.immutableReferences",
          "metadata",
        ],
      },
    },
  },
};
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import: (path) => {
      try {
        const contents = readFileSync(`node_modules/${path}`, "utf8");
        input.sources[path] = { content: contents };
        return { contents };
      } catch {
        return { error: `Import unavailable: ${path}` };
      }
    },
  }),
);
for (const error of output.errors ?? []) console.error(error.formattedMessage);
if (output.errors?.some((e) => e.severity === "error")) process.exit(1);
mkdirSync("contracts/out", { recursive: true });
writeFileSync(
  "contracts/out/ZFT.json",
  JSON.stringify(output.contracts["contracts/src/ZFT.sol"].ZFT, null, 2),
);
writeFileSync(
  "contracts/out/standard-input.json",
  JSON.stringify(input, null, 2),
);
console.log(`ZFT compiled with ${solc.version()}`);
