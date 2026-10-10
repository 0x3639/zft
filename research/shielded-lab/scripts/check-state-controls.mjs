import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { stateMutations } from "../test/registry-state-support.mjs";
const lab = fileURLToPath(new URL("../", import.meta.url));
const run = (name) =>
  spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "test/registry-state.test.mjs"],
    {
      cwd: lab,
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, ZFT_SHIELDED_STATE_MUTATION: name },
    },
  );
const baseline = run("");
assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
const controls = [];
for (const name of Object.keys(stateMutations)) {
  const result = run(name),
    output = result.stdout + result.stderr;
  assert.equal(
    result.status,
    1,
    `${name}: must fail assertion, not timeout/crash`,
  );
  assert.match(output, /ERR_ASSERTION/, `${name}: must fail a test assertion`);
  controls.push({
    name,
    baseline: "passed",
    mutation: "named-assertion-failed",
  });
  console.log(`${name}: detected by named assertion`);
}
writeFileSync(
  new URL("../build/state-controls.json", import.meta.url),
  JSON.stringify(
    {
      format: "zft-shielded-state-controls-v1",
      scope:
        "Reduced-depth registry with deliberately accepting verifier: EVM state checks only, not cryptographic acceptance",
      controls,
    },
    null,
    2,
  ) + "\n",
);
