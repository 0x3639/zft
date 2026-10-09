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
    name: "missing persistent registry silently recreated",
    file: "persistent.mjs",
    suite: "persistent.test.mjs",
    test: "persistent startup rejects missing database instead of silently creating a fresh registry",
    edits: [["for (const f of FILES)", "for (const f of [])"]],
  },
  {
    name: "unsafe persistent key permissions accepted",
    file: "persistent.mjs",
    suite: "persistent.test.mjs",
    test: "persistent startup rejects unsafe permissions symlinks and changed private trust",
    edits: [["        (s.mode & 0o077) === 0 &&", ""]],
  },
  {
    name: "persistent process lock bypassed",
    file: "persistent.mjs",
    suite: "persistent.test.mjs",
    test: "persistent exclusive ownership rejects a second server and refuses to steal a live lock",
    edits: [
      [
        'import assert from "node:assert/strict";',
        'import assert from "node:assert/strict";\nimport {existsSync} from "node:fs";',
      ],
      [
        "this.lock = acquire(dir);",
        "this.lock = existsSync(join(dir, 'run.lock')) ? readPrivate(join(dir, 'run.lock')) : acquire(dir);",
      ],
    ],
  },
  {
    name: "committed public receipt discarded",
    file: "persistent-public.mjs",
    suite: "persistent.test.mjs",
    test: "persistent observation returns the committed receipt after interruption before API return",
    edits: [["receipt: r.receipt,", "receipt: null,"]],
  },
  {
    name: "persistent operation admission skipped",
    file: "persistent-api.mjs",
    suite: "persistent.test.mjs",
    test: "persistent operation cap rejects new work while exact authorized response remains recoverable",
    edits: [
      [
        '      assert(\n        this.issuer.counts().operations < LIMITS.operations,\n        "local operation cap",\n      );',
        "",
      ],
      [
        '    assert(\n      this.issuer.counts().operations < LIMITS.operations,\n      "local operation cap",\n    );',
        "",
      ],
    ],
  },

  {
    name: "public image loses signed asset binding",
    file: "presentation.mjs",
    suite: "presentation.test.mjs",
    test: "public evidence rejects cross-asset images even with a fresh valid wallet signature",
    edits: [
      [
        '  assert.equal(p.assetValue(image.image, ps), c.h, "presentation signed asset");',
        "",
      ],
    ],
  },
  {
    name: "public receipt signature skipped",
    file: "presentation.mjs",
    suite: "presentation.test.mjs",
    test: "public evidence rejects every substituted scope, context, signed body and proof field",
    edits: [["    ed25519.verify(", "    true || ed25519.verify("]],
  },
  {
    name: "wallet endorsement skipped",
    file: "presentation.mjs",
    suite: "presentation.test.mjs",
    test: "public evidence verifies the exact ERC-191 endorsement independently of credential validity",
    edits: [
      [
        "walletSigningKeyValid = verifyEndorsement(",
        "walletSigningKeyValid = true || verifyEndorsement(",
      ],
    ],
  },
  {
    name: "expired evidence published",
    file: "presentation.mjs",
    suite: "presentation.test.mjs",
    test: "public evidence distinguishes anonymous credential proof from wallet signing key and expiry",
    edits: [
      ['  if (requireFresh) assert(inInterval, "presentation expired");', ""],
    ],
  },
  {
    name: "public origin replaced",
    file: "presentation.mjs",
    suite: "presentation.test.mjs",
    test: "caller pins cannot be replaced by an imported public record",
    edits: [
      ['  assert.equal(v.origin, expectedOrigin, "presentation origin");', ""],
    ],
  },

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
  {
    name: "partially committed client replacement",
    file: "client.mjs",
    suite: "recovery.test.mjs",
    test: "SIGKILL after-credential-insert keeps client replacement atomic",
    edits: [
      [
        '      this.boundary("after-credential-insert");',
        '      this.db.exec("COMMIT; BEGIN IMMEDIATE");\n      this.boundary("after-credential-insert");',
      ],
    ],
  },
  {
    name: "pending snapshot acknowledged before backup",
    file: "client.mjs",
    suite: "recovery.test.mjs",
    test: "SIGKILL after-pending-save never submits an unacknowledged request",
    edits: [
      [
        "acknowledged INTEGER NOT NULL DEFAULT 0",
        "acknowledged INTEGER NOT NULL DEFAULT 1",
      ],
    ],
  },
  {
    name: "client source spend survives failed completion",
    file: "client.mjs",
    suite: "recovery.test.mjs",
    test: "SQLITE_FULL at client completion rolls back credential and source writes",
    edits: [
      [
        '      this.boundary("after-source-spent");',
        '      this.db.exec("COMMIT; BEGIN IMMEDIATE");\n      this.boundary("after-source-spent");',
      ],
    ],
  },
  {
    name: "completed recovery revives a spent credential",
    file: "client.mjs",
    suite: "recovery.test.mjs",
    test: "replaying completed recovery cannot revive a subsequently spent credential",
    edits: [
      [
        '      if (old) assert.equal(old.envelope, envelope, "conflicting credential");',
        '      if (old) { assert.equal(old.envelope, envelope, "conflicting credential"); this.db.prepare("UPDATE credentials SET spent=0 WHERE id=?").run(id); }',
      ],
    ],
  },
  {
    name: "unsigned state accepted",
    file: "state.mjs",
    suite: "state.test.mjs",
    test: "state signature tampering is rejected without consuming the challenge",
    edits: [
      [
        '    assert(\n      verify(\n        null,\n        framed("receipt", body),\n        this.pinned.publicKey,\n        bytes(signature),\n      ),\n      "state signature",\n    );\n',
        "",
      ],
    ],
  },
  {
    name: "state audience omitted from showing challenge",
    file: "state.mjs",
    suite: "state.test.mjs",
    test: "state showing challenge binds audience and every request context field",
    edits: [
      [
        '  return hash(framed("show", c));',
        '  const { audience, ...rest } = c;\n  return hash(framed("show", rest));',
      ],
    ],
  },
  {
    name: "state challenge reused",
    file: "state.mjs",
    suite: "state.test.mjs",
    test: "state response cannot be replayed after observer restart",
    edits: [
      [
        "UPDATE challenges SET consumed=1,receipt=? WHERE id=?",
        "UPDATE challenges SET consumed=0,receipt=? WHERE id=?",
      ],
    ],
  },
  {
    name: "observer sequence regresses",
    file: "state.mjs",
    suite: "state.test.mjs",
    test: "delayed state receipt cannot lower a newer accepted sequence",
    edits: [
      [
        '      assert(\n        body.sequence >= Math.max(c.min_sequence, this.clock().sequence),\n        "state sequence rollback",\n      );\n',
        "",
      ],
    ],
  },
  {
    name: "observation watermark committed without consumption",
    file: "state.mjs",
    suite: "state.test.mjs",
    test: "state acceptance watermark and challenge consumption commit atomically",
    edits: [
      [
        '      this.boundary("after-state-watermark");',
        '      this.db.exec("COMMIT; BEGIN IMMEDIATE");\n      this.boundary("after-state-watermark");',
      ],
    ],
  },
  {
    name: "expired state accepted",
    file: "state.mjs",
    suite: "state.test.mjs",
    test: "state challenge rejects receipt outside its lifetime at offset 60",
    edits: [
      [
        '  assert(\n    now >= c.created_at && now < c.expires_at,\n    "state challenge expired or clock behind",\n  );',
        "",
      ],
    ],
  },
  {
    name: "observer challenge committed without clock",
    file: "state.mjs",
    suite: "state-recovery.test.mjs",
    test: "SQLITE_FULL during preparation clock update rolls back the challenge",
    edits: [
      [
        '      this.boundary("after-state-challenge-insert");',
        '      this.db.exec("COMMIT; BEGIN IMMEDIATE");\n      this.boundary("after-state-challenge-insert");',
      ],
    ],
  },
  {
    name: "observer request committed without clock",
    file: "state.mjs",
    suite: "state-recovery.test.mjs",
    test: "SQLITE_FULL during request clock update rolls back the exact wire",
    edits: [
      [
        '      this.boundary("after-state-request-write");',
        '      this.db.exec("COMMIT; BEGIN IMMEDIATE");\n      this.boundary("after-state-request-write");',
      ],
    ],
  },
  {
    name: "observer failed commit leaves transaction open",
    file: "store.mjs",
    suite: "state-recovery.test.mjs",
    test: "SQLITE_BUSY at observer COMMIT rolls back receipt and replay memory",
    edits: [
      ['      db.exec("ROLLBACK");', "      /* deliberately omit rollback */"],
    ],
  },
  {
    name: "noncanonical wire accepted",
    file: "profile.mjs",
    suite: "parser.test.mjs",
    test: "parser corpus rejects malformed issue requests without issuer mutation",
    edits: [
      [
        '  assert.equal(\n    canonical(v),\n    wire,\n    "canonical JSON; no duplicate keys or alternate encoding",\n  );',
        "",
      ],
    ],
  },
  {
    name: "wire limit counts characters instead of bytes",
    file: "profile.mjs",
    suite: "parser.test.mjs",
    test: "parser limits count UTF-8 bytes at each local wire boundary",
    edits: [["Buffer.byteLength(wire) <= limit", "wire.length <= limit"]],
  },
  {
    name: "unexpected bearer fields accepted",
    file: "profile.mjs",
    suite: "parser.test.mjs",
    test: "parser corpus rejects malformed bearer files without creating pending claims",
    edits: [
      [
        '  assert.deepEqual(\n    Object.keys(v).sort(),\n    names.split(" ").sort(),\n    "exact fields",\n  );',
        "",
      ],
    ],
  },
  {
    name: "unbounded canonical JSON depth",
    file: "profile.mjs",
    suite: "parser.test.mjs",
    test: "parser canonical boundaries reject deep objects and alternate numeric encodings",
    edits: [['  assert(depth < 8, "JSON depth");', ""]],
  },
  {
    name: "PNG checksum bypassed",
    file: "png.mjs",
    suite: "image.test.mjs",
    test: "PNG CRC errors and truncated or trailing containers reject",
    edits: [
      [
        '    assert.equal(\n      crc32(raw.subarray(4, -4)),\n      raw.readUInt32BE(raw.length - 4),\n      "PNG CRC",\n    );',
        "",
      ],
    ],
  },
  {
    name: "PNG compressed trailing bytes accepted",
    file: "png.mjs",
    suite: "image.test.mjs",
    test: "PNG rejects trailing deflate bytes and concatenated streams",
    edits: [
      [
        '  assert.equal(\n    inflated.engine.bytesWritten,\n    compressed.length,\n    "PNG zlib trailing bytes",\n  );',
        "",
      ],
    ],
  },
  {
    name: "PS PNG asset binding removed",
    file: "profile.mjs",
    suite: "image.test.mjs",
    test: "PS PNG image substitution rejects even with a recomputed full digest",
    edits: [
      [
        '  assert.equal(\n    assetValue(bytes(v.asset), pinned),\n    v.credential.h,\n    "asset binding",\n  );',
        "",
      ],
    ],
  },
  {
    name: "PS PNG public copy leaks bearer",
    file: "image.mjs",
    suite: "image.test.mjs",
    test: "public PNG export removes all envelope authority",
    edits: [
      [
        "  return importImage(file, manifest).image;",
        "  importImage(file, manifest);\n  return Buffer.from(file);",
      ],
    ],
  },
  {
    name: "PS PNG duplicate envelope silently selected",
    file: "image.mjs",
    suite: "image.test.mjs",
    test: "PS PNG rejects duplicate envelopes",
    edits: [
      [
        "    envelopes = chunks.filter((c) => c.type === BEARER_CHUNK);",
        "    envelopes = chunks.filter((c) => c.type === BEARER_CHUNK).slice(-1);",
      ],
    ],
  },
  {
    name: "PS PNG full digest mismatch ignored",
    file: "image.mjs",
    suite: "image.test.mjs",
    test: "PS PNG rejects altered full image digest",
    edits: [
      [
        '  assert.equal(p.hash(image), body.image_sha256, "PNG image digest");',
        "",
      ],
    ],
  },
  {
    name: "PNG issuance leaves no envelope space",
    file: "png.mjs",
    suite: "image.test.mjs",
    test: "maximum PNG chunk budget remains exportable before issuance",
    edits: [
      ['  assert(chunks.length < CHUNK_LIMIT, "PNG image chunk count");', ""],
    ],
  },
  {
    name: "vault authentication finalization skipped",
    file: "vault.mjs",
    suite: "vault.test.mjs",
    test: "vault authentication rejects wrong passwords and modified tags before returning records",
    edits: [
      [
        "      final = decipher.final(); // Authenticate before decoding or exposing any plaintext.",
        "      final = Buffer.alloc(0);",
      ],
    ],
  },
  {
    name: "vault authenticated header omitted",
    file: "vault.mjs",
    suite: "vault.test.mjs",
    test: "vault GCM payload is verified through WebCrypto with exact header AAD",
    edits: [
      ["      cipher.setAAD(Buffer.from(p.canonical(h)));", ""],
      ["      decipher.setAAD(Buffer.from(h.aad));", ""],
    ],
  },
  {
    name: "vault pinned manifest ignored",
    file: "vault.mjs",
    suite: "vault.test.mjs",
    test: "vault binds caller-pinned complete manifest and vault identity",
    edits: [
      [
        '  assert.equal(\n    p.canonical(v.manifest),\n    p.canonical(pinned.manifest),\n    "vault content manifest",\n  );',
        "",
      ],
      [
        '  assert.equal(\n    p.canonical(v.manifest),\n    p.canonical(pinned.manifest),\n    "pinned vault manifest",\n  );',
        "",
      ],
    ],
  },
  {
    name: "vault lock retains readable records",
    file: "vault.mjs",
    suite: "vault.test.mjs",
    test: "vault lock blocks every plaintext or sealing operation",
    edits: [["    this.#records = null;", "    // broken lock"]],
  },
  {
    name: "vault acknowledges before encrypted readback",
    file: "vault.mjs",
    suite: "vault.test.mjs",
    test: "vault recovery acknowledgment requires the exact encrypted file readback",
    edits: [
      [
        "  expectedId,\n) {\n  const vault = LocalVault.open(",
        "  expectedId,\n) {\n  client.acknowledge(digest, p.hash(client.backup(digest)));\n  const vault = LocalVault.open(",
      ],
    ],
  },
  {
    name: "vault decrypted records skip protocol validation",
    file: "vault.mjs",
    suite: "vault.test.mjs",
    test: "vault rejects authenticated malformed content and every invalid record before opening",
    edits: [
      [
        "    const entry = record(value, pinned);",
        "    const entry = { ...value };",
      ],
    ],
  },
  {
    name: "vault KDF cost weakened",
    file: "vault.mjs",
    suite: "vault.test.mjs",
    test: "vault GCM payload is verified through WebCrypto with exact header AAD",
    edits: [["      N: 32768,", "      N: 16384,"]],
  },
  {
    name: "browser foreign origin accepted",
    file: "browser-server.mjs",
    suite: "browser.test.mjs",
    test: "browser HTTP rejects foreign origins and missing launch capabilities",
    edits: [["req.headers.origin !== origin ||", "false ||"]],
  },
  {
    name: "browser wrong launch capability accepted",
    file: "browser-server.mjs",
    suite: "browser.test.mjs",
    test: "browser HTTP rejects foreign origins and missing launch capabilities",
    edits: [["Buffer.from(token),", "Buffer.from(authorization.slice(7)),"]],
  },
  {
    name: "browser acknowledges before encrypted reselection",
    file: "browser-lab.mjs",
    suite: "browser.test.mjs",
    test: "browser recovery reselection gates submission and restores a lost response",
    edits: [
      [
        "      const opened = LocalVault.open(",
        '      if (a === "acknowledge") c.acknowledge(input.digest, p.hash(c.backup(input.digest)));\n      const opened = LocalVault.open(',
      ],
    ],
  },
  {
    name: "browser public export includes bearer authority",
    file: "browser-lab.mjs",
    suite: "browser.test.mjs",
    test: "browser recovery reselection gates submission and restores a lost response",
    edits: [
      [
        "? p.bytes(p.importBearer(envelope, c.pinned).asset)",
        "? exportImage(envelope, this.manifest)",
      ],
    ],
  },
  {
    name: "browser state leaks recovery snapshot",
    file: "browser-lab.mjs",
    suite: "browser.test.mjs",
    test: "browser state excludes private snapshots credentials and capabilities",
    edits: [["          ...op,", "          ...op, snapshot: row.snapshot,"]],
  },
  {
    name: "web vault KDF cost weakened",
    file: "../web/vault.mjs",
    suite: "web-vault.test.mjs",
    test: "web vault scrypt agrees with Node at the fixed profile cost",
    edits: [["      N: 32768,", "      N: 16384,"]],
  },
  {
    name: "web vault adopts file trust",
    file: "../web/vault.mjs",
    suite: "web-vault.test.mjs",
    test: "web vault pins complete manifest and vault identity",
    edits: [
      [
        "const pinned = p.trust(manifest),",
        "const pinned = p.trust(JSON.parse(wire).manifest),",
      ],
    ],
  },
  {
    name: "web vault skips decrypted record validation",
    file: "../web/vault.mjs",
    suite: "web-vault.test.mjs",
    test: "web vault rejects authenticated invalid records after decrypt",
    edits: [
      [
        "const records = s.validateContent(",
        "const records = ((wire) => JSON.parse(wire).records)(",
      ],
    ],
  },
  {
    name: "web vault seal returns after lock",
    file: "../web/vault.mjs",
    suite: "web-vault.test.mjs",
    test: "web vault explicit lock prevents access and an in-flight seal",
    edits: [
      [
        '      this.#open();\n      assert.equal(epoch, this.#epoch, "vault changed");\n      const imported',
        "      const imported",
      ],
      [
        '      this.#open();\n      assert.equal(epoch, this.#epoch, "vault changed");\n      const wire',
        "      const wire",
      ],
    ],
  },
  {
    name: "web worker revives after lock",
    file: "../web/worker.mjs",
    suite: "web-vault.test.mjs",
    test: "web vault worker lock invalidates an asynchronous open",
    edits: [
      [
        '      if (started !== epoch) throw new Error("locked during open");',
        "",
      ],
      [
        '    if (started !== epoch) throw new Error("locked during operation");',
        "",
      ],
    ],
  },
  {
    name: "browser client skips backup gate",
    file: "../web/client.mjs",
    suite: "web-client.test.mjs",
    test: "browser client requires persisted exact recovery reselection before any submission",
    edits: [
      [
        '    assert(row.acknowledged, "recovery file required");\n    const v = snapshot(row.snapshot, this.#pinned);',
        "    const v = snapshot(row.snapshot, this.#pinned);",
      ],
    ],
  },
  {
    name: "browser client publishes state before commit",
    file: "../web/client.mjs",
    suite: "web-client.test.mjs",
    test: "browser client aborted preparation never exposes a pending request",
    edits: [
      [
        "    const revision = await this.#persist(wire, this.#revision);",
        "    this.#state = next;\n    const revision = await this.#persist(wire, this.#revision);",
      ],
    ],
  },
  {
    name: "browser client replay revives spent authority",
    file: "../web/client.mjs",
    suite: "web-client.test.mjs",
    test: "browser client replayed recovery never revives a locally spent credential",
    edits: [
      [
        "    if (v.source && next.credentials[credentialId(v.source)])",
        "    next.credentials[id].spent = false;\n    if (v.source && next.credentials[credentialId(v.source)])",
      ],
    ],
  },
  {
    name: "browser client delayed commit reopens after lock",
    file: "../web/client.mjs",
    suite: "web-client.test.mjs",
    test: "browser client lock after persistence starts cannot reopen completed ciphertext",
    edits: [
      [
        '    assert(this.#state && epoch === this.#epoch, "client locked");',
        '    assert(true, "client locked");',
      ],
    ],
  },
  {
    name: "browser client status exposes pending authority",
    file: "../web/client.mjs",
    suite: "web-client.test.mjs",
    test: "browser client summaries and encrypted storage do not expose authority",
    edits: [
      [
        "      clientId: this.#state.client_id,",
        "      clientId: this.#state.client_id,\n      raw: this.#state.operations,",
      ],
    ],
  },
  {
    name: "browser client adopts decrypted identity",
    file: "../web/client.mjs",
    suite: "web-client.test.mjs",
    test: "browser client authenticated journal cannot replace inner trust or identity",
    edits: [
      [
        "      validate(\n        await openState(wire, password, manifest, id),\n        p.trust(manifest),\n        id,\n      ),",
        "      await openState(wire, password, manifest, id),",
      ],
    ],
  },
  {
    name: "browser client forgets completed source during out-of-order recovery",
    file: "../web/client.mjs",
    suite: "web-client.test.mjs",
    test: "browser client restores cancel and mint recoveries in either order",
    edits: [
      [
        "      next.credentials[id] = { wire, spent };",
        "      next.credentials[id] = { wire, spent: false };",
      ],
    ],
  },
  {
    name: "browser PNG skips CRC",
    file: "../web/png.mjs",
    suite: "web-image.test.mjs",
    test: "browser PNG rejects CRC corruption before inflation",
    edits: [["crc32(raw.subarray(4, -4)),", "u32(raw, raw.length - 4),"]],
  },
  {
    name: "browser PNG accepts permissive decoder",
    file: "../web/png.mjs",
    suite: "web-image.test.mjs",
    test: "browser PNG decoder refuses permissive runtime before accepting images",
    edits: [
      [
        '        rejected,\n        "PNG decoder must reject incomplete or trailing zlib input",',
        '        true,\n        "PNG decoder must reject incomplete or trailing zlib input",',
      ],
    ],
  },
  {
    name: "browser preview exposes private envelope",
    file: "../web/client.mjs",
    suite: "web-image.test.mjs",
    test: "browser artwork preview is exact public bytes and private export is explicit",
    edits: [["    const bytes = privateFile", "    const bytes = true"]],
  },
  {
    name: "browser image issuance skips PNG validation",
    file: "../web/client.mjs",
    suite: "web-image.test.mjs",
    test: "browser malformed artwork never writes pending state",
    edits: [
      [
        "      value = await inspectImage(bytes);",
        "      value = {image: bytes};",
      ],
    ],
  },
  {
    name: "browser generated envelope skips full image digest",
    file: "image.mjs",
    suite: "web-image.test.mjs",
    test: "browser PNG checks full digest and signed asset after image substitution",
    edits: [
      [
        '  assert.equal(p.hash(image), body.image_sha256, "PNG image digest");',
        "  // Deliberately disabled image digest.",
      ],
    ],
  },
  {
    name: "browser generated envelope skips signed asset binding",
    file: "image.mjs",
    suite: "web-image.test.mjs",
    test: "browser PNG checks full digest and signed asset after image substitution",
    edits: [
      [
        "  p.importBearer(envelope, p.trust(manifest));\n  return { image, envelope, image_sha256, width, height };",
        "  return { image, envelope, image_sha256, width, height };",
      ],
    ],
  },
];
for (const control of controls) {
  const dir = mkdtempSync(join(tmpdir(), "zft PS controls ü # "));
  try {
    cpSync(join(lab, "local"), join(dir, "local"), { recursive: true });
    cpSync(join(lab, "web"), join(dir, "web"), { recursive: true });
    cpSync(join(lab, "licenses"), join(dir, "licenses"), { recursive: true });
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
        join(dir, "local", control.suite ?? "engine.test.mjs"),
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
