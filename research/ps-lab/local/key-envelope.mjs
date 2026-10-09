// Isolated storage-format experiment; the persistent issuer does not call this module.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import * as p from "./profile.mjs";

export const KEY_ENVELOPE = "zft-ps-key-envelope-v1";
export const KEY_REQUEST = "zft-ps-key-wrap-request-v1";
export const KEY_RESPONSE = "zft-ps-key-wrap-response-v1";
export const ENVELOPE_BYTES = 16384;
export const WRAPPED_KEY_BYTES = 4096;
const PAYLOAD_BYTES = 512;
const fail = (code) =>
  Object.assign(new Error("PS key envelope " + code.toLowerCase()), {
    code: "ERR_PS_KEY_ENVELOPE_" + code,
  });
function byteView(value, min, max) {
  if (
    !(value instanceof Uint8Array) ||
    !(value.buffer instanceof ArrayBuffer) ||
    value.byteLength < min ||
    value.byteLength > max
  )
    throw fail("INPUT");
  return new Uint8Array(value);
}
function wipe(value) {
  // Best effort for these buffers only; JS strings, provider copies and runtime memory remain.
  try {
    value?.fill(0);
  } catch {
    /* A trusted transport may have detached its buffer. */
  }
}
function aad(scope, wrapped_key, iv) {
  return p.utf8(p.canonical({ scope, wrapped_key, iv }));
}

/** Versioned, context-bound PS scalar envelope with an injected wrap/unwrap transport. */
export class PsKeyEnvelope {
  #scope;
  #context;
  #transport;
  #timeoutMs;
  #closed = false;
  #cancel = null;

