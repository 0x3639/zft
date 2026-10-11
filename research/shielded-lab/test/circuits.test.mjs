import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wtns } from "snarkjs";
import { createProfile, Q, domain, limbs, MAX_SECRET } from "../core.mjs";
import { closeProver } from "../prover.mjs";
import { deployment as d, metadata as m } from "./fixtures.mjs";
const lab = fileURLToPath(new URL("../", import.meta.url)),
  dir = mkdtempSync(join(tmpdir(), "zft-shielded-witness-")),
  p = await createProfile();
const old = p.note(d, m, 1n, 2n),
  next = p.note(d, m, 3n, 4n),
  tree = new p.Tree();
tree.append(BigInt(old.commitment));
const inputs = {
  create: p.creationInput(old),
  spend: p.spendInput(old, next, tree.path(0)),
};
const logger = { info() {}, warn() {}, error() {}, debug() {} };
after(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closeProver();
});
for (const name of ["create", "spend"])
  test(`${name}: real witness satisfies R1CS and every altered public input fails R1CS`, async () => {
    const good = join(dir, name + ".wtns");
    await wtns.calculate(
      inputs[name],
      resolve(lab, `build/${name}_js/${name}.wasm`),
      good,
    );
    assert.equal(
      await wtns.check(resolve(lab, `build/${name}.r1cs`), good, logger),
      true,
    );
    const bytes = readFileSync(good);
    let at = 12,
      witnessOffset;
    for (let i = 0; i < bytes.readUInt32LE(8); i++) {
      const type = bytes.readUInt32LE(at),
        size = Number(bytes.readBigUInt64LE(at + 4));
      if (type === 2) witnessOffset = at + 12;
      at += 12 + size;
    }
    assert.ok(witnessOffset);
    for (let wire = 1; wire <= 4; wire++) {
      const changed = Buffer.from(bytes),
        offset = witnessOffset + wire * 32;
      let value = 0n;
      for (let i = 31; i >= 0; i--)
        value = (value << 8n) | BigInt(changed[offset + i]);
      value = (value + 1n) % Q;
      for (let i = 0; i < 32; i++) {
        changed[offset + i] = Number(value & 255n);
        value >>= 8n;
      }
      const out = join(dir, `${name}-bad-${wire}.wtns`);
      writeFileSync(out, changed);
      assert.equal(
        await wtns.check(resolve(lab, `build/${name}.r1cs`), out, logger),
        false,
        `Public input wire ${wire} must be constrained`,
      );
    }
  });
test("creation circuit rejects out-of-range asset limbs and authority", async () => {
  for (const [field, value] of [
    ["assetHi", 1n << 128n],
    ["assetLo", 1n << 128n],
    ["secret", 0n],
    ["randomness", 0n],
    ["secret", MAX_SECRET],
    ["randomness", MAX_SECRET],
  ]) {
    const input = { ...inputs.create, [field]: String(value) };
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
    await assert.rejects(
      wtns.calculate(
        input,
        resolve(lab, "build/create_js/create.wasm"),
        join(dir, "invalid.wtns"),
      ),
      field + " must be range/nonzero constrained",
    );
  }
});
test("spend circuit rejects selected invalid authority, nullifier, output and path witnesses", async () => {
  const bad = [
    { nullifier: String(BigInt(inputs.spend.nullifier) + 1n) },
    { outputCommitment: String(BigInt(next.commitment) + 1n) },
    { root: String(tree.root + 1n) },
    { secret: "2" },
    { nextSecret: "0" },
    { bits: inputs.spend.bits.map((b, i) => (i === 0 ? "2" : b)) },
    { siblings: inputs.spend.siblings.map((s, i) => (i === 0 ? "1" : s)) },
  ];
  for (const patch of bad)
    await assert.rejects(
      wtns.calculate(
        { ...inputs.spend, ...patch },
        resolve(lab, "build/spend_js/spend.wasm"),
        join(dir, "bad-spend.wtns"),
      ),
    );
  const self = {
    ...inputs.spend,
    nextSecret: old.secret,
    nextRandomness: old.randomness,
    outputCommitment: old.commitment,
  };
  await assert.rejects(
    wtns.calculate(
      self,
      resolve(lab, "build/spend_js/spend.wasm"),
      join(dir, "self.wtns"),
    ),
  );
});
