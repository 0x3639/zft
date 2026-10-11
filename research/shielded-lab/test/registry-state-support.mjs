// STATE-MACHINE TEST ONLY: small tree and an intentionally unsafe accepting verifier.
// This artifact is never exported by the production contract build or used as cryptographic evidence.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import solc from "solc";
import { poseidonContract } from "circomlibjs";
import { root } from "../evm-test.mjs";
export function stateArtifacts(mutation) {
  let registry = readFileSync(
    resolve(root, "contracts/shielded/ShieldedRegistry.sol"),
    "utf8",
  );
  if (!registry.includes("DEPTH = 16;")) throw Error("Depth anchor changed");
  registry = registry.replace("DEPTH = 16;", "DEPTH = 3;");
  if (mutation) {
    if (registry.split(mutation[0]).length !== 2)
      throw Error("Mutation anchor not unique");
    registry = registry.replace(mutation[0], mutation[1]);
  }
  const sources = {
    "contracts/shielded/ShieldedRegistry.sol": { content: registry },
    "contracts/shielded/VerifierAdapter.sol": {
      content: readFileSync(
        resolve(root, "contracts/shielded/VerifierAdapter.sol"),
        "utf8",
      ),
    },
    "UnsafeVerifierForStateTests.sol": {
      content:
        "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.30; contract UnsafeVerifierForStateTests { function verify(bytes calldata,uint256[4] calldata) external pure returns(bool){return true;} }",
    },
  };
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "cancun",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
      {
        import: (p) => ({
          contents: readFileSync(resolve(root, "node_modules", p), "utf8"),
        }),
      },
    ),
  );
  if (output.errors?.some((e) => e.severity === "error"))
    throw Error("State test compile failed");
  const pick = (f, n) => {
    const c = output.contracts[f][n];
    return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
  };
  return {
    registry: pick(
      "contracts/shielded/ShieldedRegistry.sol",
      "ShieldedRegistry",
    ),
    unsafe: pick(
      "UnsafeVerifierForStateTests.sol",
      "UnsafeVerifierForStateTests",
    ),
  };
}
// Mutations exist only in this disposable state-test compiler, never in a production artifact.
export const stateMutations = {
  "closed-root": [
    "closedRoots[current] = true;",
    "closedRoots[current] = false;",
  ],
  "spent-nullifier": [
    "nullifiers[nullifier] = true;",
    "nullifiers[nullifier] = false;",
  ],
  "commitment-unique": ["&& !commitments[commitment]", ""],
  "root-required": [
    'require(retainedRoots[anchor] > 0 || closedRoots[anchor], "Unknown root");',
    "",
  ],
  "creator-signature": [
    'require(ECDSA.recover(authorizationDigest(a), signature) == a.creator, "Creator signature");',
    "",
  ],
  "image-unique": [
    'require(imageAssets[a.imageHash] == bytes32(0), "Duplicate image");',
    "",
  ],
  "reveal-delay": [
    "block.number >= committed + 2",
    "block.number >= committed",
  ],
  "commit-expiry": ["block.number <= committed + 256", "true"],
};
export async function deployStateFixture(evm, mutation) {
  const selected = process.env.ZFT_SHIELDED_STATE_MUTATION;
  if (selected && !Object.hasOwn(stateMutations, selected))
    throw Error("Unknown state control");
  const a = stateArtifacts(mutation ?? (selected && stateMutations[selected])),
    hasher = await evm.deploy({
      abi: poseidonContract.generateABI(2),
      bytecode: poseidonContract.createCode(2),
    }),
    verifier = await evm.deploy(a.unsafe),
    address = await evm.deploy(a.registry, [hasher, verifier, verifier]);
  return { address, abi: a.registry.abi };
}