  constructor(config) {
    try {
      const {
        manifest,
        configurationId,
        keyId,
        transport,
        timeoutMs = 5000,
      } = config;
      p.bytes(configurationId, 32);
      if (
        typeof keyId !== "string" ||
        !/^[A-Za-z0-9:/._-]{1,2048}$/.test(keyId) ||
        typeof transport !== "function" ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 100 ||
        timeoutMs > 5000
      )
        throw fail("CONFIG");
      this.#scope = Object.freeze({
        format: KEY_ENVELOPE,
        algorithm: "AES-256-GCM",
        purpose: "ps-issuer-scalars",
        manifest: p.trust(manifest).manifest,
        configuration_id: configurationId,
        wrapping_key_id: keyId,
      });
      this.#context = p.canonical(this.#scope);
      this.#transport = transport;
      this.#timeoutMs = timeoutMs;
    } catch {
      throw fail("CONFIG");
    }
  }

  #check(options) {
    if (this.#closed) throw fail("CLOSED");
    if (this.#cancel) throw fail("BUSY");
    if (
      !options ||
      (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    )
      throw fail("INPUT");
    if (options.signal?.aborted) throw fail("CANCELLED");
    return options.signal;
  }

  #secrets(wire) {
    const value = p.parse(wire, PAYLOAD_BYTES);
    if (
      p.canonical(p.manifest(this.#scope.manifest.realm, value)) !==
      p.canonical(this.#scope.manifest)
    )
      throw fail("INPUT");
    return value;
  }

  /** Encrypt exactly the pinned x/yh/ys scalars with a fresh key and IV for each call. */
  async seal(secrets, options = {}) {
    const signal = this.#check(options);
    let plaintext, key;
    try {
      const wire = p.canonical(secrets);
      this.#secrets(wire);
      plaintext = Buffer.from(wire);
      key = randomBytes(32);
    } catch {
      wipe(plaintext);
      wipe(key);
      throw fail("INPUT");
    }
    try {
      return await this.#run("wrap", key, signal, (wrapped) => {
        const iv = randomBytes(12).toString("hex");
        const wrapped_key = p.hex(wrapped);
        const cipher = createCipheriv("aes-256-gcm", key, p.bytes(iv, 12), {
          authTagLength: 16,
        });
        cipher.setAAD(aad(this.#scope, wrapped_key, iv));
        const ciphertext = Buffer.concat([
          cipher.update(plaintext),
          cipher.final(),
        ]);
        const wire = p.canonical({
          scope: this.#scope,
          wrapped_key,
          iv,
          ciphertext: p.hex(ciphertext),
          tag: p.hex(cipher.getAuthTag()),
        });
        if (Buffer.byteLength(wire) > ENVELOPE_BYTES) throw fail("RESPONSE");
        return wire;
      });
    } finally {
      wipe(plaintext);
      wipe(key);
    }
  }

  /** Authenticate a bounded record and validate its scalars before returning any plaintext. */
  async open(wire, options = {}) {
    const signal = this.#check(options);
    let value, wrapped, iv, ciphertext, tag;
    try {
      value = p.parse(wire, ENVELOPE_BYTES);
      p.fields(value, "scope wrapped_key iv ciphertext tag");
      if (p.canonical(value.scope) !== this.#context) throw fail("INPUT");
      wrapped = byteView(p.bytes(value.wrapped_key), 1, WRAPPED_KEY_BYTES);
      iv = p.bytes(value.iv, 12);
      tag = p.bytes(value.tag, 16);
      ciphertext = byteView(p.bytes(value.ciphertext), 1, PAYLOAD_BYTES);
    } catch {
      throw fail("INPUT");
    }
    return this.#run("unwrap", wrapped, signal, (key) => {
      let partial, final, plaintext;
      try {
        const cipher = createDecipheriv("aes-256-gcm", key, iv, {
          authTagLength: 16,
        });
        cipher.setAAD(aad(this.#scope, value.wrapped_key, value.iv));
        cipher.setAuthTag(tag);
        partial = cipher.update(ciphertext);
        final = cipher.final(); // Never return update() bytes before authentication succeeds.
        plaintext = Buffer.concat([partial, final]);
        return this.#secrets(
          new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
        );
      } finally {
        wipe(partial);
        wipe(final);
        wipe(plaintext);
      }
    });
  }

  #run(operation, material, signal, accept) {
    const request = Object.freeze({
      format: KEY_REQUEST,
      operation,
      key_id: this.#scope.wrapping_key_id,
      context: this.#context,
      material: new Uint8Array(material),
    });
    const controller = new AbortController();
    const deadline = performance.now() + this.#timeoutMs;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (code, result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        this.#cancel = null;
        if (["TIMEOUT", "CANCELLED", "CLOSED"].includes(code))
          this.#closed = true;
        wipe(request.material);
        if (code) reject(fail(code));
        else resolve(result);
        if (code) controller.abort();
      };
      const cancel = () => finish("CANCELLED");
      const expired = () => performance.now() >= deadline;
      const timer = setTimeout(() => finish("TIMEOUT"), this.#timeoutMs);
      this.#cancel = () => finish("CLOSED");
      signal?.addEventListener("abort", cancel, { once: true });
      Promise.resolve()
        .then(() => {
          if (done) return;
          if (expired()) return finish("TIMEOUT");
          return this.#transport(
            request,
            Object.freeze({ signal: controller.signal }),
          );
        })
        .then(
          (response) => {
            if (done) return;
            if (expired()) return finish("TIMEOUT");
            let owned;
            try {
              p.fields(response, "format operation key_id material");
              if (
                response.format !== KEY_RESPONSE ||
                response.operation !== operation ||
                response.key_id !== this.#scope.wrapping_key_id
              )
                throw fail("RESPONSE");
              owned = byteView(
                response.material,
                operation === "wrap" ? 1 : 32,
                operation === "wrap" ? WRAPPED_KEY_BYTES : 32,
              );
              const result = accept(owned);
              if (expired()) return finish("TIMEOUT");
              finish(null, result);
            } catch {
              finish("RESPONSE");
            } finally {
              wipe(owned);
            }
          },
          () => {
            if (!done) finish(expired() ? "TIMEOUT" : "UNAVAILABLE");
          },
        );
    });
  }

  /** Permanently close the instance; cancellation cannot prove remote work stopped. */
  close() {
    this.#closed = true;
    this.#cancel?.();
  }
}
