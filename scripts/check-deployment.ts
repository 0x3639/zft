import { readFile, writeFile } from "node:fs/promises";
import { getAddress, keccak256 } from "viem";
import { publicClient, checkDeployment } from "../packages/protocol/client";
import type { Deployment } from "../packages/protocol";
import manifest from "../packages/protocol/deployment.json";
const d = manifest as unknown as Deployment;
await checkDeployment(d);
const artifact = JSON.parse(await readFile("contracts/out/ZFT.json", "utf8"));
const compiled = Buffer.from(artifact.evm.deployedBytecode.object, "hex"),
  actual = Buffer.from(
    (await publicClient.getCode({ address: d.contract }))!.slice(2),
    "hex",
  );
if (compiled.length !== actual.length)
  throw new Error("Runtime lengths differ.");
const mask = new Uint8Array(compiled.length);
for (const ranges of Object.values(
  artifact.evm.deployedBytecode.immutableReferences,
) as { start: number; length: number }[][])
  for (const range of ranges)
    mask.fill(1, range.start, range.start + range.length);
for (let i = 0; i < actual.length; i++)
  if (!mask[i] && actual[i] !== compiled[i])
    throw new Error(
      `Runtime mismatch at byte ${i}, outside constructor immutables.`,
    );
const origin = await publicClient.readContract({
  address: d.contract,
  abi: artifact.abi,
  functionName: "metadataOrigin",
});
if (origin !== d.metadataOrigin) throw new Error("Metadata origin mismatch.");
const evidence = {
  address: getAddress(d.contract),
  checkedAt: new Date().toISOString(),
  codeHash: keccak256(actual),
  runtimeBytes: actual.length,
  exactMatchOutsideConstructorImmutables: true,
  solidityMetadataIncludedInComparison: true,
  metadataOrigin: origin,
  compiler: JSON.parse(artifact.metadata).compiler.version,
  sourceHashes: JSON.parse(artifact.metadata).sources,
};
await writeFile(
  "research/local-bytecode-verification.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  `Verified ${actual.length} runtime bytes, including the Solidity metadata, outside declared constructor immutables.`,
);
