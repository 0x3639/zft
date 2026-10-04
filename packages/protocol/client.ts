import { createPublicClient, http, keccak256, type Address } from "viem";
import { abi, chain, GENESIS_HASH, type Deployment } from "./index";

export const publicClient = createPublicClient({
  chain,
  transport: http(chain.rpcUrls.default.http[0], {
    timeout: 15_000,
    retryCount: 1,
  }),
});
export async function checkDeployment(d: Deployment, client = publicClient) {
  const [id, genesis, code, deploymentBlock] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockNumber: 0n }),
    client.getCode({ address: d.contract }),
    client.getBlock({ blockNumber: BigInt(d.deploymentBlock) }),
  ]);
  if (
    id !== d.chainId ||
    genesis.hash !== d.genesisHash ||
    d.genesisHash !== GENESIS_HASH ||
    !code ||
    keccak256(code) !== d.codeHash ||
    deploymentBlock.hash !== d.deploymentBlockHash
  ) {
    throw new Error(
      "Devnet deployment changed. Signing is disabled; keep your recovery file.",
    );
  }
}
export async function ownership(
  contract: Address,
  tokenId: string,
  client = publicClient,
) {
  // All reads share a block so ownership and its epoch cannot straddle a transfer.
  const block = await client.getBlock();
  const read = {
    address: contract,
    abi,
    args: [BigInt(tokenId)],
    blockNumber: block.number,
  } as const;
  const [owner, nonce, metadataHash, approved] = await Promise.all([
    client.readContract({ ...read, functionName: "ownerOf" }),
    client.readContract({ ...read, functionName: "ownershipNonce" }),
    client.readContract({ ...read, functionName: "metadataHashOf" }),
    client.readContract({ ...read, functionName: "getApproved" }),
  ]);
  return {
    owner,
    nonce: nonce.toString(),
    metadataHash,
    approved,
    blockNumber: block.number.toString(),
    blockHash: block.hash,
  };
}
