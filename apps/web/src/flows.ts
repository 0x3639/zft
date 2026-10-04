import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { zeroAddress, type Hex } from "viem";
import {
  abi,
  CANONICALIZER,
  digest,
  domain,
  mintMessage,
  mintTypes,
  operationDigest,
  rotationMessage,
  rotationTypes,
  sameAddress,
  type Deployment,
  type Metadata,
  type Operation,
} from "../../../packages/protocol";
import {
  checkDeployment,
  ownership,
  publicClient,
} from "../../../packages/protocol/client";
import {
  exportFile,
  importFile,
  MAX_IMAGE,
} from "../../../packages/file-codec";
import {
  base64,
  unbase64,
  Vault,
  type ItemRecord,
} from "../../../packages/vault";
import { api, ApiError, signedRequest } from "./api";
export type Job = {
  operationId: Hex;
  txHash: Hex;
  state: "submitted" | "included" | "confirmed" | "failed";
  blockNumber?: string;
};
export function download(
  data: Uint8Array | string,
  name: string,
  type: string,
) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function prepared(vault: Vault, d: Deployment) {
  await vault.requireBackup();
  await checkDeployment(d);
  return vault.profile();
}
export async function submit(vault: Vault, d: Deployment, item: ItemRecord) {
  if (!item.operation) throw new Error("No saved operation.");
  const profile = await prepared(vault, d);
  if (
    BigInt(item.operation.authorization.deadline) <=
    BigInt(Math.floor(Date.now() / 1000))
  ) {
    let existing: Job | undefined;
    try {
      existing = await api<Job>(`/api/operations/${item.operationId}`);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
    // Only renew an expired, absent/reverted authorization. Keep the original recipient key.
    if (!existing || existing.state === "failed") {
      const deadline = String(Math.floor(Date.now() / 1000) + 900);
      let operation: Operation;
      if (item.operation.kind === "mint") {
        const creatorNonce = await publicClient.readContract({
          address: d.contract,
          abi,
          functionName: "creatorNonces",
          args: [profile.address],
        });
        const authorization = {
          ...item.operation.authorization,
          deadline,
          creatorNonce: creatorNonce.toString(),
        };
        operation = {
          kind: "mint",
          authorization,
          signature: await profile.signTypedData({
            domain: domain(d.contract),
            types: mintTypes,
            primaryType: "Mint",
            message: mintMessage(authorization),
          }),
        };
      } else {
        const state = await ownership(d.contract, item.tokenId);
        const previous = item.previousKeys.find((k) =>
          sameAddress(privateKeyToAccount(k).address, state.owner),
        );
        if (!previous)
          throw new Error(
            "The prior key no longer owns this item. Refresh ownership before retrying.",
          );
        const authorization = {
          ...item.operation.authorization,
          deadline,
          ownershipNonce: state.nonce,
        };
        operation = {
          kind: "rotate",
          authorization,
          signature: await privateKeyToAccount(previous).signTypedData({
            domain: domain(d.contract),
            types: rotationTypes,
            primaryType: "RotateOwnership",
            message: rotationMessage(authorization),
          }),
        };
      }
      item = {
        ...item,
        operation,
        operationId: operationDigest(d.contract, operation),
      };
      delete item.txHash;
      await vault.saveItem(item);
    }
  }
  const job = await signedRequest<Job>(
    "/api/operations",
    item.operation,
    profile,
  );
  await vault.saveItem({
    ...item,
    status: "pending",
    operationId: job.operationId,
    txHash: job.txHash,
  });
  return job;
}
export async function mint(
  vault: Vault,
  d: Deployment,
  normalized: {
    bytes: Uint8Array;
    width: number;
    height: number;
    imageHash: Hex;
  },
  name: string,
  description: string,
) {
  const profile = await prepared(vault, d),
    key = generatePrivateKey(),
    owner = privateKeyToAccount(key);
  const metadata: Metadata = {
    name: name.trim(),
    description,
    image: `${d.metadataOrigin}/art/${normalized.imageHash.slice(2)}.png`,
    imageHash: normalized.imageHash,
    canonicalizer: CANONICALIZER,
    mediaType: "image/png",
    width: normalized.width,
    height: normalized.height,
    creator: profile.address,
    createdAt: new Date().toISOString(),
  };
  const tokenId = BigInt(normalized.imageHash).toString();
  if (await vault.get(`item:${tokenId}`))
    throw new Error(
      "This image is already in your vault. Resume its existing operation.",
    );
  const creatorNonce = await publicClient.readContract({
    address: d.contract,
    abi,
    functionName: "creatorNonces",
    args: [profile.address],
  });
  const authorization = {
    imageHash: normalized.imageHash,
    metadataHash: digest(metadata),
    initialOwner: owner.address,
    creator: profile.address,
    creatorNonce: creatorNonce.toString(),
    deadline: String(Math.floor(Date.now() / 1000) + 900),
  };
  const signature = await profile.signTypedData({
    domain: domain(d.contract),
    types: mintTypes,
    primaryType: "Mint",
    message: mintMessage(authorization),
  });
  const operation: Operation = { kind: "mint", authorization, signature };
  const record: ItemRecord = {
    kind: "item",
    tokenId,
    privateKey: key,
    previousKeys: [],
    image: base64(normalized.bytes),
    metadata,
    nonce: "0",
    status: "draft",
    operation,
    operationId: operationDigest(d.contract, operation),
  };
  // The independent item key and exact signed request are durable before any network mutation.
  await vault.saveItem(record);
  await signedRequest(
    "/api/uploads",
    { image: record.image, metadata },
    profile,
  );
  return submit(vault, d, record);
}
export async function readTransfer(file: File, d: Deployment) {
  if (file.size > MAX_IMAGE + 17000)
    throw new Error("Transfer file is too large.");
  await checkDeployment(d);
  const imported = await importFile(
      new Uint8Array(await file.arrayBuffer()),
      d.contract,
    ),
    e = imported.envelope;
  const state = await ownership(d.contract, e.tokenId),
    owner = privateKeyToAccount(e.authority.privateKey).address;
  if (
    !sameAddress(owner, state.owner) ||
    state.nonce !== e.authority.ownershipNonce ||
    state.metadataHash !== e.metadataHash
  )
    throw new Error("This copy is stale or has already been claimed.");
  return imported;
}
export async function rotate(vault: Vault, d: Deployment, old: ItemRecord) {
  await prepared(vault, d);
  const state = await ownership(d.contract, old.tokenId);
  const previous = [old.privateKey, ...old.previousKeys].find((k) =>
    sameAddress(privateKeyToAccount(k).address, state.owner),
  );
  if (!previous || state.metadataHash !== digest(old.metadata))
    throw new Error(
      "Someone else now owns this item. This copy cannot transfer it.",
    );
  const key = generatePrivateKey(),
    account = privateKeyToAccount(previous);
  const authorization = {
    tokenId: old.tokenId,
    newOwner: privateKeyToAccount(key).address,
    ownershipNonce: state.nonce,
    deadline: String(Math.floor(Date.now() / 1000) + 900),
  };
  const signature = await account.signTypedData({
    domain: domain(d.contract),
    types: rotationTypes,
    primaryType: "RotateOwnership",
    message: rotationMessage(authorization),
  });
  const operation: Operation = { kind: "rotate", authorization, signature };
  const saved = await vault.get(`item:${old.tokenId}`);
  const previousKeys = [
    ...new Set([
      old.privateKey,
      ...old.previousKeys,
      ...(saved?.kind === "item"
        ? [saved.privateKey, ...saved.previousKeys]
        : []),
    ]),
  ];
  const record: ItemRecord = {
    ...old,
    privateKey: key,
    previousKeys,
    nonce: (BigInt(state.nonce) + 1n).toString(),
    status: "pending",
    operation,
    operationId: operationDigest(d.contract, operation),
  };
  delete record.txHash;
  await vault.saveItem(record);
  return submit(vault, d, record);
}
export async function reconcile(vault: Vault, d: Deployment, item: ItemRecord) {
  await checkDeployment(d);
  let job: Job | undefined;
  if (item.operationId)
    job = await api<Job>(`/api/operations/${item.operationId}`);
  if (job && job.state !== "confirmed" && job.state !== "failed") return job;
  const state = await ownership(d.contract, item.tokenId);
  const owned = sameAddress(
    state.owner,
    privateKeyToAccount(item.privateKey).address,
  );
  if (owned && state.metadataHash !== digest(item.metadata))
    throw new Error("On-chain metadata does not match the saved image.");
  await vault.saveItem({
    ...item,
    nonce: state.nonce,
    status: owned ? "owned" : "stale",
    ...(job ? { txHash: job.txHash } : {}),
  });
  return job;
}
export async function send(vault: Vault, d: Deployment, item: ItemRecord) {
  await checkDeployment(d);
  const state = await ownership(d.contract, item.tokenId),
    address = privateKeyToAccount(item.privateKey).address;
  if (
    !sameAddress(state.owner, address) ||
    state.metadataHash !== digest(item.metadata)
  )
    throw new Error(
      "This vault does not hold the current ownership key. Refresh its status.",
    );
  // An app-created item EOA never sends native transactions. Nonzero nonce means unknown approval history.
  const nativeNonce = await publicClient.getTransactionCount({
    address,
    blockTag: "pending",
  });
  if (state.approved !== zeroAddress || nativeNonce !== 0)
    throw new Error(
      "This key has external transaction or approval history. Rotate to a fresh key before exporting.",
    );
  const result = await exportFile(unbase64(item.image), {
    format: "zft",
    version: 1,
    canonicalizer: CANONICALIZER,
    chainId: "7340469",
    contract: d.contract,
    tokenId: item.tokenId,
    imageHash: item.metadata.imageHash,
    metadataHash: digest(item.metadata),
    metadata: item.metadata,
    authority: {
      scheme: "secp256k1",
      privateKey: item.privateKey,
      ownershipNonce: state.nonce,
    },
  });
  download(
    result,
    `${item.metadata.name.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 60)}.zft.png`,
    "image/png",
  );
  await vault.saveItem({ ...item, status: "exported", nonce: state.nonce });
}
