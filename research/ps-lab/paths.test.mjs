import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("mutation controls work from a path with spaces, Unicode and URL metacharacters", () => {
  const directory = mkdtempSync(join(tmpdir(), "zft PS café # "));
  try {
    for (const name of [
      "check-controls.mjs",
      "verify.mjs",
      "verify.test.mjs",
      "vectors.json",
    ]) {
      copyFileSync(new URL(name, import.meta.url), join(directory, name));
    }
    symlinkSync(
      fileURLToPath(new URL("./node_modules", import.meta.url)),
      join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    // Start a standalone runner; the enclosing node:test process sets this
    // internal flag, which otherwise changes how nested test results are emitted.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(
      process.execPath,
      [join(directory, "check-controls.mjs")],
      {
        env,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    assert.ifError(run.error);
    assert.equal(run.signal, null);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    for (const name of ["pairing", "linear", "dleq"]) {
      assert(
        run.stdout.includes(`${name}: removed check detected by`),
        `${name} control completed`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
