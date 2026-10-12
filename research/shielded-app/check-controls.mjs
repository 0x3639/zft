import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const controls = [
  [
    "gallery-read-only",
    "client.mjs",
    "// Do not select, acknowledge, observe or write a record during gallery unlock.",
    "select(opened, true); // Wrongly select a previewed record.",
    "saved pictures remain discoverable",
  ],
  [
    "creation-waiting-stage",
    "client.mjs",
    'phase: "waiting",',
    'phase: "reveal",',
    "creation progress distinguishes",
  ],
  [
    "saved-file-ack",
    "client.mjs",
    "row.acknowledged &&",
    "true &&",
    "real create/claim recovery",
  ],
  [
    "proof-output-binding",
    "client.mjs",
    "canonical(signals.map(String)) === canonical(expected.map(String))",
    "true",
    "acknowledgement rejects wrong exports",
  ],
  [
    "uncertain-before-send",
    "client.mjs",
    "await vault.beginSubmission(record.id);",
    'if (record.kind !== "spend") await vault.beginSubmission(record.id);',
    "lost wallet response",
  ],
  [
    "wallet-session",
    "wallet.mjs",
    "async function assertCurrent() {",
    "async function assertCurrent() { return;",
    "changed wallet account or chain",
  ],
  [
    "wallet-genesis-code",
    "wallet.mjs",
    "await verifyDeployment(walletChain, pins);",
    "/* omitted */",
    "wallet RPC must match",
  ],
  [
    "restored-observation",
    "client.mjs",
    "!needsObservation,",
    "true,",
    "real create/claim recovery",
  ],
  [
    "closed-session",
    "client.mjs",
    "if (closed) throw Error(MESSAGES.closed);",
    "/* omitted */",
    "close during proving",
  ],
  [
    "artifact-pin",
    "config.mjs",
    "a.sha256 ===\n          pins.artifacts[",
    "true || a.sha256 ===\n          pins.artifacts[",
    "configuration pins exact artifacts",
  ],
];
for (const [name, file, before, after, pattern] of controls) {
  const temp = mkdtempSync(join(tmpdir(), "zft-shielded-app-control-"));
  try {
    mkdirSync(join(temp, "packages"), { recursive: true });
    mkdirSync(join(temp, "research"), { recursive: true });
    symlinkSync(resolve(root, "node_modules"), join(temp, "node_modules"));
    symlinkSync(
      resolve(root, "packages/file-codec"),
      join(temp, "packages/file-codec"),
    );
    symlinkSync(
      resolve(root, "research/shielded-lab"),
      join(temp, "research/shielded-lab"),
    );
    cpSync(
      resolve(root, "packages/shielded"),
      join(temp, "packages/shielded"),
      { recursive: true },
    );
    cpSync(
      resolve(root, "research/shielded-app/test"),
      join(temp, "research/shielded-app/test"),
      { recursive: true },
    );
    writeFileSync(
      join(temp, "package.json"),
      '{"private":true,"type":"module"}\n',
    );
    const path = join(temp, "packages/shielded", file),
      original = readFileSync(path, "utf8");
    assert.equal(
      original.split(before).length,
      2,
      `${name} mutation must match exactly once`,
    );
    writeFileSync(path, original.replace(before, after));
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        resolve(root, "node_modules/tsx/dist/loader.mjs"),
        "--test",
        "--test-name-pattern",
        pattern,
        "research/shielded-app/test/client.test.mjs",
      ],
      {
        cwd: temp,
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const output = (run.stdout ?? "") + (run.stderr ?? "");
    assert.ok(
      !run.error &&
        run.status !== 0 &&
        output.includes("ERR_ASSERTION") &&
        output.includes(pattern),
      `${name}: expected named assertion failure, got ${run.error ?? run.status}\n${output}`,
    );
    console.log(`PASS ${name}: weakened control fails named ERR_ASSERTION`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
console.log(`${controls.length} shielded integration controls detected`);
