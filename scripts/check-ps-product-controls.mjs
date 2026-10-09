import assert from "node:assert/strict";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(join(root, "apps/web/src/ps/bridge.ts"), "utf8");
const controls = [
  [
    "late worker reply",
    "this.worker !== worker || ",
    "",
    "late replies after lock",
  ],
  [
    "foreign origin",
    'url.hostname !== "127.0.0.1" ||',
    "false ||",
    "exact loopback capabilities",
  ],
  [
    "message override",
    "{ ...data, id, action }",
    "{ id, action, ...data }",
    "reserves its message ID",
  ],
];
for (const [name, from, to, test] of controls) {
  assert.equal(source.split(from).length, 2, name + " anchor");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "zft-product-control-")));
  try {
    for (const [path, body] of [
      ["apps/web/src/ps/bridge.ts", source.replace(from, to)],
      [
        "tests/ps-product.test.ts",
        readFileSync(join(root, "tests/ps-product.test.ts"), "utf8"),
      ],
      ["package.json", '{"type":"module"}'],
    ]) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    symlinkSync(resolve(root, "node_modules"), join(dir, "node_modules"));
    const result = spawnSync(
      process.execPath,
      [
        join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--root",
        dir,
        "--config",
        join(root, "vitest.config.ts"),
        "tests/ps-product.test.ts",
        "-t",
        test,
      ],
      { cwd: dir, encoding: "utf8", timeout: 30000 },
    );
    const output = result.stdout + result.stderr;
    assert(
      !result.error && result.status !== 0 && /AssertionError/.test(output),
      name + "\n" + output,
    );
    console.log("PASS detected: " + name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
