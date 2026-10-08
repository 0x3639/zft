// Browser-native vault cryptography; exact compatibility with the local file format.
import { scryptAsync } from "../vendor/@noble/hashes/scrypt.js";
import assert, { utf8, randomHex } from "./runtime.mjs";
import * as p from "./profile.mjs";
import * as s from "./schema.mjs";
export async function derive(password, salt) {
  assert(
    typeof password === "string" &&
      password.length <= 1024 &&
      password.isWellFormed(),
    "password Unicode",
  );
  const input = utf8(password);
  try {
    assert(input.length >= 12 && input.length <= 1024, "password byte limit");
    return await scryptAsync(input, salt, {
      N: 32768,
      r: 8,
      p: 1,
      dkLen: 32,
      maxmem: 64 * 1024 * 1024,
    });
  } finally {
    input.fill(0);
  }
}
export class BrowserVault {
  #pinned;
  #id;
  #records;
  #epoch = 0;
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
  lock() {
    this.#epoch++;
    this.#records = null;
  }
  #open() {
    assert(!this.locked, "vault locked");
  }
  list() {
    this.#open();
    return Object.entries(this.#records).map(([id, r]) => ({
      id,
      kind: r.kind,
    }));
  }
  read(id) {
    this.#open();
    p.bytes(id, 32);
    assert(this.#records[id], "unknown record");
    return { ...this.#records[id] };
  }
  add(kind, wire) {
    this.#open();
    const r = s.record({ kind, wire }, this.#pinned),
      id = s.recordId(kind, wire);
    const next = { ...this.#records, [id]: r };
    assert(Object.keys(next).length <= s.MAX_RECORDS, "record limit");
    s.content(next, this.#pinned, this.#id);
    this.#records = next;
    return id;
  }
  async seal(password) {
    this.#open();
    const epoch = this.#epoch,
      clear = utf8(s.content(this.#records, this.#pinned, this.#id));
    let key;
    try {
      const h = {
        format: s.FORMAT,
        kdf: s.KDF,
        cipher: s.CIPHER,
        vault_id: this.#id,
        manifest: this.#pinned.manifest,
        salt: randomHex(16),
        iv: randomHex(12),
      };
      key = await derive(password, p.bytes(h.salt, 16));
      this.#open();
      assert.equal(epoch, this.#epoch, "vault changed");
      const imported = await crypto.subtle.importKey(
        "raw",
        key,
        "AES-GCM",
        false,
        ["encrypt"],
      );
      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: p.bytes(h.iv, 12),
            additionalData: utf8(p.canonical(h)),
            tagLength: 128,
          },
          imported,
          clear,
        ),
      );
      this.#open();
      assert.equal(epoch, this.#epoch, "vault changed");
      const wire = p.canonical({
        ...h,
        ciphertext: p.hex(encrypted.subarray(0, -16)),
        tag: p.hex(encrypted.subarray(-16)),
      });
      assert(utf8(wire).length <= s.MAX_FILE, "vault file size");
      return wire;
    } finally {
      clear.fill(0);
      key?.fill(0);
    }
  }
  static async open(wire, password, manifest, id) {
    const pinned = p.trust(manifest),
      h = s.header(wire, pinned, id);
    let key, clear;
    try {
      key = await derive(password, p.bytes(h.salt, 16));
      const imported = await crypto.subtle.importKey(
        "raw",
        key,
        "AES-GCM",
        false,
        ["decrypt"],
      );
      const bytes = p.bytes(h.ciphertext + h.tag);
      clear = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: p.bytes(h.iv, 12),
            additionalData: utf8(h.aad),
            tagLength: 128,
          },
          imported,
          bytes,
        ),
      );
      const records = s.validateContent(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          clear,
        ),
        pinned,
        id,
      );
      const v = new BrowserVault(manifest);
      v.#id = id;
      v.#records = records;
      return v;
    } finally {
      key?.fill(0);
      clear?.fill(0);
    }
  }
}
