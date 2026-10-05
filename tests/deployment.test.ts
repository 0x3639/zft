import { it, expect } from "vitest";
import { keccak256 } from "viem";
import { checkDeployment, publicClient } from "../packages/protocol/client";
import { GENESIS_HASH, CHAIN_ID, type Deployment } from "../packages/protocol";
import { contract } from "./fixtures";
it("stops when the chain, deployment block, or runtime bytecode changes", async () => {
  const d: Deployment = {
    chainId: CHAIN_ID,
    contract,
    genesisHash: GENESIS_HASH,
    codeHash: keccak256("0x6000"),
    deploymentBlock: "10",
    deploymentBlockHash: keccak256("0x10"),
    metadataOrigin: "https://zft.foo",
  };
  let id = CHAIN_ID,
    genesis = GENESIS_HASH,
    blockHash = d.deploymentBlockHash,
    code = "0x6000";
  const client = {
    getChainId: async () => id,
    getCode: async () => code,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      hash: blockNumber === 0n ? genesis : blockHash,
    }),
  } as unknown as typeof publicClient;
  await checkDeployment(d, client);
  id = 1;
  await expect(checkDeployment(d, client)).rejects.toThrow(
    "deployment changed",
  );
  id = CHAIN_ID;
  code = "0x6001";
  await expect(checkDeployment(d, client)).rejects.toThrow(
    "deployment changed",
  );
  code = "0x6000";
  blockHash = keccak256("0x11");
  await expect(checkDeployment(d, client)).rejects.toThrow(
    "deployment changed",
  );
});
