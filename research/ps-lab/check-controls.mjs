// Prove the negative tests catch deliberately removed cryptographic checks.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const source = readFileSync(new URL("./verify.mjs", import.meta.url), "utf8");
const controls = [
  [
    "pairing",
    "bls.fields.Fp12.eql(product, bls.fields.Fp12.ONE)",
    "true",
    "reject credential with changed signature",
  ],
  [
    "linear",
    'challenge(transcript), c, "linear challenge"',
    'c, c, "linear challenge"',
    "reject old issuance version, changed session and changed keyset context",
  ],
  [
    "dleq",
    'challenge(transcript), c, "DLEQ challenge"',
    'c, c, "DLEQ challenge"',
    "reject rewrapped showing under a new profile with the old owner proof",
  ],
];
for (const [name, check, replacement, expectedFailure] of controls) {
  assert.equal(
    source.split(check).length,
    2,
    `unique ${name} mutation location`,
  );
  const file = new URL(
    `./.control-${process.pid}-${name}.mjs`,
    import.meta.url,
  );
  try {
    writeFileSync(file, source.replace(check, replacement), { flag: "wx" });
    const run = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=tap",
        fileURLToPath(new URL("./verify.test.mjs", import.meta.url)),
      ],
      {
        env: { ...process.env, ZFT_PS_VERIFIER: file.href },
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    assert.ifError(run.error);
    assert.equal(run.signal, null);
    assert.equal(
      run.status,
      1,
      `${name}: deliberately broken verifier must fail`,
    );
    assert(
      run.stdout
        .split("\n")
        .some(
          (line) =>
            /^not ok \d+ - /.test(line) && line.endsWith(expectedFailure),
        ),
      `${name}: expected negative test must fail, not an unrelated setup error\n${run.stdout}\n${run.stderr}`,
    );
    console.log(`${name}: removed check detected by "${expectedFailure}"`);
  } finally {
    unlinkSync(file);
  }
}
