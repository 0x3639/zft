import { readFile, writeFile } from "node:fs/promises";
import { encodeAbiParameters } from "viem";
import manifest from "../packages/protocol/deployment.json";
const input = JSON.parse(
  await readFile("contracts/out/standard-input.json", "utf8"),
);
const response = await fetch("https://devnet.zenon.foo/zvm/api/verify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    address: manifest.contract,
    compiler: "0.8.30+commit.73712a01",
    contract: "contracts/src/ZFT.sol:ZFT",
    input,
    constructorArgs: encodeAbiParameters(
      [{ type: "string" }],
      [manifest.metadataOrigin],
    ),
  }),
});
if (!response.ok)
  throw new Error(
    `Source verification request failed: ${response.status} ${await response.text()}`,
  );
const job = (await response.json()) as { id: string };
await writeFile(
  "research/contract-verification.json",
  JSON.stringify(job, null, 2) + "\n",
);
console.log(JSON.stringify(job));
