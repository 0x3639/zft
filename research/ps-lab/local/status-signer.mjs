// Local contract experiment. No provider SDK, keys, registry writes or server integration.
import { createPublicKey, verify } from "node:crypto";
import { performance } from "node:perf_hooks";
import * as p from "./profile.mjs";
import { stateManifest } from "./state.mjs";

export const SIGN_REQUEST = "zft-ps-status-sign-request-v1";
export const SIGN_RESPONSE = "zft-ps-status-sign-response-v1";
export const SIGN_MESSAGE_BYTES = 4096;
export const SIGN_RESPONSE_BYTES = 4096;
const SPKI = "302a300506032b6570032100";
function failure(code) {
  return Object.assign(new Error("PS status signer " + code.toLowerCase()), {
    code: "ERR_PS_STATUS_SIGNER_" + code,
  });
}

/** Bounded raw Ed25519 transport boundary; callers still authorize and frame messages. */
export class StatusSigner {
  #transport;
  #keyId;
  #publicKey;
  #timeoutMs;
  #closed = false;
  #cancel = null;

  constructor({ psManifest, manifest, keyId, transport, timeoutMs = 5000 }) {
    try {
      const pinned = p.parse(p.canonical(manifest), 2048);
      if (
        p.canonical(pinned) !==
        p.canonical(stateManifest(psManifest, pinned.public_key))
      )
        throw failure("CONFIG");
      if (
        typeof keyId !== "string" ||
        !/^[A-Za-z0-9:/._-]{1,2048}$/.test(keyId) ||
        typeof transport !== "function" ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 100 ||
        timeoutMs > 5000
      )
        throw failure("CONFIG");
      this.#publicKey = createPublicKey({
        key: Buffer.from(SPKI + pinned.public_key, "hex"),
        format: "der",
        type: "spki",
      });
      this.#keyId = keyId;
      this.#transport = transport;
      this.#timeoutMs = timeoutMs;
    } catch {
      throw failure("CONFIG");
    }
  }

  /** Sign an owned snapshot once; verify exact bytes before returning lowercase signature hex. */
  async sign(message, { signal } = {}) {
    if (this.#closed) throw failure("CLOSED");
    if (this.#cancel) throw failure("BUSY");
    if (
      !(message instanceof Uint8Array) ||
      !(message.buffer instanceof ArrayBuffer) ||
      message.byteLength < 1 ||
      message.byteLength > SIGN_MESSAGE_BYTES ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      throw failure("INPUT");
    if (signal?.aborted) throw failure("CANCELLED");
    // Transport and caller each have distinct storage from verification's snapshot.
    const expected = new Uint8Array(message);
    const request = Object.freeze({
      format: SIGN_REQUEST,
      key_id: this.#keyId,
      algorithm: "Ed25519",
      message_type: "RAW",
      message: Uint8Array.from(expected),
    });
    const deadline = performance.now() + this.#timeoutMs;
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (code, signature) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        this.#cancel = null;
        // Cancellation cannot prove a remote operation stopped. Require a new adapter.
        if (["TIMEOUT", "CANCELLED", "CLOSED"].includes(code))
          this.#closed = true;
        if (code) reject(failure(code));
        else resolve(signature);
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
          (wire) => {
            if (done) return;
            if (expired()) return finish("TIMEOUT");
            try {
              const value = p.parse(wire, SIGN_RESPONSE_BYTES);
              p.fields(value, "format key_id algorithm message_type signature");
              if (
                value.format !== SIGN_RESPONSE ||
                value.key_id !== this.#keyId ||
                value.algorithm !== "Ed25519" ||
                value.message_type !== "RAW"
              )
                throw failure("RESPONSE");
              const signature = p.bytes(value.signature, 64);
              if (!verify(null, expected, this.#publicKey, signature))
                throw failure("RESPONSE");
              if (expired()) return finish("TIMEOUT");
              finish(null, value.signature);
            } catch {
              finish("RESPONSE");
            }
          },
          () => {
            if (!done) finish(expired() ? "TIMEOUT" : "UNAVAILABLE");
          },
        );
    });
  }

  /** Permanently reject future work and discard an outstanding result. */
  close() {
    this.#closed = true;
    this.#cancel?.();
  }
}
