// Disposable fresh-client acceptance harness; no application service or parent-process key transfer.
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { createProfile } from "../core.mjs";
import {
  openRecovery,
  sealRecovery,
  operation,
  classifySpend,
} from "../recovery.mjs";
import {
  pinDeployment,
  rebuildTree,
  observeSpend,
  verifyAsset,
} from "../chain.mjs";
import { prove, closeProver } from "../prover.mjs";
const [recordPath, pinsPath, rpc, nextPath] = process.argv.slice(2);
const url = new URL(rpc);
if (
  url.protocol !== "http:" ||
  url.hostname !== "127.0.0.1" ||
  url.username ||
  url.password
)
  throw Error("This test worker only accepts numeric loopback");
const { password } = JSON.parse(readFileSync(0, "utf8")),
  pins = JSON.parse(readFileSync(pinsPath, "utf8")),
  profile = await createProfile();
const { record, image } = await openRecovery(
  readFileSync(recordPath, "utf8"),
  password,
  profile,
  pinDeployment(pins),
);
const client = createPublicClient({
  transport: http(rpc, { timeout: 5000, retryCount: 0 }),
});
try {
  await verifyAsset(client, pins, profile, record.destination);
  const observation = await observeSpend(client, pins, profile, record),
    state = classifySpend(profile, record, observation),
    snapshot = await rebuildTree(client, pins, profile);
  const result = {
    state: state.state,
    destination: record.destination.commitment,
    root: String(snapshot.tree.root),
    leaves: snapshot.tree.leaves.length,
  };
  if (nextPath) {
    if (state.state !== "observed")
      throw Error("Cannot prepare successor from unresolved recovery");
    const next = profile.note(pinDeployment(pins), record.destination.metadata);
    const saved = operation(profile, {
      image,
      source: record.destination,
      destination: next,
      pins,
    });
    const sealed = await sealRecovery(saved, password);
    writeFileSync(nextPath, sealed, { flag: "wx", mode: 0o600 });
    const reselected = await openRecovery(
      readFileSync(nextPath, "utf8"),
      password,
      profile,
      pinDeployment(pins),
    );
    if (reselected.record.id !== saved.id)
      throw Error("Recovery reselection mismatch");
    const index = snapshot.tree.leaves.indexOf(
      BigInt(record.destination.commitment),
    );
    const proof = await prove(
      "spend",
      profile.spendInput(record.destination, next, snapshot.tree.path(index)),
      "groth16",
      pins,
    );
    result.spend = {
      anchor: proof.publicSignals[1],
      nullifier: proof.publicSignals[2],
      outputCommitment: proof.publicSignals[3],
      proof: proof.data,
    };
  }
  console.log(JSON.stringify(result));
} finally {
  await closeProver();
}
