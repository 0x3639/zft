// Original local research file vault. Does not encrypt the engine's live databases.
import assert from "node:assert/strict";
import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import * as p from "./profile.mjs";
import { Client } from "./client.mjs";
export const FORMAT = "zft-ps-local-vault-v1";
export const CONTENT = "zft-ps-local-vault-content-v1";
export const KDF = "scrypt-n32768-r8-p1";
export const CIPHER = "aes-256-gcm";
export const MAX_RECORDS = 8;
export const MAX_CLEAR = 1048576;
export const MAX_FILE = 2 * MAX_CLEAR + 4096;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const hex = (s, n) => Buffer.from(p.bytes(s, n));
const randomHex = (n) => randomBytes(n).toString("hex");
export const recordId = (kind, wire) => p.hash(kind + "\0" + wire);
function passwordKey(password, salt) {
  assert(
    typeof password === "string" &&
      password.length <= 1024 &&
      password.isWellFormed(),
    "password Unicode",
  );
  const input = Buffer.from(password, "utf8");
  try {
    assert(input.length >= 12 && input.length <= 1024, "password byte limit");
    return scryptSync(input, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  } finally {
    input.fill(0);
  }
}
function record(value, pinned) {
  p.fields(value, "kind wire");
  if (value.kind === "bearer") p.importBearer(value.wire, pinned);
  else {
    assert.equal(value.kind, "recovery", "vault record kind");
    // Reuse the engine's side-effect-free validator without creating a plaintext DB.
    Client.prototype.validateSnapshot.call({ pinned }, value.wire);
  }
  return { kind: value.kind, wire: value.wire };
}
function content(records, pinned, id) {
  const wire = p.canonical({
    format: CONTENT,
    vault_id: id,
    manifest: pinned.manifest,
    records,
  });
  assert(Buffer.byteLength(wire) <= MAX_CLEAR, "vault plaintext size");
  return wire;
}
function validateContent(wire, pinned, id) {
  const v = p.parse(wire, MAX_CLEAR);
  p.fields(v, "format vault_id manifest records");
  assert.equal(v.format, CONTENT, "vault content version");
  assert.equal(v.vault_id, id, "vault content identity");
  assert.equal(
    p.canonical(v.manifest),
    p.canonical(pinned.manifest),
    "vault content manifest",
  );
  assert(
    v.records && Object.getPrototypeOf(v.records) === Object.prototype,
    "vault records object",
  );
  assert(Object.keys(v.records).length <= MAX_RECORDS, "vault record count");
  const records = {};
  for (const [id, value] of Object.entries(v.records)) {
    hex(id, 32);
    const entry = record(value, pinned);
    assert.equal(id, recordId(entry.kind, entry.wire), "vault record identity");
    records[id] = entry;
  }
  return records;
}
function header(wire, pinned, expectedId) {
  hex(expectedId, 16);
  const v = p.parse(wire, MAX_FILE);
  p.fields(v, "format kdf cipher salt iv vault_id manifest ciphertext tag");
  assert.equal(v.format, FORMAT, "vault format");
  assert.equal(v.kdf, KDF, "vault KDF");
  assert.equal(v.cipher, CIPHER, "vault cipher");
  assert.equal(v.vault_id, expectedId, "pinned vault identity");
  assert.equal(
    p.canonical(v.manifest),
    p.canonical(pinned.manifest),
    "pinned vault manifest",
  );
  hex(v.salt, 16);
  hex(v.iv, 12);
  hex(v.tag, 16);
  assert(
    typeof v.ciphertext === "string" &&
      v.ciphertext.length > 0 &&
      v.ciphertext.length <= 2 * MAX_CLEAR,
    "vault ciphertext size",
  );
  hex(v.ciphertext);
  const { ciphertext, tag, ...aad } = v;
  return { ...v, aad: p.canonical(aad) };
}
export class LocalVault {
  #pinned;
  #id;
  #records;
  constructor(manifest) {
    this.#pinned = p.trust(manifest);
    this.#id = randomHex(16);
    this.#records = {};
  }
  get id() {
    return this.#id;
  }
  get locked() {
    return this.#records === null;
  }
  #requireUnlocked() {
    assert(!this.locked, "vault locked");
  }
  lock() {
    this.#records = null;
  }
  list() {
    this.#requireUnlocked();
    return Object.entries(this.#records).map(([id, r]) => ({
      id,
      kind: r.kind,
    }));
  }
  read(id) {
    this.#requireUnlocked();
    hex(id, 32);
    assert(this.#records[id], "unknown vault record");
    return { ...this.#records[id] };
  }
  add(kind, wire) {
    this.#requireUnlocked();
    const value = record({ kind, wire }, this.#pinned),
      id = recordId(kind, wire);
    const candidate = { ...this.#records, [id]: value };
    assert(Object.keys(candidate).length <= MAX_RECORDS, "vault record count");
    content(candidate, this.#pinned, this.#id); // Validate size before mutating the live set.
    this.#records = candidate;
    return id;
  }
  seal(password) {
    this.#requireUnlocked();
    const clear = Buffer.from(content(this.#records, this.#pinned, this.#id));
    let key;
    try {
      const h = {
        format: FORMAT,
        kdf: KDF,
        cipher: CIPHER,
        vault_id: this.#id,
        manifest: this.#pinned.manifest,
        salt: randomHex(16),
        iv: randomHex(12),
      };
      key = passwordKey(password, hex(h.salt, 16));
      const cipher = createCipheriv(CIPHER, key, hex(h.iv, 12), {
        authTagLength: 16,
      });
      cipher.setAAD(Buffer.from(p.canonical(h)));
      const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
      const wire = p.canonical({
        ...h,
        ciphertext: ciphertext.toString("hex"),
        tag: cipher.getAuthTag().toString("hex"),
      });
      assert(Buffer.byteLength(wire) <= MAX_FILE, "vault file size");
      return wire;
    } finally {
      clear.fill(0);
      key?.fill(0);
    }
  }
  static open(wire, password, manifest, expectedId) {
    const pinned = p.trust(manifest),
      h = header(wire, pinned, expectedId);
    let key, pending, final, clear;
    try {
      key = passwordKey(password, hex(h.salt, 16));
      const decipher = createDecipheriv(CIPHER, key, hex(h.iv, 12), {
        authTagLength: 16,
      });
      decipher.setAAD(Buffer.from(h.aad));
      decipher.setAuthTag(hex(h.tag, 16));
      pending = decipher.update(hex(h.ciphertext));
      final = decipher.final(); // Authenticate before decoding or exposing any plaintext.
      clear = Buffer.concat([pending, final]);
      const records = validateContent(
        decoder.decode(clear),
        pinned,
        expectedId,
      );
      const vault = new LocalVault(manifest);
      vault.#id = expectedId;
      vault.#records = records;
      return vault;
    } finally {
      key?.fill(0);
      pending?.fill(0);
      final?.fill(0);
      clear?.fill(0);
    }
  }
}
// Exclusive new-file export. A failed write may leave an unusable partial file;
// callers must read back successfully before acknowledging recovery. No overwrite.
export function writeVaultFile(path, vault, password) {
  assert(vault instanceof LocalVault, "unlocked local vault required");
  const wire = vault.seal(password);
  assert(
    typeof wire === "string" && Buffer.byteLength(wire) <= MAX_FILE,
    "vault file size",
  );
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, wire, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function readVaultFile(path) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = fstatSync(fd);
    assert(
      info.isFile() && (info.mode & 0o077) === 0,
      "private regular vault file",
    );
    assert(info.size <= MAX_FILE, "vault file size");
    const buffer = Buffer.alloc(MAX_FILE + 1);
    let size = 0,
      n;
    while (
      size < buffer.length &&
      (n = readSync(fd, buffer, size, buffer.length - size, null))
    )
      size += n;
    assert(size <= MAX_FILE, "vault file size");
    return decoder.decode(buffer.subarray(0, size));
  } finally {
    closeSync(fd);
  }
}
export function acknowledgeRecoveryFile(
  client,
  digest,
  path,
  password,
  expectedId,
) {
  const vault = LocalVault.open(
    readVaultFile(path),
    password,
    client.pinned.manifest,
    expectedId,
  );
  try {
    const snapshot = client.backup(digest),
      saved = vault.read(recordId("recovery", snapshot));
    assert.equal(saved.kind, "recovery");
    assert.equal(saved.wire, snapshot, "exact encrypted recovery readback");
    client.acknowledge(digest, p.hash(saved.wire));
  } finally {
    vault.lock();
  }
}
export function restoreRecoveryFile(client, path, password, expectedId, id) {
  const vault = LocalVault.open(
    readVaultFile(path),
    password,
    client.pinned.manifest,
    expectedId,
  );
  try {
    const saved = vault.read(id);
    assert.equal(saved.kind, "recovery", "recovery record required");
    return client.restore(saved.wire);
  } finally {
    vault.lock();
  }
}
