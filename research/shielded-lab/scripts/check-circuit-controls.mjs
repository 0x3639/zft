import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const lab = fileURLToPath(new URL("../", import.meta.url)),
  root = resolve(lab, "../.."),
  compiler = resolve(lab, ".tools/circom");
const mutations = [
  [
    "nullifier-relation",
    "spend",
    "spend",
    "nullifier === n.out;",
    "nullifier === nullifier;",
  ],
  [
    "old-secret-nullifier",
    "spend",
    "spend",
    "n.inputs[2] <== secret;",
    "n.inputs[2] <== nextSecret;",
  ],
  [
    "root-relation",
    "spend",
    "spend",
    "root === nodes[depth];",
    "root === root;",
  ],
  [
    "successor-relation",
    "spend",
    "spend",
    "outputCommitment === next.commitment;",
    "outputCommitment === outputCommitment;",
  ],
  [
    "asset-preservation",
    "spend",
    "spend",
    "next.assetHi <== assetHi;",
    "next.assetHi <== assetHi + 1;",
  ],
  [
    "path-boolean",
    "spend",
    "spend",
    "bits[i] * (bits[i]-1) === 0;",
    "0 === 0;",
  ],
  [
    "asset-range",
    "create",
    "note",
    "hi = Num2Bits(128);",
    "hi = Num2Bits(129);",
  ],
  ["secret-zero", "create", "note", "zs.out === 0;", "zs.out === zs.out;"],
];
const controls = [];
for (const [name, circuit, file, from, to] of mutations) {
  const baseline = spawnSync(
    process.execPath,
    [
      resolve(lab, "scripts/constraint-assert.mjs"),
      name,
      resolve(lab, `build/${circuit}_js/${circuit}.wasm`),
      resolve(lab, `build/${circuit}.r1cs`),
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(baseline.status, 0, `Baseline ${name}: ${baseline.stderr}`);
  const dir = mkdtempSync(join(tmpdir(), "zft-shielded-control-"));
  try {
    for (const n of ["note", "create", "spend"]) {
      let source = readFileSync(
        resolve(root, `circuits/shielded/${n}.circom`),
        "utf8",
      );
      if (n === file) {
        assert.equal(
          source.split(from).length - 1,
          1,
          "Mutation anchor unique",
        );
        source = source.replace(from, to);
      }
      writeFileSync(join(dir, n + ".circom"), source);
    }
    execFileSync(
      compiler,
      [
        join(dir, circuit + ".circom"),
        "--r1cs",
        "--wasm",
        "--O2",
        "-l",
        resolve(lab, "node_modules"),
        "-o",
        dir,
      ],
      { stdio: "pipe", timeout: 30000 },
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve(lab, "scripts/constraint-assert.mjs"),
        name,
        join(dir, `${circuit}_js/${circuit}.wasm`),
        join(dir, `${circuit}.r1cs`),
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(
      result.status,
      1,
      `Mutation ${name} must fail the assertion, not compilation or timeout`,
    );
    assert.match(result.stderr, /ERR_ASSERTION/);
    assert.ok(result.stderr.includes(`CONSTRAINT_${name}`));
    controls.push({
      name,
      baseline: "rejects-adversarial-witness",
      mutation: "named-assertion-failed",
      scope:
        "Witness generation plus R1CS checking; not an independent security proof",
    });
    console.log(`${name}: detected by named assertion`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
writeFileSync(
  resolve(lab, "build/circuit-controls.json"),
  JSON.stringify(
    { format: "zft-shielded-circuit-controls-v1", controls },
    null,
    2,
  ) + "\n",
);
