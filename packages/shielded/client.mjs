import {
  createPublicClient,
  http,
  encodeAbiParameters,
  recoverTypedDataAddress,
} from "viem";
import {
  createProfile,
  canonical,
  digest,
  check,
} from "../../research/shielded-lab/core.mjs";
import {
  normalizeImage,
  importBearer,
  exportBearer,
} from "../../research/shielded-lab/file-adapter.mjs";
import {
  operation,
  openRecovery,
} from "../../research/shielded-lab/recovery.mjs";
import { openVault } from "../../research/shielded-lab/vault.mjs";
import {
  pinDeployment,
  verifyDeployment,
  verifyAsset,
  rebuildTree,
} from "../../research/shielded-lab/chain.mjs";
import { parseConfiguration, configurationId } from "./config.mjs";
import { authorizationArgs, creationTypes, transactionAbi } from "./wallet.mjs";
export { parseConfiguration, configurationId } from "./config.mjs";
export { connectWallet } from "./wallet.mjs";
export const MESSAGES = Object.freeze({
  unavailable:
    "The action could not complete. Your saved recovery remains available. Check the connection, file, password and selected wallet; observe before retrying a submission.",
  busy: "Finish or cancel the current action first.",
  closed:
    "The shielded session is locked. Reopen the configuration to continue.",
});
const randomHex = () =>
  "0x" +
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
// Transport/prover are trusted injected code. This controller never sends private inputs to RPC or wallet.
export async function createShieldedClient({
  text,
  origin,
  prover,
  indexedDB = globalThis.indexedDB,
}) {
  const config = parseConfiguration(text, origin),
    pins = config.pins,
    deployment = pinDeployment(pins);
  check(prover && typeof prover.prove === "function");
  const client = createPublicClient({
    transport: http(config.rpc, { retryCount: 0, timeout: 15000 }),
    pollingInterval: 1000,
  });
  await verifyDeployment(client, pins);
  const profile = await createProfile(),
    vault = await openVault({
      indexedDB,
      name: "zft-shielded-app-" + configurationId({ pins }).slice(2),
    });
  let record,
    image,
    proof,
    wallet,
    busy = false,
    closed = false,
    needsObservation = false;
  const alive = () => {
    if (closed) throw Error(MESSAGES.closed);
  };
  async function run(action) {
    alive();
    if (busy) throw Error(MESSAGES.busy);
    busy = true;
    try {
      const result = await action();
      alive();
      return result;
    } catch {
      throw Error(closed ? MESSAGES.closed : MESSAGES.unavailable);
    } finally {
      busy = false;
    }
  }
  const selected = () => {
    alive();
    check(record, "Select an operation");
  };
  const read = (functionName, args = []) =>
    client.readContract({
      address: deployment.registry,
      abi: transactionAbi,
      functionName,
      args,
    });
  async function currentRow() {
    selected();
    const row = (await vault.list()).find((r) => r.id === record.id);
    check(row);
    return row;
  }
  async function ready() {
    const row = await currentRow();
    check(
      row.acknowledged &&
        ["prepared", "unobserved"].includes(row.state) &&
        !needsObservation,
      "Save recovery and observe first",
    );
    return row;
  }
  async function requireWallet() {
    alive();
    check(wallet);
    await wallet.assertCurrent();
    alive();
    return wallet;
  }
  function select(opened, mustObserve) {
    alive();
    record = opened.record;
    image = opened.image;
    proof = undefined;
    needsObservation = mustObserve;
  }
  async function save(next, bytes, password) {
    alive();
    await vault.prepare(profile, next, password, deployment);
    alive();
    select({ record: next, image: bytes }, false);
  }
  async function authorize(destination) {
    const w = await requireWallet();
    check(destination.metadata.creator === w.address);
    await verifyDeployment(client, pins);
    alive();
    const a = {
      imageHash: destination.imageHash,
      metadataHash: destination.metadataHash,
      commitment: destination.commitment,
      creator: w.address,
      nonce: String(await read("creatorNonces", [w.address])),
      deadline: String((await client.getBlock()).timestamp + 3600n),
    };
    const signature = await w.signCreation(a);
    alive();
    check(
      (
        await recoverTypedDataAddress({
          domain: {
            name: "ZFT Shielded Registry",
            version: "1",
            chainId: Number(pins.chainId),
            verifyingContract: deployment.registry,
          },
          types: creationTypes,
          primaryType: "Create",
          message: authorizationArgs(a),
          signature,
        })
      ).toLowerCase() === w.address,
      "Wrong creator signature",
    );
    return { authorization: a, signature, salt: randomHex() };
  }
  async function observe(password) {
    selected();
    proof = undefined;
    needsObservation = true;
    const result = await vault.observe(
      record.id,
      password,
      profile,
      client,
      pins,
    );
    alive();
    needsObservation = false;
    return result.state;
  }
  const api = {
    config: structuredClone(config),
    configurationId: configurationId(config),
    async snapshot() {
      alive();
      const operations = await vault.list(),
        row = record && operations.find((r) => r.id === record.id);
      return {
        busy,
        operations,
        selected: record
          ? {
              id: record.id,
              kind: record.kind,
              name: record.destination.metadata.name,
              assetId: record.destination.assetId,
              imageHash: record.destination.imageHash,
              state: row?.state,
              acknowledged: row?.acknowledged === true,
              proofReady: !!proof,
              needsObservation,
              image: new Uint8Array(image),
            }
          : null,
      };
    },
    setWallet(value) {
      alive();
      check(!busy);
      wallet?.close?.();
      wallet = value;
    },
    prepareCreate: (bytes, name, description, password) =>
      run(async () => {
        check(bytes instanceof Uint8Array && bytes.length <= 10 * 1024 * 1024);
        const normalized = await normalizeImage(bytes),
          w = await requireWallet();
        const metadata = {
          format: "zft-shielded-metadata-v1",
          name,
          description,
          imageHash: digest(normalized.bytes),
          canonicalizer: "zft-png/1",
          mediaType: "image/png",
          width: normalized.width,
          height: normalized.height,
          creator: w.address,
          createdAt: new Date().toISOString(),
        };
        const destination = profile.note(deployment, metadata),
          creation = await authorize(destination);
        await save(
          operation(profile, {
            image: normalized.bytes,
            destination,
            pins,
            creation,
          }),
          normalized.bytes,
          password,
        );
      }),
    prepareClaim: (bytes, password) =>
      run(async () => {
        check(bytes instanceof Uint8Array && bytes.length <= 11 * 1024 * 1024);
        const imported = await importBearer(profile, bytes, deployment);
        await verifyAsset(client, pins, profile, imported.note);
        const { tree } = await rebuildTree(client, pins, profile);
        check(
          tree.leaves.includes(BigInt(imported.note.commitment)) &&
            !(await read("nullifiers", [profile.nullifier(imported.note)])),
        );
        const destination = profile.note(deployment, imported.note.metadata);
        await save(
          operation(profile, {
            image: imported.image,
            source: imported.note,
            destination,
            pins,
          }),
          imported.image,
          password,
        );
      }),
    exportRecovery: () =>
      run(async () => {
        selected();
        return vault.export(record.id);
      }),
    acknowledge: (text, password) =>
      run(async () => {
        selected();
        await vault.acknowledge(record.id, text, password, profile, deployment);
      }),
    restore: (text, password) =>
      run(async () => {
        const opened = await openRecovery(text, password, profile, deployment);
        check(canonical(opened.record.pins) === canonical(pins));
        const exists = (await vault.list()).some(
          (r) => r.id === opened.record.id,
        );
        if (!exists) {
          alive();
          await vault.prepare(profile, opened.record, password, deployment);
        }
        select(opened, true);
        return exists;
      }),
    unlock: (id, password) =>
      run(async () => {
        select(await vault.unlock(id, password, profile, deployment), true);
      }),
    observe: (password) => run(() => observe(password)),
    renewCreation: (password) =>
      run(async () => {
        selected();
        check(record.kind === "create");
        check((await observe(password)) === "unobserved");
        const destination = record.destination,
          bytes = image,
          creation = await authorize(destination);
        await save(
          operation(profile, { image: bytes, destination, pins, creation }),
          bytes,
          password,
        );
      }),
    prove: () =>
      run(async () => {
        await ready();
        proof = undefined;
        await verifyDeployment(client, pins);
        let input, name;
        if (record.kind === "create") {
          name = "create";
          input = profile.creationInput(record.destination);
        } else {
          name = "spend";
          await verifyAsset(client, pins, profile, record.source);
          check(
            !(await read("nullifiers", [profile.nullifier(record.source)])),
          );
          const { tree } = await rebuildTree(client, pins, profile),
            index = tree.leaves.indexOf(BigInt(record.source.commitment));
          check(index >= 0);
          input = profile.spendInput(
            record.source,
            record.destination,
            tree.path(index),
          );
        }
        alive();
        const result = await prover.prove(name, input, config);
        alive();
        const signals = result.publicSignals.map(BigInt),
          expected =
            name === "create"
              ? [input.domain, input.assetHi, input.assetLo, input.commitment]
              : [
                  input.domain,
                  input.root,
                  input.nullifier,
                  input.outputCommitment,
                ];
        check(
          canonical(signals.map(String)) === canonical(expected.map(String)),
          "Proof statement mismatch",
        );
        const q = result.proof;
        proof = {
          signals,
          data: encodeAbiParameters(
            [
              { type: "uint256[2]" },
              { type: "uint256[2][2]" },
              { type: "uint256[2]" },
            ],
            [
              q.pi_a.slice(0, 2),
              q.pi_b.slice(0, 2).map((x) => [x[1], x[0]]),
              q.pi_c.slice(0, 2),
            ],
          ),
        };
      }),
    submit: (password) =>
      run(async () => {
        await ready();
        check(proof);
        await verifyDeployment(client, pins);
        const w = await requireWallet();
        let functionName, args;
        if (record.kind === "create") {
          const c = record.creation,
            a = authorizationArgs(c.authorization),
            head = await client.getBlock();
          check(
            head.timestamp <= a.deadline &&
              (await read("creatorNonces", [a.creator])) === a.nonce,
            "Authorization expired",
          );
          const commitment = await read("commitmentDigest", [a, c.salt]),
            committed = await read("creationCommits", [commitment]);
          if (committed === 0n) {
            functionName = "commitCreate";
            args = [commitment];
          } else {
            check(
              head.number >= committed + 2n && head.number <= committed + 256n,
              "Commit window",
            );
            functionName = "create";
            args = [a, c.salt, c.signature, proof.data];
          }
        } else {
          functionName = "spend";
          args = [
            proof.signals[1],
            proof.signals[2],
            proof.signals[3],
            proof.data,
          ];
        }
        await w.assertCurrent();
        alive();
        await vault.beginSubmission(record.id);
        proof = undefined;
        needsObservation = true;
        // Once uncertain is durable, any rejected/lost response keeps that state until explicit observation.
        alive();
        const hash = await w.send(functionName, args);
        alive();
        await vault.noteTransaction(record.id, hash);
        const receipt = await client.waitForTransactionReceipt({
          hash,
          timeout: 30000,
        });
        alive();
        check(receipt.status === "success");
        const state = await observe(password);
        return {
          phase: functionName === "commitCreate" ? "committed" : "submitted",
          state,
          hash,
        };
      }),
    exportBearer: (password) =>
      run(async () => {
        check((await observe(password)) === "observed");
        return exportBearer(profile, image, record.destination);
      }),
    exportPublic: () =>
      run(async () => {
        selected();
        return new Uint8Array(image);
      }),
    cancelProof() {
      prover.cancel?.();
    },
    close() {
      closed = true;
      prover.cancel?.();
      wallet?.close?.();
      vault.close();
      record = undefined;
      image = undefined;
      proof = undefined;
      wallet = undefined;
    },
  };
  return api;
}
