import assert from "node:assert/strict";
import { test } from "node:test";
import {
  scryptSync,
  createCipheriv,
  createDecipheriv,
  webcrypto,
} from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import * as p from "./profile.mjs";
import { fixture, pending, secrets } from "./test-support.mjs";
import {
  exportImage,
  importImage,
  publicImage,
  prepareImageIssue,
  prepareImageClaim,
} from "./image.mjs";
import {
  LocalVault,
  recordId,
  FORMAT,
  CONTENT,
  KDF,
  CIPHER,
  MAX_RECORDS,
  MAX_CLEAR,
  MAX_FILE,
  writeVaultFile,
  readVaultFile,
  acknowledgeRecoveryFile,
  restoreRecoveryFile,
} from "./vault.mjs";
const password = "public test password only ü #";
const png = Buffer.from(
  JSON.parse(readFileSync(new URL("./image-fixtures.json", import.meta.url)))
    .images[0].pngHex,
  "hex",
);
function setup(t) {
  const f = fixture(t),
    manifest = f.a.pinned.manifest,
    vault = new LocalVault(manifest);
  const d = prepareImageIssue(f.a, f.issuer.session("issue"), png),
    snapshot = f.a.backup(d);
  return { ...f, manifest, vault, d, snapshot };
}
function empty(t) {
  const f = fixture(t);
  return {
    ...f,
    manifest: f.a.pinned.manifest,
    vault: new LocalVault(f.a.pinned.manifest),
  };
}
function rows(c) {
  return c.db.prepare("SELECT * FROM pending ORDER BY digest").all();
}
function parse(wire) {
  return p.parse(wire, MAX_FILE);
}
function changed(wire, fn) {
  const v = parse(wire);
  fn(v);
  return p.canonical(v);
}
const flip = (s) => (s[0] === "0" ? "1" : "0") + s.slice(1);
function rawClear(wire) {
  const v = parse(wire),
    { ciphertext, tag, ...h } = v;
  const key = scryptSync(password, Buffer.from(v.salt, "hex"), 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 67108864,
  });
  const d = createDecipheriv(CIPHER, key, Buffer.from(v.iv, "hex"), {
    authTagLength: 16,
  });
  d.setAAD(Buffer.from(p.canonical(h)));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(ciphertext, "hex")), d.final()]);
}
// Test-only authenticated malformed content, authored with the public test password.
function reencrypt(wire, clear, headerChange = () => {}) {
  const v = parse(wire),
    { ciphertext, tag, ...h } = v;
  headerChange(h);
  const key = scryptSync(password, Buffer.from(h.salt, "hex"), 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 67108864,
  });
  const c = createCipheriv(CIPHER, key, Buffer.from(h.iv, "hex"), {
    authTagLength: 16,
  });
  c.setAAD(Buffer.from(p.canonical(h)));
  return p.canonical({
    ...h,
    ciphertext: Buffer.concat([c.update(clear), c.final()]).toString("hex"),
    tag: c.getAuthTag().toString("hex"),
  });
}
test("vault scrypt matches RFC 7914 section 12 vector", () => {
  assert.equal(
    scryptSync("password", "NaCl", 64, { N: 1024, r: 8, p: 16 }).toString(
      "hex",
    ),
    "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
  );
});
test("vault GCM payload is verified through WebCrypto with exact header AAD", async (t) => {
  const f = setup(t);
  f.vault.add("recovery", f.snapshot);
  const wire = f.vault.seal(password),
    v = parse(wire),
    { ciphertext, tag, ...h } = v;
  const key = scryptSync(password, Buffer.from(v.salt, "hex"), 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 67108864,
  });
  const imported = await webcrypto.subtle.importKey(
    "raw",
    key,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  let got;
  await assert.doesNotReject(async () => {
    got = await webcrypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Buffer.from(v.iv, "hex"),
        additionalData: Buffer.from(p.canonical(h)),
        tagLength: 128,
      },
      imported,
      Buffer.from(ciphertext + tag, "hex"),
    );
  });
  const clear = p.parse(Buffer.from(got).toString(), MAX_CLEAR);
  assert.equal(
    clear.records[recordId("recovery", f.snapshot)].wire,
    f.snapshot,
  );
  assert.equal(clear.vault_id, f.vault.id);
  assert.equal(clear.format, CONTENT);
});
test("vault opens exact typed records while ciphertext omits bearer secrets", (t) => {
  const f = setup(t),
    r = f.vault.add("recovery", f.snapshot);
  f.acknowledge(f.a, f.d);
  const id = f.a.submit(f.d, f.issuer),
    bearer = f.a.export(id),
    b = f.vault.add("bearer", bearer);
  const wire = f.vault.seal(password);
  for (const secret of [
    pending(f.a, f.d).secret,
    pending(f.a, f.d).capability,
    bearer,
    f.snapshot,
  ])
    assert(!wire.includes(secret));
  const opened = LocalVault.open(wire, password, f.manifest, f.vault.id);
  assert.equal(opened.read(r).wire, f.snapshot);
  assert.equal(opened.read(b).wire, bearer);
  assert.deepEqual(
    publicImage(exportImage(opened.read(b).wire, f.manifest), f.manifest),
    png,
  );
  const copy = opened.read(r);
  copy.wire = "changed";
  assert.equal(opened.read(r).wire, f.snapshot);
  assert.equal(opened.add("recovery", f.snapshot), r);
  assert.equal(opened.list().length, 2);
});
test("vault exports fresh salt and nonce for each sealing", (t) => {
  const f = empty(t),
    a = parse(f.vault.seal(password)),
    b = parse(f.vault.seal(password));
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(a.vault_id, b.vault_id);
});
test("vault lock blocks every plaintext or sealing operation", (t) => {
  const f = setup(t),
    id = f.vault.add("recovery", f.snapshot),
    wire = f.vault.seal(password);
  f.vault.lock();
  f.vault.lock();
  assert(f.vault.locked);
  for (const fn of [
    () => f.vault.read(id),
    () => f.vault.list(),
    () => f.vault.add("recovery", f.snapshot),
    () => f.vault.seal(password),
  ])
    assert.throws(fn, /vault locked/);
  assert.equal(
    LocalVault.open(wire, password, f.manifest, f.vault.id).read(id).wire,
    f.snapshot,
  );
});
test("vault authentication rejects wrong passwords and modified tags before returning records", (t) => {
  const f = setup(t);
  f.vault.add("recovery", f.snapshot);
  const wire = f.vault.seal(password);
  assert.throws(() =>
    LocalVault.open(
      wire,
      "another public test password",
      f.manifest,
      f.vault.id,
    ),
  );
  assert.throws(() =>
    LocalVault.open(
      changed(wire, (v) => (v.tag = flip(v.tag))),
      password,
      f.manifest,
      f.vault.id,
    ),
  );
  assert.equal(f.vault.list().length, 1);
});
test("vault rejects authenticated-header and ciphertext tampering", (t) => {
  const f = empty(t),
    wire = f.vault.seal(password);
  for (const field of ["salt", "iv", "ciphertext"])
    assert.throws(() =>
      LocalVault.open(
        changed(wire, (v) => (v[field] = flip(v[field]))),
        password,
        f.manifest,
        f.vault.id,
      ),
    );
});
test("vault binds caller-pinned complete manifest and vault identity", (t) => {
  const f = empty(t),
    wire = f.vault.seal(password),
    foreign = p.manifest("72".repeat(32), secrets);
  assert.throws(
    () => LocalVault.open(wire, password, foreign, f.vault.id),
    /manifest/,
  );
  assert.throws(
    () => LocalVault.open(wire, password, f.manifest, "00".repeat(16)),
    /identity/,
  );
  const other = new LocalVault(f.manifest).seal(password);
  assert.throws(
    () => LocalVault.open(other, password, f.manifest, f.vault.id),
    /identity/,
  );
  const forged = changed(wire, (v) => (v.manifest = foreign));
  assert.throws(() => LocalVault.open(forged, password, foreign, f.vault.id));
});
test("vault rejects alternate versions algorithms encodings and hostile KDF parameters", (t) => {
  const f = empty(t),
    wire = f.vault.seal(password);
  for (const change of [
    (v) => (v.format = "zft-vault/1"),
    (v) => (v.kdf = "scrypt-n1073741824-r8-p1"),
    (v) => (v.kdf = { N: 1 }),
    (v) => (v.cipher = "aes-256-cbc"),
    (v) => (v.extra = true),
    (v) => (v.tag = v.tag.slice(2)),
    (v) => (v.iv = "AA" + v.iv.slice(2)),
    (v) => (v.salt = "00"),
    (v) => (v.ciphertext = "z0"),
    (v) => (v.ciphertext = ""),
  ])
    assert.throws(() =>
      LocalVault.open(changed(wire, change), password, f.manifest, f.vault.id),
    );
  for (const bad of [
    " " + wire,
    wire + "\n",
    '{"format":"duplicate",' + wire.slice(1),
    "[]",
    "null",
    "x".repeat(MAX_FILE + 1),
  ])
    assert.throws(() => LocalVault.open(bad, password, f.manifest, f.vault.id));
});
test("vault password policy preserves exact Unicode and bounded byte input", (t) => {
  const f = empty(t);
  for (const bad of [
    "short",
    "x".repeat(1025),
    "é".repeat(513),
    "\ud800".repeat(12),
    null,
  ])
    assert.throws(() => f.vault.seal(bad), /password/);
  for (const good of ["é".repeat(6), "x".repeat(1024)]) {
    const wire = f.vault.seal(good);
    assert.equal(
      LocalVault.open(wire, good, f.manifest, f.vault.id).list().length,
      0,
    );
  }
  const accented = "test password é",
    wire = f.vault.seal(accented);
  assert.throws(() =>
    LocalVault.open(wire, accented.normalize("NFD"), f.manifest, f.vault.id),
  );
});
test("vault invalid additions preserve all existing records", (t) => {
  const f = setup(t);
  f.vault.add("recovery", f.snapshot);
  const before = f.vault.list();
  for (const [kind, wire] of [
    ["bearer", f.snapshot],
    ["unknown", f.snapshot],
    ["recovery", f.snapshot + " "],
    [
      "recovery",
      p.canonical({
        ...p.parse(f.snapshot, 300000),
        capability: "00".repeat(32),
      }),
    ],
  ]) {
    assert.throws(() => f.vault.add(kind, wire));
    assert.deepEqual(f.vault.list(), before);
  }
});
test("vault refuses ninth record before mutating the record set", (t) => {
  const f = empty(t);
  for (let i = 0; i < MAX_RECORDS; i++) {
    const d = f.a.prepareIssue(
      f.issuer.session("issue"),
      p.utf8("vault asset " + i),
    );
    f.vault.add("recovery", f.a.backup(d));
  }
  const before = f.vault.list(),
    d = f.a.prepareIssue(f.issuer.session("issue"), p.utf8("overflow"));
  assert.throws(() => f.vault.add("recovery", f.a.backup(d)), /record count/);
  assert.deepEqual(f.vault.list(), before);
  assert.equal(
    LocalVault.open(
      f.vault.seal(password),
      password,
      f.manifest,
      f.vault.id,
    ).list().length,
    8,
  );
});
test("vault aggregate plaintext limit rejects before mutating records", (t) => {
  const f = empty(t);
  let rejected = false;
  for (let i = 0; i < 8; i++) {
    const asset = Buffer.alloc(65536, i + 1),
      d = f.a.prepareIssue(f.issuer.session("issue"), asset),
      before = f.vault.list();
    try {
      f.vault.add("recovery", f.a.backup(d));
    } catch (e) {
      assert.match(e.message, /plaintext size/);
      assert.deepEqual(f.vault.list(), before);
      rejected = true;
      break;
    }
  }
  assert(rejected);
  assert.equal(
    LocalVault.open(
      f.vault.seal(password),
      password,
      f.manifest,
      f.vault.id,
    ).list().length,
    f.vault.list().length,
  );
});
test("vault rejects authenticated malformed content and every invalid record before opening", (t) => {
  const f = setup(t);
  f.vault.add("recovery", f.snapshot);
  const wire = f.vault.seal(password),
    original = p.parse(rawClear(wire).toString(), MAX_CLEAR),
    id = Object.keys(original.records)[0];
  const changes = [
    (v) => (v.format = "other"),
    (v) => (v.vault_id = "00".repeat(16)),
    (v) => (v.manifest.realm = "72".repeat(32)),
    (v) => (v.extra = true),
    (v) => (v.records[id].wire = "{}"),
    (v) => (v.records[id].kind = "unknown"),
    (v) => {
      v.records["00".repeat(32)] = v.records[id];
      delete v.records[id];
    },
  ];
  for (const change of changes) {
    const v = JSON.parse(JSON.stringify(original));
    change(v);
    assert.throws(() =>
      LocalVault.open(
        reencrypt(wire, p.canonical(v)),
        password,
        f.manifest,
        f.vault.id,
      ),
    );
  }
  // Canonical valid schema with a corrupt pending secret must also be revalidated.
  const v = JSON.parse(JSON.stringify(original));
  const bad = p.parse(v.records[id].wire, 300000);
  bad.secret = "00".repeat(32);
  v.records[id].wire = p.canonical(bad);
  const next = recordId("recovery", v.records[id].wire);
  v.records[next] = v.records[id];
  delete v.records[id];
  assert.throws(() =>
    LocalVault.open(
      reencrypt(wire, p.canonical(v)),
      password,
      f.manifest,
      f.vault.id,
    ),
  );
});
test("vault refuses valid ciphertext containing malformed UTF8 or plaintext over budget", (t) => {
  const f = empty(t),
    wire = f.vault.seal(password),
    clear = rawClear(wire);
  for (const bad of [
    Buffer.concat([Buffer.from([239, 187, 191]), clear]),
    Buffer.from([192, 175]),
    Buffer.from(JSON.stringify({ ...JSON.parse(clear), records: [] })),
    Buffer.alloc(MAX_CLEAR + 1, 32),
  ])
    assert.throws(() =>
      LocalVault.open(reencrypt(wire, bad), password, f.manifest, f.vault.id),
    );
});
test("vault password resealing preserves records but does not revoke old backups", (t) => {
  const f = setup(t),
    id = f.vault.add("recovery", f.snapshot),
    old = f.vault.seal(password),
    next = f.vault.seal("a different public password");
  assert.equal(
    LocalVault.open(
      next,
      "a different public password",
      f.manifest,
      f.vault.id,
    ).read(id).wire,
    f.snapshot,
  );
  assert.throws(() => LocalVault.open(next, password, f.manifest, f.vault.id));
  assert.equal(
    LocalVault.open(old, password, f.manifest, f.vault.id).read(id).wire,
    f.snapshot,
  );
});
test("vault older valid export remains readable without rollback protection", (t) => {
  const f = setup(t),
    old = f.vault.seal(password);
  f.vault.add("recovery", f.snapshot);
  assert.equal(
    LocalVault.open(old, password, f.manifest, f.vault.id).list().length,
    0,
  );
  assert.equal(f.vault.list().length, 1);
});
test("vault files are exclusive private exports and plaintext cannot be saved through the API", (t) => {
  const f = setup(t);
  f.vault.add("recovery", f.snapshot);
  const path = join(f.dir, "vault ü #.json");
  writeVaultFile(path, f.vault, password);
  const first = readFileSync(path);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.throws(() => writeVaultFile(path, f.vault, password), /EEXIST/);
  assert.deepEqual(readFileSync(path), first);
  assert.throws(
    () => writeVaultFile(join(f.dir, "plaintext"), f.snapshot, password),
    /local vault/,
  );
  assert.equal(
    LocalVault.open(
      readVaultFile(path),
      password,
      f.manifest,
      f.vault.id,
    ).list().length,
    1,
  );
});
test("vault read rejects symlinks directories public modes oversized and invalid UTF8 files", (t) => {
  const f = empty(t),
    path = join(f.dir, "saved");
  writeVaultFile(path, f.vault, password);
  const alias = join(f.dir, "alias");
  symlinkSync(path, alias);
  assert.throws(() => readVaultFile(alias));
  assert.throws(() => writeVaultFile(alias, f.vault, password));
  assert.throws(() => readVaultFile(f.dir));
  chmodSync(path, 0o644);
  assert.throws(() => readVaultFile(path), /private regular/);
  chmodSync(path, 0o600);
  writeFileSync(path, Buffer.alloc(MAX_FILE + 1));
  assert.throws(() => readVaultFile(path), /file size/);
  writeFileSync(path, Buffer.from([192, 175]));
  assert.throws(() => readVaultFile(path));
});
test("vault recovery acknowledgment requires the exact encrypted file readback", (t) => {
  const f = setup(t),
    path = join(f.dir, "recovery");
  assert.throws(() => f.a.submit(f.d, f.issuer), /recovery snapshot/);
  writeVaultFile(path, f.vault, password);
  const before = rows(f.a);
  assert.throws(
    () => acknowledgeRecoveryFile(f.a, f.d, path, password, f.vault.id),
    /unknown vault record/,
  );
  assert.deepEqual(rows(f.a), before);
  f.vault.add("recovery", f.snapshot);
  const correct = join(f.dir, "correct");
  writeVaultFile(correct, f.vault, password);
  assert.throws(() =>
    acknowledgeRecoveryFile(
      f.a,
      f.d,
      correct,
      "wrong test password",
      f.vault.id,
    ),
  );
  assert.deepEqual(rows(f.a), before);
  acknowledgeRecoveryFile(f.a, f.d, correct, password, f.vault.id);
  assert.equal(f.a.pending(f.d).acknowledged, 1);
  f.a.submit(f.d, f.issuer);
});
test("vault corrupted or truncated recovery does not acknowledge or restore any client rows", (t) => {
  const f = setup(t);
  f.vault.add("recovery", f.snapshot);
  const path = join(f.dir, "broken"),
    wire = f.vault.seal(password),
    id = recordId("recovery", f.snapshot),
    a = rows(f.a),
    b = rows(f.b);
  for (const bad of [
    wire.slice(0, -1),
    changed(wire, (v) => (v.tag = flip(v.tag))),
    p.canonical({ version: 1 }),
  ]) {
    writeFileSync(path, bad, { mode: 0o600 });
    assert.throws(() =>
      acknowledgeRecoveryFile(f.a, f.d, path, password, f.vault.id),
    );
    assert.throws(() =>
      restoreRecoveryFile(f.b, path, password, f.vault.id, id),
    );
    assert.deepEqual(rows(f.a), a);
    assert.deepEqual(rows(f.b), b);
  }
});
test("vault encrypted PNG claim recovers lost response and preserves later spent state", (t) => {
  const f = setup(t);
  f.acknowledge(f.a, f.d);
  const id = f.a.submit(f.d, f.issuer),
    file = exportImage(f.a.export(id), f.manifest);
  const d = prepareImageClaim(f.b, f.issuer.session("swap"), file),
    r = f.vault.add("recovery", f.b.backup(d)),
    path = join(f.dir, "claim-backup");
  writeVaultFile(path, f.vault, password);
  acknowledgeRecoveryFile(f.b, d, path, password, f.vault.id);
  const v = pending(f.b, d);
  f.issuer.submit(v.wire, v.capability);
  const restored = f.client("restored");
  assert.equal(restoreRecoveryFile(restored, path, password, f.vault.id, r), d);
  const claimed = restored.recover(d, f.issuer);
  const protectedId = f.vault.add("bearer", restored.export(claimed)),
    copy = LocalVault.open(
      f.vault.seal(password),
      password,
      f.manifest,
      f.vault.id,
    );
  assert.deepEqual(
    importImage(
      exportImage(copy.read(protectedId).wire, f.manifest),
      f.manifest,
    ).image,
    png,
  );
  const cancel = restored.prepareCancel(f.issuer.session("swap"), claimed);
  f.acknowledge(restored, cancel);
  restored.submit(cancel, f.issuer);
  restoreRecoveryFile(restored, path, password, f.vault.id, r);
  restored.recover(d, f.issuer);
  assert.throws(() => restored.export(claimed), /spent/);
  assert.equal(f.issuer.counts().operations, 3);
});
