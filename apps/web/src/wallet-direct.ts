import { privateKeyToAccount } from "viem/accounts";
import { sha256 } from "viem";
import {
  abi,
  CANONICALIZER,
  digest,
  domain,
  operationDigest,
  rotationTypes,
  rotationMessage,
  sameAddress,
  type Deployment,
  type Metadata,
  type Envelope,
  type Operation,
} from "../../../packages/protocol";
import {
  checkDeployment,
  ownership,
  publicClient,
} from "../../../packages/protocol/client";
import { validatePublicImage } from "../../../packages/file-codec";
import { base64 } from "../../../packages/vault";
import { ApiError, api, signedRequest } from "./api";
import { assertWallet, type WalletSession } from "./wallet";
import { walletIdentity, signWalletOperation } from "./identity";
import { WalletJournal, type WalletDraft } from "./wallet-journal";
import type { Job } from "./flows";

type Transfer = { image: Uint8Array; envelope: Envelope };
export async function prepareWalletMint(
  journal: WalletJournal,
  d: Deployment,
  session: WalletSession,
  image: {
    bytes: Uint8Array;
    width: number;
    height: number;
    imageHash: `0x${string}`;
  },
  name: string,
  description: string,
) {
  await assertWallet(session);
  await checkDeployment(d);
  const size = await validatePublicImage(image.bytes);
  if (
    sha256(image.bytes) !== image.imageHash ||
    size.width !== image.width ||
    size.height !== image.height
  )
    throw new Error("The mint image changed. Choose the picture again.");
  const tokenId = BigInt(image.imageHash).toString();
  if (await journal.get(session.account, tokenId))
    throw new Error(
      "A saved wallet operation exists for this image. Resume it from Wallet.",
    );
  const metadata: Metadata = {
    name: name.trim(),
    description,
    image: `${d.metadataOrigin}/art/${image.imageHash.slice(2)}.png`,
    imageHash: image.imageHash,
    canonicalizer: CANONICALIZER,
    mediaType: "image/png",
    width: image.width,
    height: image.height,
    creator: session.account,
    createdAt: new Date().toISOString(),
  };
  await assertWallet(session);
  return journal.save(
    {
      kind: "mint",
      wallet: session.account,
      tokenId,
      metadata,
      image: base64(image.bytes),
      revision: 0,
    },
    null,
  );
}

export async function prepareWalletClaim(
  journal: WalletJournal,
  d: Deployment,
  session: WalletSession,
  transfer: Transfer,
) {
  await assertWallet(session);
  await checkDeployment(d);
  const e = transfer.envelope,
    state = await ownership(d.contract, e.tokenId);
  const owner = privateKeyToAccount(e.authority.privateKey).address;
  if (
    !sameAddress(state.owner, owner) ||
    state.nonce !== e.authority.ownershipNonce ||
    state.metadataHash !== e.metadataHash
  )
    throw new Error("This copy is stale or has already been claimed.");
  if (sameAddress(owner, session.account))
    throw new Error("This wallet already owns the collectible.");
  const existing = await journal.get(session.account, e.tokenId);
  if (
    existing &&
    existing.kind === "claim" &&
    existing.sourceNonce === state.nonce &&
    sameAddress(existing.sourceOwner!, owner)
  )
    return existing;
  if (
    existing &&
    existing.job?.state !== "confirmed" &&
    existing.job?.state !== "failed"
  )
    throw new Error(
      "A saved wallet operation exists. Reconcile it in Wallet before claiming again.",
    );
  await assertWallet(session);
  return journal.save(
    {
      kind: "claim",
      wallet: session.account,
      tokenId: e.tokenId,
      metadata: e.metadata,
      image: base64(transfer.image),
      sourceOwner: owner,
      sourceNonce: state.nonce,
      revision: 0,
    },
    existing ?? null,
  );
}

