// Shared local lifecycle boundary for trusted injected custody code; not a sandbox.
import { performance } from "node:perf_hooks";
export const failure = (domain, code) =>
  Object.assign(new Error(`PS ${domain.toLowerCase()} ${code.toLowerCase()}`), {
    code: `ERR_PS_${domain}_${code}`,
  });
export function ownedBytes(value, min, max) {
  if (
    !(value instanceof Uint8Array) ||
    !(value.buffer instanceof ArrayBuffer) ||
    value.byteLength < min ||
    value.byteLength > max
  )
    throw new Error("byte input");
  return new Uint8Array(value);
}
export function wipe(value) {
  try {
    value?.fill(0);
  } catch {
    /* Detached provider-owned view. */
  }
}

/** One outstanding trusted call, monotonic deadline and permanent closure after cancellation. */
export class AsyncBoundary {
  #domain;
  #timeout;
  #closed = false;
  #cancel = null;
  constructor(domain, timeoutMs = 5000) {
    if (
      !/^[A-Z_]{1,32}$/.test(domain) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 5000
    )
      throw failure("BOUNDARY", "CONFIG");
    this.#domain = domain;
    this.#timeout = timeoutMs;
  }
  check(signal) {
    if (this.#closed) throw failure(this.#domain, "CLOSED");
    if (this.#cancel) throw failure(this.#domain, "BUSY");
    if (signal !== undefined && !(signal instanceof AbortSignal))
      throw failure(this.#domain, "INPUT");
    if (signal?.aborted) throw failure(this.#domain, "CANCELLED");
  }
  async run(invoke, accept, signal, cleanup = () => {}) {
    this.check(signal);
    const deadline = performance.now() + this.#timeout,
      controller = new AbortController();
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
        try {
          cleanup();
        } catch {
          /* Cleanup never replaces the outcome. */
        }
        if (code) reject(failure(this.#domain, code));
        else resolve(result);
        if (code) controller.abort();
      };
      const expired = () => performance.now() >= deadline;
      const cancel = () => finish("CANCELLED");
      const timer = setTimeout(() => finish("TIMEOUT"), this.#timeout);
      this.#cancel = () => finish("CLOSED");
      signal?.addEventListener("abort", cancel, { once: true });
      Promise.resolve()
        .then(() => {
          if (done) return;
          if (expired()) return finish("TIMEOUT");
          return invoke(controller.signal);
        })
        .then(
          (value) => {
            if (done) return;
            if (expired()) return finish("TIMEOUT");
            try {
              const result = accept(value);
              if (result && typeof result.then === "function")
                throw new Error("synchronous acceptance required");
              if (expired()) {
                wipe(result);
                return finish("TIMEOUT");
              }
              finish(null, result);
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
  close() {
    this.#closed = true;
    this.#cancel?.();
  }
}
