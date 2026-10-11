import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { encode } from "fast-png";
import { indexedDB } from "fake-indexeddb";
import { openVault } from "../vault.mjs";
import { createWalletClient, http } from "viem";
import { foundry } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { startAnvil, lab } from "../evm-test.mjs";
import {
  deployFixture,
  authorizeCreation,
  authorizationArgs,
} from "../local-fixture.mjs";
import { createProfile, domain, canonical } from "../core.mjs";
import {
  pinDeployment,
  verifyDeployment,
  rebuildTree,
  verifyAsset,
  observeCreation,
} from "../chain.mjs";
import { prove, closeProver } from "../prover.mjs";
import {
  normalizeImage,
  exportBearer,
  importBearer,
} from "../file-adapter.mjs";
import {
  operation,
  sealRecovery,
  openRecovery,
  classifyCreation,
} from "../recovery.mjs";
import { metadata as fixtureMetadata } from "./fixtures.mjs";

test("two real clients mint, claim, reject competing/old proofs, recover and spend without ZFT services", async () => {
  const evm = await startAnvil(),
    dir = mkdtempSync(join(tmpdir(), "zft-shielded-lifecycle-")),
    password = "disposable recovery acceptance password";
  try {
    const fixture = await deployFixture(evm),
      { address, abi, pins } = fixture,
      d = pinDeployment(pins),
      p = await createProfile();
    await verifyDeployment(evm.client, pins);
    const read = (functionName, args = []) =>
      evm.client.readContract({ address, abi, functionName, args });
    assert.equal(await read("domain"), domain(d), "Contract/SDK domain parity");
    const normalized = await normalizeImage(
      encode({
        width: 1,
        height: 1,
        channels: 4,
        depth: 8,
        data: new Uint8Array([20, 40, 80, 255]),
      }),
    );
    const metadata = {
        ...fixtureMetadata,
        imageHash: normalized.imageHash,
        creator: evm.account.address.toLowerCase(),
      },
      old = p.note(d, metadata);
    const creation = await authorizeCreation(evm, d, old),
      createProof = await prove(
        "create",
        p.creationInput(old),
        "groth16",
        pins,
      );
    const initial = operation(p, {
      image: normalized.bytes,
      destination: old,
      pins,
      creation,
    });
    const badArtifactPins = structuredClone(pins);
    badArtifactPins.artifacts.createKey = "0x" + "0".repeat(64);
    await assert.rejects(
      prove("create", p.creationInput(old), "groth16", badArtifactPins),
      /artifact pin mismatch/,
    );
    assert.equal(
      classifyCreation(
        initial,
        await observeCreation(evm.client, pins, p, initial),
      ).state,
      "unobserved",
    );
    const journal = await openVault({
      indexedDB,
      name: "shielded-lifecycle-" + crypto.randomUUID(),
    });
    try {
      await journal.prepare(p, initial, password, d);
      assert.equal(
        (await journal.observe(initial.id, password, p, evm.client, pins))
          .state,
        "unobserved",
      );
      await journal.acknowledge(
        initial.id,
        await journal.export(initial.id),
        password,
        p,
        d,
      );
      await journal.beginSubmission(initial.id);
      assert.equal(
        (await journal.list())[0].state,
        "uncertain",
        "Unobserved-before-ack recovery can still safely begin submission",
      );
    } finally {
      journal.close();
    }
    const savedMint = await sealRecovery(initial, password);
    writeFileSync(join(dir, "mint.recovery"), savedMint, {
      mode: 0o600,
      flag: "wx",
    });
    assert.equal(
      (
        await openRecovery(
          readFileSync(join(dir, "mint.recovery"), "utf8"),
          password,
          p,
          d,
        )
      ).record.id,
      initial.id,
      "Recovery selected before mint submission",
    );
    const a = authorizationArgs(creation.authorization),
      digest = await read("commitmentDigest", [a, creation.salt]);
    await assert.rejects(
      evm.write(address, abi, "create", [
        a,
        creation.salt,
        creation.signature,
        createProof.data,
      ]),
      "Reveal without matured commitment rejects",
    );
    await evm.write(address, abi, "commitCreate", [digest]);
    await evm.mine(2);
    await evm.write(address, abi, "create", [
      a,
      creation.salt,
      creation.signature,
      createProof.data,
    ]);
    assert.equal(await read("imageAssets", [old.imageHash]), old.assetId);
    assert.equal(
      classifyCreation(
        initial,
        await observeCreation(evm.client, pins, p, initial),
      ).state,
      "observed",
    );
    assert.equal(
      (await verifyAsset(evm.client, pins, p, old)).creator,
      metadata.creator,
    );
    const bearer = await exportBearer(p, normalized.bytes, old),
      imported = await importBearer(p, bearer, d);
    // B uses a separate profile instance and fresh destination authority.
    const b = await createProfile(),
      destination = b.note(d, imported.note.metadata),
      snapshot = await rebuildTree(evm.client, pins, b);
    assert.equal(snapshot.tree.leaves.length, 1);
    assert.equal(snapshot.tree.root, await read("root"));
    const record = operation(b, {
      image: imported.image,
      source: imported.note,
      destination,
      pins,
    });
    const saved = await sealRecovery(record, password),
      recoveryPath = join(dir, "claim.recovery"),
      pinsPath = join(dir, "trusted-pins.json");
    writeFileSync(recoveryPath, saved, { mode: 0o600, flag: "wx" });
    writeFileSync(pinsPath, JSON.stringify(pins), { flag: "wx" });
    assert.equal(
      (await openRecovery(readFileSync(recoveryPath, "utf8"), password, b, d))
        .record.id,
      record.id,
      "Recipient recovery selected before spend submission",
    );
    const proof = await prove(
      "spend",
      b.spendInput(imported.note, destination, snapshot.tree.path(0)),
    );
    for (const patch of [
      { anchor: 0n },
      { nullifier: proof.signals[2] + 1n },
      { outputCommitment: proof.signals[3] + 1n },
    ]) {
      const args = {
        anchor: proof.signals[1],
        nullifier: proof.signals[2],
        outputCommitment: proof.signals[3],
        ...patch,
      };
      await assert.rejects(
        evm.write(address, abi, "spend", [
          args.anchor,
          args.nullifier,
          args.outputCommitment,
          proof.data,
        ]),
      );
      assert.equal(await read("nextIndex"), 1n, "Rejected proof cannot append");
      assert.equal(await read("nullifiers", [proof.signals[2]]), false);
    }
    const beforeClaim = await evm.client.request({
      method: "evm_snapshot",
      params: [],
    });
    // The caller deliberately discards the successful submission response.
    await evm.write(address, abi, "spend", [
      proof.signals[1],
      proof.signals[2],
      proof.signals[3],
      proof.data,
    ]);
    await assert.rejects(
      evm.write(address, abi, "spend", [
        proof.signals[1],
        proof.signals[2],
        proof.signals[3],
        proof.data,
      ]),
      "Old exact proof cannot spend twice",
    );
    const competing = p.note(d, metadata),
      competingProof = await prove(
        "spend",
        p.spendInput(old, competing, snapshot.tree.path(0)),
      );
    await assert.rejects(
      evm.write(address, abi, "spend", [
        ...competingProof.signals.slice(1),
        competingProof.data,
      ]),
      "Another valid proof from old bearer fails",
    );
    assert.equal(await read("nextIndex"), 2n);
    // A selected local reorg removes the observation, not the saved successor authority.
    assert.equal(
      await evm.client.request({ method: "evm_revert", params: [beforeClaim] }),
      true,
    );
    const rewound = JSON.parse(
      execFileSync(
        process.execPath,
        [
          resolve(lab, "scripts/recover-worker.mjs"),
          recoveryPath,
          pinsPath,
          evm.url,
        ],
        {
          encoding: "utf8",
          input: JSON.stringify({ password }),
          timeout: 60000,
        },
      ),
    );
    assert.equal(rewound.state, "unobserved");
    assert.equal(rewound.leaves, 1);
    await evm.write(address, abi, "spend", [
      proof.signals[1],
      proof.signals[2],
      proof.signals[3],
      proof.data,
    ]);
    const recoveredPath = join(dir, "fresh-client-next.recovery");
    const recovered = JSON.parse(
      execFileSync(
        process.execPath,
        [
          resolve(lab, "scripts/recover-worker.mjs"),
          recoveryPath,
          pinsPath,
          evm.url,
          recoveredPath,
        ],
        {
          encoding: "utf8",
          input: JSON.stringify({ password }),
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        },
      ),
    );
    assert.equal(recovered.state, "observed");
    assert.equal(recovered.destination, destination.commitment);
    assert.equal(recovered.leaves, 2);
    const s = recovered.spend;
    await evm.write(address, abi, "spend", [
      BigInt(s.anchor),
      BigInt(s.nullifier),
      BigInt(s.outputCommitment),
      s.proof,
    ]);
    const again = JSON.parse(
      execFileSync(
        process.execPath,
        [
          resolve(lab, "scripts/recover-worker.mjs"),
          recoveredPath,
          pinsPath,
          evm.url,
        ],
        {
          encoding: "utf8",
          input: JSON.stringify({ password }),
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        },
      ),
    );
    assert.equal(again.state, "observed");
    assert.equal(again.destination, s.outputCommitment);
    assert.equal(again.leaves, 3);
    const rebuilt = await rebuildTree(evm.client, pins, p);
    assert.equal(String(rebuilt.tree.root), again.root);
    // Two independently signed transactions compete in the same block.
    const current = (
      await openRecovery(readFileSync(recoveredPath, "utf8"), password, p, d)
    ).record.destination;
    const outputs = [p.note(d, metadata), p.note(d, metadata)],
      index = rebuilt.tree.leaves.indexOf(BigInt(current.commitment)),
      race = [];
    for (const output of outputs)
      race.push(
        await prove(
          "spend",
          p.spendInput(current, output, rebuilt.tree.path(index)),
        ),
      );
    assert.equal(race[0].signals[2], race[1].signals[2]);
    const fee2 = privateKeyToAccount(generatePrivateKey()),
      wallet2 = createWalletClient({
        chain: foundry,
        transport: http(evm.url),
        account: fee2,
      });
    await evm.client.request({
      method: "anvil_setBalance",
      params: [fee2.address, "0x3635c9adc5dea00000"],
    });
    await evm.client.request({ method: "evm_setAutomine", params: [false] });
    try {
      const txs = await Promise.all(
        [evm.wallet, wallet2].map((wallet, i) =>
          wallet.writeContract({
            address,
            abi,
            functionName: "spend",
            args: [...race[i].signals.slice(1), race[i].data],
            gas: 2000000n,
          }),
        ),
      );
      await evm.mine();
      const receipts = await Promise.all(
        txs.map((hash) => evm.client.waitForTransactionReceipt({ hash })),
      );
      assert.equal(
        receipts.filter((r) => r.status === "success").length,
        1,
        "Exactly one same-block spend wins",
      );
      assert.equal(
        receipts[0].blockHash,
        receipts[1].blockHash,
        "Both competing spends mined in one block",
      );
      const winner = receipts.findIndex((r) => r.status === "success");
      assert.equal(
        await read("successor", [race[0].signals[2]]),
        BigInt(outputs[winner].commitment),
      );
      assert.equal(
        await read("nextIndex"),
        4n,
        "A competing spend cannot mint a second output",
      );
    } finally {
      await evm.client.request({ method: "evm_setAutomine", params: [true] });
    }
    const badPins = structuredClone(pins);
    badPins.genesisHash = "0x" + "0".repeat(64);
    await assert.rejects(verifyDeployment(evm.client, badPins));
    const noEvents = Object.create(evm.client);
    noEvents.getLogs = async () => [];
    await assert.rejects(
      rebuildTree(noEvents, pins, p),
      "Omitted index events cannot fabricate complete state",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await closeProver();
    await evm.stop();
  }
});
