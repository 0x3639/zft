import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256, verifyTypedData, type Hex } from "viem";
import {
  digest,
  canonical,
  domain,
  rotationTypes,
  rotationMessage,
  operationDigest,
  sameAddress,
  type Deployment,
  type Metadata,
  type Operation,
} from "../../../packages/protocol";
import { checkDeployment, ownership } from "../../../packages/protocol/client";
import { validatePublicImage, MAX_IMAGE } from "../../../packages/file-codec";
import { Vault, base64, type ItemRecord } from "../../../packages/vault";
import { assertWallet, type WalletSession } from "./wallet";
import { api, ApiError } from "./api";
import { reconcile, submit, type Job } from "./flows";

async function currentRecord(vault: Vault, item: ItemRecord) {
  const saved = await vault.get(`item:${item.tokenId}`);
  if (!saved || saved.kind !== "item" || canonical(saved) !== canonical(item))
    throw new Error("This item changed. Refresh before continuing.");
  return saved;
}
export async function publicPixels(metadata: Metadata) {
  const response = await fetch(`/art/${metadata.imageHash.slice(2)}.png`);
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > MAX_IMAGE
  )
    throw new Error("Public image unavailable or too large.");
  const reader = response.body!.getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > MAX_IMAGE) throw new Error("Image exceeds the file limit.");
      parts.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
export async function prepareWalletFile(
  vault: Vault,
  d: Deployment,
  session: WalletSession,
  item: { tokenId: string; metadata: Metadata },
  image: Uint8Array,
) {
  await vault.requireBackup();
  await assertWallet(session);
  await checkDeployment(d);
  const state = await ownership(d.contract, item.tokenId);
  if (
    !sameAddress(state.owner, session.account) ||
    state.metadataHash !== digest(item.metadata) ||
    BigInt(item.metadata.imageHash).toString() !== item.tokenId ||
    sha256(image) !== item.metadata.imageHash
  )
    throw new Error(
      "The selected wallet no longer owns this verified artwork.",
    );
  await validatePublicImage(image);
  const old = await vault.get(`item:${item.tokenId}`);
  if (old?.kind === "item" && ["draft", "pending"].includes(old.status))
    throw new Error(
      "A saved operation already exists. Resume or reconcile it before preparing another key.",
    );
  const key = generatePrivateKey();
  const record: ItemRecord = {
    kind: "item",
    tokenId: item.tokenId,
    metadata: item.metadata,
    image: base64(image),
    privateKey: key,
    previousKeys:
      old?.kind === "item"
        ? [...new Set([old.privateKey, ...old.previousKeys])]
        : [],
    nonce: (BigInt(state.nonce) + 1n).toString(),
    status: "draft",
    walletTransfer: {
      direction: "into-file",
      wallet: session.account,
      sourceNonce: state.nonce,
    },
  };
  await assertWallet(session);
  await vault.saveItem(record, old?.kind === "item" ? old : null);
  return record;
}
// A prepared destination survives rejection, expiry, reload and recovery. No wallet key enters the vault.
export async function authorizeWalletFile(
  vault: Vault,
  d: Deployment,
  session: WalletSession,
  input: ItemRecord,
) {
  let record = await currentRecord(vault, input);
  const transfer = record.walletTransfer;
  if (
    transfer?.direction !== "into-file" ||
    !sameAddress(transfer.wallet, session.account)
  )
    throw new Error("Select the wallet that prepared this transfer.");
  await assertWallet(session);
  await checkDeployment(d);
  if (record.operationId) {
    let job: Job | undefined;
    try {
      job = await api<Job>(`/api/operations/${record.operationId}`);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
    if (job && job.state !== "failed") {
      await reconcile(vault, d, record);
      return job;
    }
    if (
      !job &&
      record.operation &&
      BigInt(record.operation.authorization.deadline) >
        BigInt(Math.floor(Date.now() / 1000))
    )
      return submit(vault, d, record);
  }
  if (!record.operation) {
    const revisions = await vault.revisions();
    if (revisions.backedUp !== revisions.current)
      throw new Error(
        "Save and confirm a recovery file containing this new file key before authorizing the transfer.",
      );
  }
  const state = await ownership(d.contract, record.tokenId);
  if (
    !sameAddress(state.owner, session.account) ||
    state.nonce !== transfer.sourceNonce ||
    state.metadataHash !== digest(record.metadata)
  )
    throw new Error(
      "Ownership changed. Reconcile this saved key before continuing.",
    );
  const authorization = {
    tokenId: record.tokenId,
    newOwner: privateKeyToAccount(record.privateKey).address,
    ownershipNonce: state.nonce,
    deadline: String(Math.floor(Date.now() / 1000) + 900),
  };
  await assertWallet(session);
  const signature = await session.provider.request({
    method: "eth_signTypedData_v4",
    params: [
      session.account,
      JSON.stringify({
        domain: domain(d.contract),
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...rotationTypes,
        },
        primaryType: "RotateOwnership",
        message: authorization,
      }),
    ],
  });
  await assertWallet(session);
  if (
    typeof signature !== "string" ||
    !/^0x[\da-fA-F]{130}$/.test(signature) ||
    !(await verifyTypedData({
      address: session.account,
      domain: domain(d.contract),
      types: rotationTypes,
      primaryType: "RotateOwnership",
      message: rotationMessage(authorization),
      signature: signature as Hex,
    }))
  )
    throw new Error(
      "The wallet returned a signature for a different authorization.",
    );
  await currentRecord(vault, record);
  const operation: Operation = {
    kind: "rotate",
    authorization,
    signature: signature as Hex,
  };
  const next: ItemRecord = {
    ...record,
    operation,
    operationId: operationDigest(d.contract, operation),
    status: "pending",
  };
  delete next.txHash;
  await vault.saveItem(next, record);
  return submit(vault, d, next);
}
export async function moveFileToWallet(
  vault: Vault,
  d: Deployment,
  session: WalletSession,
  input: ItemRecord,
) {
  const record = await currentRecord(vault, input);
  if (!["owned", "exported"].includes(record.status))
    throw new Error("Refresh this item's ownership before moving it.");
  await vault.requireBackup();
  await assertWallet(session);
  await checkDeployment(d);
  const state = await ownership(d.contract, record.tokenId),
    owner = privateKeyToAccount(record.privateKey);
  if (
    !sameAddress(state.owner, owner.address) ||
    state.metadataHash !== digest(record.metadata)
  )
    throw new Error("This file key no longer owns the selected artwork.");
  if (sameAddress(owner.address, session.account))
    throw new Error("Wallet and file owner must be different addresses.");
  const authorization = {
    tokenId: record.tokenId,
    newOwner: session.account,
    ownershipNonce: state.nonce,
    deadline: String(Math.floor(Date.now() / 1000) + 900),
  };
  const operation: Operation = {
    kind: "rotate",
    authorization,
    signature: await owner.signTypedData({
      domain: domain(d.contract),
      types: rotationTypes,
      primaryType: "RotateOwnership",
      message: rotationMessage(authorization),
    }),
  };
  await assertWallet(session);
  await currentRecord(vault, record);
  const next: ItemRecord = {
    ...record,
    status: "pending",
    operation,
    operationId: operationDigest(d.contract, operation),
    walletTransfer: {
      direction: "to-wallet",
      wallet: session.account,
      sourceNonce: state.nonce,
    },
  };
  delete next.txHash;
  await vault.saveItem(next, record);
  return submit(vault, d, next);
}
