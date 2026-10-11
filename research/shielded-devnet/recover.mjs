// Fresh-process, read-only recovery from user-held disposable test files.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, custom } from "viem";
import { createProfile } from "../shielded-lab/core.mjs";
import { openRecovery, classifySpend } from "../shielded-lab/recovery.mjs";
import {
  pinDeployment,
  observeSpend,
  rebuildTree,
  verifyAsset,
} from "../shielded-lab/chain.mjs";
import { readonlyRpc, RPC, GENESIS } from "./prepare.mjs";
try {
  const [directory, pinsPath] = process.argv.slice(2),
    pins = JSON.parse(readFileSync(pinsPath, "utf8"));
  if (pins.chainId !== "7340469" || pins.genesisHash !== GENESIS) throw Error();
  const p = await createProfile(),
    password = readFileSync(resolve(directory, "password.txt"), "utf8"),
    opened = await openRecovery(
      readFileSync(resolve(directory, "claim.recovery.json"), "utf8"),
      password,
      p,
      pinDeployment(pins),
    ),
    rpc = readonlyRpc();
  const client = createPublicClient({
    transport: custom(
      { request: ({ method, params }) => rpc(method, params ?? []) },
      { retryCount: 0 },
    ),
  });
  await verifyAsset(client, pins, p, opened.record.destination);
  const o = await observeSpend(client, pins, p, opened.record),
    state = classifySpend(p, opened.record, o),
    snapshot = await rebuildTree(client, pins, p);
  if (
    state.state !== "observed" ||
    o.destinationSpent ||
    o.successor !== BigInt(opened.record.destination.commitment)
  )
    throw Error();
  console.log(
    JSON.stringify({
      format: "zft-shielded-devnet-recovery-v1",
      rpc: RPC,
      state: state.state,
      originalDestinationRetained: true,
      destinationCommitment: opened.record.destination.commitment,
      leaves: snapshot.tree.leaves.length,
      block: snapshot.block,
      feeWalletRequired: false,
      scope:
        "Fresh process, same operator and RPC; public event reconstruction from saved user-held authority. Not independent finality or a second-operator drill.",
    }),
  );
} catch {
  console.error("Devnet recovery verification failed");
  process.exitCode = 1;
}
