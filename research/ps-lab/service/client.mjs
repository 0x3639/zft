// Explicit async bridge for the unchanged durable Client. Never auto-acknowledges recovery custody.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import * as p from "../local/profile.mjs";
import { failure } from "./boundary.mjs";
export class ServiceClient {
  #origin;
  #token;
  #closed = false;
  #active = new Set();
  constructor(origin, token) {
    const u = new URL(origin);
    assert.equal(u.origin, origin);
    assert(
      u.protocol === "https:" ||
        (u.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(u.hostname)),
    );
    p.bytes(token, 32);
    this.#origin = origin;
    this.#token = token;
  }
  async call(path, body, { signal } = {}) {
    if (this.#closed) throw failure("SERVICE_CLIENT", "CLOSED");
    assert(
      [
        "/api/ps/session",
        "/api/ps/submit",
        "/api/ps/recover",
        "/api/ps/observe",
        "/api/ps/receipt",
      ].includes(path),
    );
    const controller = new AbortController(),
      started = performance.now();
    this.#active.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(this.#origin + path, {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        headers: {
          Origin: this.#origin,
          Authorization: "Bearer " + this.#token,
          "Content-Type": "application/json",
        },
        body: p.canonical(body),
        signal: signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal,
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/json");
      assert.equal(response.headers.get("cache-control"), "no-store");
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        assert(size <= 32768, "response bound");
        chunks.push(chunk);
      }
      assert(
        performance.now() - started < 15000 &&
          !controller.signal.aborted &&
          !signal?.aborted,
        "response deadline",
      );
      return p.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
        32768,
      );
    } catch {
      controller.abort();
      throw failure("SERVICE_CLIENT", "UNAVAILABLE");
    } finally {
      clearTimeout(timer);
      this.#active.delete(controller);
    }
  }
  async session(kind, options) {
    const r = await this.call("/api/ps/session", { kind }, options);
    p.fields(r, "session");
    return r.session;
  }
  async submit(client, digest, options) {
    const row = client.pending(digest);
    assert.equal(row.acknowledged, 1, "recovery snapshot required");
    const v = client.validateSnapshot(row.snapshot),
      r = await this.call(
        "/api/ps/submit",
        { wire: v.wire, capability: v.capability },
        options,
      );
    p.fields(r, "response");
    return client.accept(digest, r.response);
  }
  async recover(client, digest, options) {
    const row = client.pending(digest);
    assert.equal(row.acknowledged, 1, "recovery snapshot required");
    const v = client.validateSnapshot(row.snapshot),
      r = await this.call(
        "/api/ps/recover",
        { digest, capability: v.capability },
        options,
      );
    p.fields(r, "response");
    assert(r.response !== null, "preserve unknown pending request");
    return client.accept(digest, r.response);
  }
  async observe(wire, options) {
    const r = await this.call("/api/ps/observe", { wire }, options);
    p.fields(r, "receipt");
    return r.receipt;
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const c of this.#active) c.abort();
    this.#token = null;
  }
}
