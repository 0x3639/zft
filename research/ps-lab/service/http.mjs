// Separate service HTTP boundary. No listener, proxy trust, CORS or provider selection is implicit.
import assert from "node:assert/strict";
import http from "node:http";
import { performance } from "node:perf_hooks";
import * as p from "../local/profile.mjs";
import { authorize, grant, revoke, pruneGrants } from "./admission.mjs";
import { health } from "./operations.mjs";
export const HTTP_LIMITS = Object.freeze({
  body: 20000,
  response: 32768,
  inflight: 8,
  perGrant: 30,
  total: 120,
  windowMs: 60000,
  deadlineMs: 15000,
});
const routes = new Map([
  ["POST /api/ps/session", "participant"],
  ["POST /api/ps/submit", "participant"],
  ["POST /api/ps/recover", "participant"],
  ["POST /api/ps/observe", "participant"],
  ["POST /api/ps/receipt", "participant"],
  ["GET /ops/health", "monitor"],
  ["POST /ops/admission", "operator"],
  ["POST /ops/grant", "operator"],
  ["POST /ops/revoke", "operator"],
  ["POST /ops/retention", "operator"],
]);
/** Exact-origin authenticated handler; TLS termination must be configured outside this module. */
export function createServiceHandler(
  runtime,
  {
    origin,
    now = () => Math.floor(Date.now() / 1000),
    deadlineMs = HTTP_LIMITS.deadlineMs,
  } = {},
) {
  const url = new URL(origin);
  assert.equal(url.origin, origin);
  assert(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(url.hostname)),
    "TLS or numeric loopback required",
  );
  assert(
    Number.isInteger(deadlineMs) &&
      deadlineMs >= 100 &&
      deadlineMs <= HTTP_LIMITS.deadlineMs,
  );
  const { issuer, status } = runtime,
    started = performance.now(),
    rates = new Map();
  let active = 0,
    total = 0,
    window = started;
  function rate(hash) {
    const n = performance.now();
    if (n - window >= HTTP_LIMITS.windowMs) {
      window = n;
      rates.clear();
      total = 0;
    }
    assert(
      total < HTTP_LIMITS.total &&
        (rates.get(hash) || 0) < HTTP_LIMITS.perGrant,
      "rate limit",
    );
    total++;
    rates.set(hash, (rates.get(hash) || 0) + 1);
  }
  return async function handle(req, res) {
    const abort = new AbortController();
    let acquired = false,
      timer;
    const stop = () => abort.abort();
    req.once("aborted", stop);
    res.once("close", () => {
      if (!res.writableEnded) stop();
    });
    const reply = (code, value) => {
      if (res.destroyed || res.writableEnded) return;
      const wire = JSON.stringify(value);
      assert(Buffer.byteLength(wire) <= HTTP_LIMITS.response);
      res.writeHead(code, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        connection: "close",
      });
      res.end(wire);
    };
    try {
      const role = routes.get(req.method + " " + req.url);
      assert(role, "route");
      assert(req.rawHeaders.length <= 64, "header count");
      const headers = new Map();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i].toLowerCase();
        assert(!headers.has(name), "duplicate header");
        headers.set(name, req.rawHeaders[i + 1]);
      }
      for (const name of headers.keys())
        assert(
          name !== "forwarded" &&
            !name.startsWith("x-forwarded-") &&
            !name.startsWith("proxy-"),
          "proxy metadata rejected",
        );
      assert.equal(headers.get("host"), url.host, "host");
      assert.equal(headers.get("origin"), origin, "origin");
      if (headers.has("sec-fetch-site"))
        assert.equal(headers.get("sec-fetch-site"), "same-origin");
      assert(!headers.has("cookie"), "bearer only");
      const auth = headers.get("authorization");
      assert(
        typeof auth === "string" && /^Bearer [0-9a-f]{64}$/.test(auth),
        "authorization",
      );
      const token = auth.slice(7);
      const identity = authorize(issuer.database, token, role, now());
      rate(identity.hash);
      assert(active < HTTP_LIMITS.inflight, "concurrency limit");
      active++;
      acquired = true;
      const began = performance.now();
      const guard = () => {
        assert(
          !abort.signal.aborted && performance.now() - began < deadlineMs,
          "request deadline",
        );
        authorize(issuer.database, token, role, now());
      };
      timer = setTimeout(() => {
        stop();
        res.once("finish", () => req.destroy());
        reply(503, { error: "unavailable" });
      }, deadlineMs);
      let body = {};
      if (req.method === "GET") {
        assert(
          !headers.has("transfer-encoding") &&
            (!headers.has("content-length") ||
              headers.get("content-length") === "0"),
          "GET body",
        );
      } else {
        assert.equal(headers.get("content-type"), "application/json");
        assert(!headers.has("content-encoding"), "encoded body");
        if (headers.has("content-length"))
          assert(
            /^[0-9]+$/.test(headers.get("content-length")) &&
              Number(headers.get("content-length")) <= HTTP_LIMITS.body,
            "body bound",
          );
        const chunks = [];
        let n = 0;
        for await (const chunk of req) {
          guard();
          n += chunk.length;
          assert(n <= HTTP_LIMITS.body, "body bound");
          chunks.push(chunk);
        }
        body = p.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
          HTTP_LIMITS.body,
        );
      }
      guard();
      const options = { signal: abort.signal, authorize: guard };
      let result;
      switch (req.url) {
        case "/api/ps/session":
          p.fields(body, "kind");
          result = { session: await issuer.session(body.kind, options) };
          break;
        case "/api/ps/submit":
          p.fields(body, "wire capability");
          result = {
            response: await issuer.submit(body.wire, body.capability, options),
          };
          break;
        case "/api/ps/recover":
          p.fields(body, "digest capability");
          result = { response: issuer.recover(body.digest, body.capability) };
          break;
        case "/api/ps/observe":
          p.fields(body, "wire");
          result = { receipt: await status.observe(body.wire, options) };
          break;
        case "/api/ps/receipt":
          p.fields(body, "wire");
          result = { receipt: status.recover(body.wire) };
          break;
        case "/ops/health":
          result = health(issuer, started);
          break;
        case "/ops/admission":
          p.fields(body, "enabled");
          issuer.setEnabled(body.enabled);
          result = { enabled: !!issuer.policy().enabled };
          break;
        case "/ops/grant":
          p.fields(body, "role ttl");
          result = grant(issuer.database, body.role, body.ttl, now());
          break;
        case "/ops/revoke":
          p.fields(body, "hash");
          revoke(issuer.database, body.hash);
          result = { revoked: true };
          break;
        case "/ops/retention":
          p.fields(body, "apply");
          result = pruneGrants(issuer.database, now(), { apply: body.apply });
          break;
      }
      // Authorization was rechecked at durable commits; this also protects read-only delayed release.
      guard();
      reply(200, result);
    } catch {
      stop();
      reply(400, { error: "request-rejected" });
      req.resume();
    } finally {
      clearTimeout(timer);
      req.off("aborted", stop);
      if (acquired) active--;
    }
  };
}

/** Bounded HTTP server construction only; caller must explicitly choose binding and TLS termination. */
export function createCandidateServer(runtime, options) {
  const server = http.createServer(
    {
      maxHeaderSize: 8192,
      headersTimeout: 5000,
      requestTimeout: 15000,
      keepAliveTimeout: 1000,
    },
    createServiceHandler(runtime, options),
  );
  server.maxConnections = 16;
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 1;
  return server;
}
