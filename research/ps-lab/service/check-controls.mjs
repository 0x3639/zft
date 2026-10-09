// Deliberately weakened disposable service copies must fail named assertions.
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
    name: "protected record loses caller context pin",
    file: "protected-record.mjs",
    suite: "protected-record.test.mjs",
    test: "protected record context substitution fails before unwrap",
    edits: [
      [
        '      if (p.canonical(value.scope) !== this.#context) throw fail("INPUT");',
        "",
      ],
    ],
  },
  {
    name: "protected record omits final authentication",
    file: "protected-record.mjs",
    suite: "protected-record.test.mjs",
    test: "protected record rejects tampered authenticated content",
    edits: [
      ["          last = cipher.final();", "          last = Buffer.alloc(0);"],
    ],
  },
  {
    name: "protected record ignores plaintext bound",
    file: "protected-record.mjs",
    suite: "protected-record.test.mjs",
    test: "protected record bounds inputs and rejects ambiguous encodings",
    edits: [
      [
        "plaintext = ownedBytes(input, 1, this.#limit);",
        "plaintext = ownedBytes(input, 1, this.#limit + 1);",
      ],
    ],
  },
  {
    name: "custody boundary omits monotonic deadline",
    file: "boundary.mjs",
    suite: "protected-record.test.mjs",
    test: "protected record monotonic deadline rejects a blocking late provider",
    edits: [
      [
        "const expired = () => performance.now() >= deadline;",
        "const expired = () => false;",
      ],
      [
        'const timer = setTimeout(() => finish("TIMEOUT"), this.#timeout);',
        'const timer = setTimeout(() => finish("TIMEOUT"), 60000);',
      ],
    ],
  },
  {
    name: "PS execution skips response equations",
    file: "executor.mjs",
    suite: "issuer.test.mjs",
    test: "service verifies request proof before custody and rejects incorrect response equations",
    edits: [
      [
        "bls.fields.Fp12.eql(bls.pairingBatch(nonzero), bls.fields.Fp12.ONE),",
        "true,",
      ],
    ],
  },
  {
    name: "async issuer omits commit expiry check",
    file: "issuer.mjs",
    suite: "issuer.test.mjs",
    test: "service rechecks expiry and admission generation after async custody",
    edits: [["now >= started && now < r.expires,", "true,"]],
  },
  {
    name: "async issuer ignores admission generation",
    file: "issuer.mjs",
    suite: "issuer.test.mjs",
    test: "service rechecks expiry and admission generation after async custody",
    edits: [
      [
        'assert.equal(policy.generation, generation, "admission changed");',
        'assert.equal(policy.generation, policy.generation, "admission changed");',
      ],
    ],
  },
  {
    name: "async status refreshes a saved observation time",
    file: "status.mjs",
    suite: "status.test.mjs",
    test: "async status denied signing preserves snapshot for explicit retry",
    edits: [
      [
        "const body = this.#body(saved.body, r),",
        "const body = {...this.#body(saved.body, r), observed_at: this.#now()},",
      ],
    ],
  },
  {
    name: "async status trusts damaged cached signatures",
    file: "status.mjs",
    suite: "status.test.mjs",
    test: "async status validates saved snapshot and cached signature before reuse",
    edits: [
      [
        "verify(null, framed(body), this.#publicKey, p.bytes(value.signature, 64)),",
        "true,",
      ],
    ],
  },
  {
    name: "backup omits selected archive digest",
    file: "backup.mjs",
    suite: "runtime.test.mjs",
    test: "backup and restore reject selected digest/sequence changes and denied unwrap without ready marker",
    edits: [
      [
        'assert.equal(p.hash(bytes), selection.sha256, "selected backup digest");',
        "",
      ],
    ],
  },
  {
    name: "restored database loses mandatory review gate",
    file: "backup.mjs",
    suite: "runtime.test.mjs",
    test: "stopped encrypted backup restores exact responses and remains suspended pending explicit review",
    edits: [
      [
        "UPDATE policy SET enabled=0,restore_required=1,generation=generation+1 WHERE id=1",
        "UPDATE policy SET enabled=0,restore_required=0,generation=generation+1 WHERE id=1",
      ],
    ],
  },
  {
    name: "admission accepts another role",
    file: "admission.mjs",
    suite: "http.test.mjs",
    test: "HTTP rejects missing wrong-role revoked and expired grants before custody",
    edits: [["r.role === role &&", ""]],
  },
  {
    name: "HTTP accepts foreign origin",
    file: "http.mjs",
    suite: "http.test.mjs",
    test: "HTTP requires exact host origin path method and refuses duplicate or proxy headers",
    edits: [['assert.equal(headers.get("origin"), origin, "origin");', ""]],
  },
  {
    name: "HTTP accepts foreign Host",
    file: "http.mjs",
    suite: "http.test.mjs",
    test: "HTTP requires exact host origin path method and refuses duplicate or proxy headers",
    edits: [['assert.equal(headers.get("host"), url.host, "host");', ""]],
  },
  {
    name: "HTTP omits commit-time revocation guard",
    file: "http.mjs",
    suite: "http.test.mjs",
    test: "HTTP rechecks revoked grants before delayed custody can commit",
    edits: [
      [
        "const options = { signal: abort.signal, authorize: guard };",
        "const options = { signal: abort.signal, authorize: () => {} };",
      ],
    ],
  },
  {
    name: "retention deletes active grants",
    file: "admission.mjs",
    suite: "http.test.mjs",
    test: "retention removes only explicitly selected expired grants and preserves durable evidence",
    edits: [
      [
        'db.prepare("DELETE FROM grants WHERE revoked=1 OR expires<=?").run(now);',
        'db.prepare("DELETE FROM grants").run();',
      ],
    ],
  },
];
for (const control of controls) {
  const dir = mkdtempSync(join(tmpdir(), "zft-service-controls-"));
  try {
    for (const name of ["service", "local", "web", "licenses"])
      cpSync(join(lab, name), join(dir, name), { recursive: true });
    for (const name of ["verify.mjs", "vectors.json"])
      cpSync(join(lab, name), join(dir, name));
    symlinkSync(join(lab, "node_modules"), join(dir, "node_modules"), "dir");
    const file = join(dir, "service", control.file);
    let source = readFileSync(file, "utf8");
    for (const [before, after] of control.edits) {
      assert.equal(
        source.split(before).length,
        2,
        "unique mutation: " + control.name,
      );
      source = source.replace(before, after);
    }
    writeFileSync(file, source);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-sqlite",
        "--test",
        "--test-reporter=tap",
        "--test-name-pattern=^" + control.test + "$",
        join(dir, "service", control.suite),
      ],
      { env, encoding: "utf8", timeout: 45000, maxBuffer: 2 * 1024 * 1024 },
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null);
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
