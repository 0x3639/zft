// Versioned encrypted service payloads. No I/O, provider selection or plaintext fallback.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import * as p from "../local/profile.mjs";
import {
  KEY_REQUEST,
  KEY_RESPONSE,
  WRAPPED_KEY_BYTES,
} from "../local/key-envelope.mjs";
import { AsyncBoundary, failure, ownedBytes, wipe } from "./boundary.mjs";
export const RECORD = "zft-ps-protected-record-v1";
export const RECORD_LIMITS = Object.freeze({
  session: 512,
  backup: 64 * 1024 * 1024,
});
const fail = (code) => failure("RECORD", code);
const aad = (value) =>
  p.utf8(
    p.canonical({
      scope: value.scope,
      wrapped_key: value.wrapped_key,
      iv: value.iv,
    }),
  );

/** Encrypt bounded session/backup bytes under exact caller-selected context and record identity. */
export class ProtectedRecord {
  #scope;
  #context;
  #transport;
  #gate;
  #limit;
  constructor(config) {
    try {
      const {
        manifest,
        configurationId,
        keyId,
        purpose,
        recordId,
        transport,
        timeoutMs = 5000,
      } = config;
      const trusted = p.trust(manifest).manifest;
      p.bytes(configurationId, 32);
      p.bytes(recordId, 32);
      if (
        !Object.hasOwn(RECORD_LIMITS, purpose) ||
        typeof keyId !== "string" ||
        !/^[A-Za-z0-9:/._-]{1,2048}$/.test(keyId) ||
        typeof transport !== "function"
      )
        throw fail("CONFIG");
      this.#scope = Object.freeze({
        format: RECORD,
        algorithm: "AES-256-GCM",
        purpose,
        record_id: recordId,
        configuration_id: configurationId,
        wrapping_key_id: keyId,
        manifest: trusted,
      });
      this.#context = p.canonical(this.#scope);
      this.#limit = RECORD_LIMITS[purpose];
      this.#transport = transport;
      this.#gate = new AsyncBoundary("RECORD", timeoutMs);
    } catch {
      throw fail("CONFIG");
    }
  }
  #request(operation, material, accept, signal) {
    const request = Object.freeze({
      format: KEY_REQUEST,
      operation,
      key_id: this.#scope.wrapping_key_id,
      context: this.#context,
      material: new Uint8Array(material),
    });
    return this.#gate.run(
      (s) => this.#transport(request, Object.freeze({ signal: s })),
      (value) => {
        let result;
        try {
          p.fields(value, "format operation key_id material");
          if (
            value.format !== KEY_RESPONSE ||
            value.operation !== operation ||
            value.key_id !== request.key_id
          )
            throw fail("RESPONSE");
          result = ownedBytes(
            value.material,
            operation === "wrap" ? 1 : 32,
            operation === "wrap" ? WRAPPED_KEY_BYTES : 32,
          );
          return accept(result);
        } finally {
          wipe(result);
        }
      },
      signal,
      () => wipe(request.material),
    );
  }
  /** Snapshot caller bytes, use a new data key and IV, and authenticate every public header field. */
  async seal(input, { signal } = {}) {
    this.#gate.check(signal);
    let plaintext, key;
    try {
      plaintext = ownedBytes(input, 1, this.#limit);
      key = randomBytes(32);
    } catch {
      wipe(plaintext);
      throw fail("INPUT");
    }
    try {
      return await this.#request(
        "wrap",
        key,
        (wrapped) => {
          const value = {
            scope: this.#scope,
            wrapped_key: p.hex(wrapped),
            iv: randomBytes(12).toString("hex"),
          };
          const cipher = createCipheriv(
            "aes-256-gcm",
            key,
            p.bytes(value.iv, 12),
            { authTagLength: 16 },
          );
          cipher.setAAD(aad(value));
          const encrypted = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
          ]);
          return p.canonical({
            ...value,
            ciphertext: p.hex(encrypted),
            tag: p.hex(cipher.getAuthTag()),
          });
        },
        signal,
      );
    } finally {
      wipe(plaintext);
      wipe(key);
    }
  }
  /** Validate exact selected scope and authenticate before returning owned plaintext bytes. */
  async open(wire, { signal } = {}) {
    this.#gate.check(signal);
    let value, wrapped, iv, tag, ciphertext;
    try {
      value = p.parse(wire, 2 * this.#limit + 16384);
      p.fields(value, "scope wrapped_key iv ciphertext tag");
      if (p.canonical(value.scope) !== this.#context) throw fail("INPUT");
      wrapped = ownedBytes(p.bytes(value.wrapped_key), 1, WRAPPED_KEY_BYTES);
      iv = p.bytes(value.iv, 12);
      tag = p.bytes(value.tag, 16);
      ciphertext = ownedBytes(p.bytes(value.ciphertext), 1, this.#limit);
    } catch {
      throw fail("INPUT");
    }
    return this.#request(
      "unwrap",
      wrapped,
      (key) => {
        let partial, last;
        try {
          const cipher = createDecipheriv("aes-256-gcm", key, iv, {
            authTagLength: 16,
          });
          cipher.setAAD(aad(value));
          cipher.setAuthTag(tag);
          partial = cipher.update(ciphertext);
          last = cipher.final();
          return new Uint8Array(Buffer.concat([partial, last]));
        } finally {
          wipe(partial);
          wipe(last);
        }
      },
      signal,
    );
  }
  close() {
    this.#gate.close();
  }
}
