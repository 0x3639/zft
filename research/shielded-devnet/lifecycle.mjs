import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { encodeFunctionData } from "viem";
import { encode } from "fast-png";
import {
  createProfile,
  canonical,
  domain,
  digest,
} from "../shielded-lab/core.mjs";
import {
  normalizeImage,
  exportBearer,
  importBearer,
} from "../shielded-lab/file-adapter.mjs";
import {
  operation,
  sealRecovery,
  openRecovery,
  classifyCreation,
  classifySpend,
} from "../shielded-lab/recovery.mjs";
import {
  pinDeployment,
  verifyDeployment,
  observeCreation,
  observeSpend,
  rebuildTree,
  verifyAsset,
} from "../shielded-lab/chain.mjs";
import {
  authorizeCreation,
  authorizationArgs,
} from "../shielded-lab/local-fixture.mjs";
import { prove, closeProver } from "../shielded-lab/prover.mjs";
import { approvedPlan } from "./deploy.mjs";
import {
  withRunner,
  check,
  maybe,
  saveNew,
  json,
  REGISTRY,
} from "./runner.mjs";
import { RPC } from "./prepare.mjs";
const here = dirname(fileURLToPath(import.meta.url));
async function main() {
  const [feeDir, clientDir, output, approval, ...extra] = process.argv.slice(2);
  check(
    feeDir &&
      clientDir &&
      output &&
      approval === "--execute-approved-devnet" &&
      !extra.length,
    "Explicit approved-devnet execution required",
  );
  if (!existsSync(clientDir)) mkdirSync(clientDir, { mode: 0o700 });
  const st = lstatSync(clientDir);
  check(
    st.isDirectory() &&
      !st.isSymbolicLink() &&
      (st.mode & 0o077) === 0 &&
      st.uid === process.getuid(),
    "Private test client directory required",
  );
  if (!existsSync(resolve(clientDir, "password.txt")))
    saveNew(clientDir, "password.txt", randomBytes(32).toString("base64url"));
  const password = readFileSync(resolve(clientDir, "password.txt"), "utf8"),
    pins = JSON.parse(readFileSync(resolve(feeDir, "pins.json"), "utf8")),
    d = pinDeployment(pins),
    p = await createProfile(),
    plan = approvedPlan();
  const abi = JSON.parse(
    readFileSync(resolve(here, "../shielded-lab/build/contracts.json")),
  ).contracts.ShieldedRegistry.abi;
  const data = (functionName, args) =>
    encodeFunctionData({ abi, functionName, args });
  await withRunner(feeDir, plan, async (r) => {
    await verifyDeployment(r.client, pins);
    check(d.registry === REGISTRY, "Wrong isolated registry");
    const read = (functionName, args = []) =>
      r.client.readContract({ address: REGISTRY, abi, functionName, args });
    check((await read("domain")) === domain(d), "Domain parity failed");
    async function saved(name, create) {
      const path = resolve(clientDir, name);
      if (!existsSync(path))
        saveNew(clientDir, name, await sealRecovery(await create(), password));
      return openRecovery(readFileSync(path, "utf8"), password, p, d);
    }
    const initial = await saved("creation.recovery.json", async () => {
      const normalized = await normalizeImage(
        encode({
          width: 1,
          height: 1,
          channels: 4,
          depth: 8,
          data: new Uint8Array([47, 139, 217, 255]),
        }),
      );
      const note = p.note(d, {
        format: "zft-shielded-metadata-v1",
        name: "Disposable ZVM devnet shielded trial",
        description: "Test image only; user-held authority; no monetary value.",
        imageHash: normalized.imageHash,
        canonicalizer: "zft-png/1",
        mediaType: "image/png",
        width: 1,
        height: 1,
        creator: r.account.address.toLowerCase(),
        createdAt: new Date().toISOString(),
      });
      const creation = await authorizeCreation(r, d, note);
      return operation(p, {
        image: normalized.bytes,
        destination: note,
        pins,
        creation,
      });
    });
    const record = initial.record,
      a = authorizationArgs(record.creation.authorization);
    async function cachedProof(name, kind, input) {
      let proof = maybe(clientDir, name);
      if (!proof) {
        const result = await prove(kind, input, "groth16", pins);
        proof = { data: result.data, signals: result.signals.map(String) };
        saveNew(clientDir, name, proof);
      }
      return { data: proof.data, signals: proof.signals.map(BigInt) };
    }
    const createProof = await cachedProof(
      "create-proof.json",
      "create",
      p.creationInput(record.destination),
    );
    const createArgs = [
      a,
      record.creation.salt,
      record.creation.signature,
      createProof.data,
    ];
    async function rejection(label, args, fn = "spend") {
      let code;
      try {
        await r.rpc("eth_call", [
          {
            from: r.account.address,
            to: REGISTRY,
            data: data(fn, args),
            gas: "0x4c4b40",
          },
          "latest",
        ]);
      } catch (e) {
        code = e.rpcCode;
      }
      check(
        [-32000, -32003, 3].includes(code),
        "Expected execution rejection was not observed",
      );
      return {
        name: label,
        rpcCode: code,
        rejected: true,
        scope: "Read-only eth_call; no reverted transaction was broadcast",
      };
    }
    let before = maybe(clientDir, "before-create.json");
    if (!before) {
      check(
        classifyCreation(
          record,
          await observeCreation(r.client, pins, p, record),
        ).state === "unobserved",
        "Fresh creation already exists",
      );
      before = await rejection("reveal-before-commit", createArgs, "create");
      saveNew(clientDir, "before-create.json", before);
    }
    const commitDigest = await read("commitmentDigest", [
      a,
      record.creation.salt,
    ]);
    const committed = await r.send(
      "creation-commit",
      REGISTRY,
      data("commitCreate", [commitDigest]),
    );
    const deadline = Date.now() + 120000;
    while (
      (await r.client.getBlockNumber({ cacheTime: 0 })) <
      BigInt(committed.blockNumber) + 2n
    ) {
      check(Date.now() < deadline, "Natural devnet blocks not advancing");
      await delay(2000);
    }
    await r.send("creation-reveal", REGISTRY, data("create", createArgs));
    check(
      classifyCreation(record, await observeCreation(r.client, pins, p, record))
        .state === "observed",
      "Creation not observed",
    );
    await verifyAsset(r.client, pins, p, record.destination);
    const originalFile = await exportBearer(
      p,
      initial.image,
      record.destination,
    );
    if (!existsSync(resolve(clientDir, "original-bearer.png")))
      writeFileSync(resolve(clientDir, "original-bearer.png"), originalFile, {
        flag: "wx",
        mode: 0o600,
      });
    const imported = await importBearer(
      p,
      readFileSync(resolve(clientDir, "original-bearer.png")),
      d,
    );
    const claim = await saved("claim.recovery.json", () =>
      operation(p, {
        image: imported.image,
        source: imported.note,
        destination: p.note(d, imported.note.metadata),
        pins,
      }),
    );
    check(
      canonical(claim.record.source) === canonical(record.destination),
      "Claim changed original bearer",
    );
    check(
      claim.record.destination.secret !== claim.record.source.secret &&
        claim.record.destination.randomness !== claim.record.source.randomness,
      "Claim failed to create fresh authority",
    );
    let spendProof = maybe(clientDir, "spend-proof.json"),
      snapshot;
    if (!spendProof) {
      snapshot = await rebuildTree(r.client, pins, p);
      const index = snapshot.tree.leaves.indexOf(
        BigInt(imported.note.commitment),
      );
      check(index >= 0, "Source event missing");
      spendProof = await cachedProof(
        "spend-proof.json",
        "spend",
        p.spendInput(
          claim.record.source,
          claim.record.destination,
          snapshot.tree.path(index),
        ),
      );
    } else
      spendProof = {
        data: spendProof.data,
        signals: spendProof.signals.map(BigInt),
      };
    let negatives = maybe(clientDir, "before-spend.json");
    if (!negatives) {
      negatives = [];
      for (const [name, delta] of [
        ["unknown-root", [0n, spendProof.signals[2], spendProof.signals[3]]],
        [
          "changed-nullifier",
          [
            spendProof.signals[1],
            spendProof.signals[2] + 1n,
            spendProof.signals[3],
          ],
        ],
        [
          "changed-output",
          [
            spendProof.signals[1],
            spendProof.signals[2],
            spendProof.signals[3] + 1n,
          ],
        ],
      ])
        negatives.push(await rejection(name, [...delta, spendProof.data]));
      check(
        (await read("nextIndex")) === 1n &&
          !(await read("nullifiers", [spendProof.signals[2]])),
        "Rejected calls changed state",
      );
      saveNew(clientDir, "before-spend.json", negatives);
    }
    // Preserve the exact operation/proof before dispatch. Recovery below does not use this response.
    await r.send(
      "fresh-secret-claim",
      REGISTRY,
      data("spend", [...spendProof.signals.slice(1), spendProof.data]),
    );
    const oldRejection = await rejection("consumed-exact-proof", [
      ...spendProof.signals.slice(1),
      spendProof.data,
    ]);
    const currentTree = await rebuildTree(r.client, pins, p);
    const oldIndex = currentTree.tree.leaves.indexOf(
      BigInt(claim.record.source.commitment),
    );
    check(oldIndex >= 0, "Consumed source event disappeared");
    const competing = await prove(
      "spend",
      p.spendInput(
        claim.record.source,
        p.note(d, claim.record.source.metadata),
        currentTree.tree.path(oldIndex),
      ),
      "groth16",
      pins,
    );
    const competingRejection = await rejection(
      "competing-proof-from-consumed-bearer",
      [...competing.signals.slice(1), competing.data],
    );
    const observation = await observeSpend(r.client, pins, p, claim.record);
    check(
      classifySpend(p, claim.record, observation).state === "observed" &&
        !observation.destinationSpent,
      "Claim not observed unspent",
    );
    check((await read("nextIndex")) === 2n, "Unexpected append count");
    const successor = await exportBearer(
      p,
      claim.image,
      claim.record.destination,
    );
    if (!existsSync(resolve(clientDir, "successor-bearer.png")))
      writeFileSync(resolve(clientDir, "successor-bearer.png"), successor, {
        flag: "wx",
        mode: 0o600,
      });
    const next = await importBearer(
      p,
      readFileSync(resolve(clientDir, "successor-bearer.png")),
      d,
    );
    check(
      canonical(next.note) === canonical(claim.record.destination),
      "Saved successor changed authority",
    );
    const recovered = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve(here, "recover.mjs"),
          clientDir,
          resolve(feeDir, "pins.json"),
        ],
        { encoding: "utf8", timeout: 120000, maxBuffer: 32768 },
      ),
    );
    check(
      recovered.destinationCommitment === claim.record.destination.commitment &&
        recovered.state === "observed",
      "Fresh recovery replaced destination",
    );
    const report = {
      format: "zft-shielded-devnet-lifecycle-v1",
      recordedAt: new Date().toISOString(),
      rpc: RPC,
      registry: REGISTRY,
      assetId: record.destination.assetId,
      imageSha256: digest(initial.image),
      creationObserved: true,
      recoveryReselectedBeforeEachSubmission: true,
      freshAuthority: true,
      originalDestinationRetained: true,
      sourceConsumed: true,
      successorUnspent: true,
      negativeCalls: [before, ...negatives, oldRejection, competingRejection],
      recovery: recovered,
      transactions: r.entries.map((e) => ({
        label: e.label,
        hash: e.hash,
        nonce: e.nonce,
        maxFeeWei: e.maxFeeWei,
      })),
      maxReservedFeeWei: r.entries
        .reduce((s, e) => s + BigInt(e.gas) * BigInt(e.gasPrice), 0n)
        .toString(),
      exports: {
        creationRecovery: digest(
          readFileSync(resolve(clientDir, "creation.recovery.json")),
        ),
        claimRecovery: digest(
          readFileSync(resolve(clientDir, "claim.recovery.json")),
        ),
        originalBearer: digest(originalFile),
        successorBearer: digest(successor),
      },
      scope:
        "Actual ZVM devnet transactions using disposable local client secrets and fee wallet, saved-file readback, real proofs and fresh-process recovery. RPC inclusion observations; not MetaMask/browser/mobile, independent operator/finality, malicious RPC, actual transport loss or production qualification.",
    };
    writeFileSync(output, json(report), { flag: "wx", mode: 0o600 });
    console.log(
      JSON.stringify({
        stage: "lifecycle-complete",
        assetId: report.assetId,
        recovery: recovered.state,
        maxReservedFeeWei: report.maxReservedFeeWei,
      }),
    );
  });
}
main()
  .catch(() => {
    console.error(
      "Devnet lifecycle stopped; retained recovery and exact transaction journals must be reconciled",
    );
    process.exitCode = 1;
  })
  .finally(closeProver);