export async function reconcileWallet(
  journal: WalletJournal,
  record: WalletDraft,
) {
  await journal.assertCurrent(record);
  if (!record.operationId) return record;
  let job: Job;
  try {
    job = await api<Job>(`/api/operations/${record.operationId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return record;
    throw e;
  }
  if (JSON.stringify(job) === JSON.stringify(record.job)) return record;
  return journal.save({ ...record, job }, record);
}

export async function submitWallet(
  journal: WalletJournal,
  d: Deployment,
  session: WalletSession,
  input: WalletDraft,
  transfer?: Transfer,
) {
  if (!sameAddress(input.wallet, session.account))
    throw new Error("Select the wallet that prepared this operation.");
  await assertWallet(session);
  await checkDeployment(d);
  await journal.assertCurrent(input);
  let record = await reconcileWallet(journal, input);
  if (record.job && record.job.state !== "failed") return record.job;
  const now = Math.floor(Date.now() / 1000);
  // Another mint can consume this wallet's nonce while this draft is awaiting upload.
  // Reconcile first: a pending sponsor job must never be replaced with new consent.
  const creatorNonce =
    record.kind === "mint"
      ? await publicClient.readContract({
          address: d.contract,
          abi,
          functionName: "creatorNonces",
          args: [session.account],
        })
      : undefined;
  if (
    !record.operation ||
    BigInt(record.operation.authorization.deadline) <= BigInt(now) ||
    record.job?.state === "failed" ||
    (record.operation.kind === "mint" &&
      record.operation.authorization.creatorNonce !== creatorNonce!.toString())
  ) {
    const limit = now + 900;
    const deadline = String(
      limit -
        (record.operation?.authorization.deadline === String(limit) ? 1 : 0),
    );
    let operation: Operation;
    if (record.kind === "mint") {
      const authorization = {
        imageHash: record.metadata.imageHash,
        metadataHash: digest(record.metadata),
        initialOwner: session.account,
        creator: session.account,
        creatorNonce: creatorNonce!.toString(),
        deadline,
      };
      operation = {
        kind: "mint",
        authorization,
        signature: await signWalletOperation(session, d, "mint", authorization),
      };
    } else {
      if (!transfer)
        throw new Error(
          "Open the original transfer file again to renew this claim. The destination stays your wallet.",
        );
      const e = transfer.envelope,
        state = await ownership(d.contract, record.tokenId);
      const owner = privateKeyToAccount(e.authority.privateKey);
      if (
        e.tokenId !== record.tokenId ||
        digest(e.metadata) !== digest(record.metadata) ||
        !sameAddress(owner.address, state.owner) ||
        !sameAddress(state.owner, record.sourceOwner!) ||
        state.nonce !== record.sourceNonce ||
        state.nonce !== e.authority.ownershipNonce ||
        state.metadataHash !== digest(record.metadata)
      )
        throw new Error("This file no longer authorizes the saved claim.");
      const authorization = {
        tokenId: record.tokenId,
        newOwner: session.account,
        ownershipNonce: state.nonce,
        deadline,
      };
      operation = {
        kind: "rotate",
        authorization,
        signature: await owner.signTypedData({
          domain: domain(d.contract),
          types: rotationTypes,
          primaryType: "RotateOwnership",
          message: rotationMessage(authorization),
        }),
      };
    }
    await assertWallet(session);
    const next = {
      ...record,
      operation,
      operationId: operationDigest(d.contract, operation),
    };
    delete next.job;
    record = await journal.save(next, record);
  }
  const identity = walletIdentity(session);
  if (record.kind === "mint")
    await signedRequest(
      "/api/uploads",
      { image: record.image, metadata: record.metadata },
      identity,
    );
  await assertWallet(session);
  await journal.assertCurrent(record);
  const job = await signedRequest<Job>(
    "/api/operations",
    record.operation,
    identity,
  );
  await journal.save({ ...record, job }, record);
  return job;
}
