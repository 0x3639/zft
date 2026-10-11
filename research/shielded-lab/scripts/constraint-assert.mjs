// Public adversarial fixtures for testing a selected R1CS, never user witnesses.
import assert from "node:assert/strict";
import { wtns } from "snarkjs";
import { createProfile, domain, limbs, Q } from "../core.mjs";
import { deployment, metadata } from "../test/fixtures.mjs";
import { closeProver } from "../prover.mjs";
const [which, wasm, r1cs] = process.argv.slice(2),
  p = await createProfile(),
  old = p.note(deployment, metadata, 1n, 2n),
  next = p.note(deployment, metadata, 3n, 4n),
  tree = new p.Tree();
tree.append(BigInt(old.commitment));
const create = p.creationInput(old),
  spend = p.spendInput(old, next, tree.path(0));
let input;
if (which === "asset-range" || which === "secret-zero") {
  input = {
    ...create,
    ...(which === "asset-range"
      ? { assetHi: String(1n << 128n) }
      : { secret: "0" }),
  };
  input.commitment = String(
    p.H([
      1n,
      BigInt(input.domain),
      BigInt(input.assetHi),
      BigInt(input.assetLo),
      BigInt(input.secret),
      BigInt(input.randomness),
    ]),
  );
} else {
  input = structuredClone(spend);
  if (which === "nullifier-relation")
    input.nullifier = String(BigInt(input.nullifier) + 1n);
  if (which === "old-secret-nullifier")
    input.nullifier = String(
      p.H([
        2n,
        domain(deployment),
        BigInt(next.secret),
        BigInt(old.commitment),
      ]),
    );
  if (which === "root-relation") input.root = String(BigInt(input.root) + 1n);
  if (which === "successor-relation")
    input.outputCommitment = String(BigInt(input.outputCommitment) + 1n);
  if (which === "asset-preservation") {
    const [hi, lo] = limbs(old.assetId);
    input.outputCommitment = String(
      p.H([
        1n,
        domain(deployment),
        hi + 1n,
        lo,
        BigInt(next.secret),
        BigInt(next.randomness),
      ]),
    );
  }
  if (which === "path-boolean") {
    input.bits[0] = "2";
    let cur = BigInt(old.commitment);
    for (let i = 0; i < 16; i++) {
      const bit = BigInt(input.bits[i]),
        s = BigInt(input.siblings[i]);
      cur = p.H([
        (((cur + bit * (s - cur)) % Q) + Q) % Q,
        (((s + bit * (cur - s)) % Q) + Q) % Q,
      ]);
    }
    input.root = String(cur);
  }
}
try {
  const witness = { type: "mem" };
  let accepted = false;
  try {
    await wtns.calculate(input, wasm, witness);
    accepted = await wtns.check(r1cs, witness, {
      info() {},
      warn() {},
      error() {},
      debug() {},
    });
  } catch {}
  assert.equal(
    accepted,
    false,
    `CONSTRAINT_${which}: adversarial witness must be rejected`,
  );
  console.log(`CONSTRAINT_${which}: rejected`);
} finally {
  await closeProver();
}
