// Deliberately broken copies must fail specific state-machine regressions.
import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const lab = fileURLToPath(new URL("../", import.meta.url));
const controls = [
  {
    name: "unbound recovery capability",
    file: "profile.mjs",
    test: "recovery capability substitution invalidates the proof",
    edits: [
      [
        "  delete core.proof;",
        "  delete core.proof;\n  delete core.recovery_hash;",
      ],
    ],
  },
  {
    name: "repeat nullifier accepted",
    file: "issuer.mjs",
    test: "two processes racing the same bearer commit exactly one replacement",
    edits: [
      [
        `        assert(
          !this.db
            .prepare("SELECT 1 FROM spent WHERE keyset=? AND nullifier=?")
            .get(r.keyset_id, nullifier),
          "already spent",
        );`,
        "",
      ],
      ["INSERT INTO spent VALUES", "INSERT OR IGNORE INTO spent VALUES"],
    ],
  },
  {
    name: "spend committed without response",
    file: "issuer.mjs",
    test: "SIGKILL before-commit preserves atomic spend and response recovery",
    edits: [
      [
        '      this.boundary("before-commit");',
        '      this.db.exec("COMMIT; BEGIN IMMEDIATE");\n      this.boundary("before-commit");',
      ],
    ],
  },
  {
    name: "unscoped credential attribute",
    file: "profile.mjs",
    test: "a bearer cannot be relabeled into another realm even with the same issuer key",
    edits: [
      [
        "const context = utf8(canonical({ protocol, realm, keyset_id }));",
        "const context = new Uint8Array();",
      ],
    ],
  },
];
for (const control of controls) {
  const dir = mkdtempSync(join(tmpdir(), "zft PS controls ü # "));
  try {
    cpSync(join(lab, "local"), join(dir, "local"), { recursive: true });
    for (const file of ["verify.mjs", "vectors.json"])
      cpSync(join(lab, file), join(dir, file));
    symlinkSync(join(lab, "node_modules"), join(dir, "node_modules"), "dir");
    const path = join(dir, "local", control.file);
    let source = readFileSync(path, "utf8");
    for (const [before, after] of control.edits) {
      assert.equal(
        source.split(before).length,
        2,
        "unique mutation anchor: " + control.name,
      );
      source = source.replace(before, after);
    }
    writeFileSync(path, source);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-sqlite",
        "--test",
        "--test-reporter=tap",
        "--test-name-pattern=^" + control.test + "$",
        join(dir, "local/engine.test.mjs"),
      ],
      { env, encoding: "utf8", timeout: 45000, maxBuffer: 2 * 1024 * 1024 },
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, "control suite completed");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert(
      result.stdout.includes("not ok 1 - " + control.test),
      result.stdout + result.stderr,
    );
    assert(
      result.stdout.includes("code: 'ERR_ASSERTION'"),
      result.stdout + result.stderr,
    );
    console.log("Detected: " + control.name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
