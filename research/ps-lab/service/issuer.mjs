// Async service candidate. Custody runs outside transactions; authoritative checks repeat at commit.
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import * as p from "../local/profile.mjs";
import { transaction, openServiceStore } from "./store.mjs";
import { PsExecutor } from "./executor.mjs";
import { failure } from "./boundary.mjs";
export const SERVICE_LIMITS = Object.freeze({
  sessions: 512,
  activeSessions: 100,
  operations: 128,
  inflight: 4,
  observations: 256,
});
const fail = (c) => failure("SERVICE", c);
/** Separate encrypted-session issuer retaining the frozen client's existing wire protocol. */
export class ServiceIssuer {
  #pinned;
  #config;
  #transport;
  #timeout;
  #now;
  #boundary;
  #closed = false;
  #active = new Set();
  #db;
  constructor(
    path,
    {
      manifest,
      configurationId,
      transport,
      timeoutMs = 5000,
      now = () => Math.floor(Date.now() / 1000),
      boundary = () => {},
    },
  ) {
    this.#pinned = p.trust(manifest);
    this.#config = configurationId;
    this.#transport = transport;
    this.#timeout = timeoutMs;
    this.#now = now;
    this.#boundary = boundary;
    const check = new PsExecutor({
      manifest,
      configurationId,
      transport,
      timeoutMs,
    });
    check.close();
    this.#db = openServiceStore(path, manifest, configurationId);
  }
  get manifest() {
    return this.#pinned.manifest;
  }
  // Internal cooperating status/backup adapters only. Never expose the connection to an HTTP client.
  get database() {
    this.#check();
    return this.#db;
  }
  #check() {
    if (this.#closed) throw fail("CLOSED");
  }
  time() {
    const now = this.#now();
    assert(
      Number.isSafeInteger(now) && now >= 0 && !Object.is(now, -0),
      "service time",
    );
    return now;
  }
  policy() {
    this.#check();
    return this.#db
      .prepare(
        "SELECT enabled,generation,restore_required FROM policy WHERE id=1",
      )
      .get();
  }
  setEnabled(enabled) {
    this.#check();
    assert.equal(typeof enabled, "boolean");
    if (enabled)
      assert.equal(
        this.policy().restore_required,
        0,
        "restore review required",
      );
    this.#db
      .prepare("UPDATE policy SET enabled=?,generation=generation+1 WHERE id=1")
      .run(Number(enabled));
  }
  #admitted(generation) {
    const policy = this.policy();
    assert.equal(policy.enabled, 1, "issuer suspended");
    assert.equal(policy.restore_required, 0, "restore review required");
    if (generation !== undefined)
      assert.equal(policy.generation, generation, "admission changed");
    return policy.generation;
  }
  #executor() {
    this.#check();
    if (this.#active.size >= SERVICE_LIMITS.inflight) throw fail("BUSY");
    const e = new PsExecutor({
      manifest: this.manifest,
      configurationId: this.#config,
      transport: this.#transport,
      timeoutMs: this.#timeout,
    });
    this.#active.add(e);
    return e;
  }
  counts() {
    this.#check();
    return Object.fromEntries(
      ["sessions", "operations", "assets", "spent", "observations"].map(
        (name) => [
          name,
          this.#db.prepare("SELECT count(*) AS n FROM " + name).get().n,
        ],
      ),
    );
  }
  async session(kind, { signal, authorize = () => {} } = {}) {
    this.#check();
    assert(["issue", "swap"].includes(kind), "session kind");
    const generation = this.#admitted(),
      created = this.time();
    const cap = () => {
      assert(this.counts().sessions < SERVICE_LIMITS.sessions, "session limit");
      assert(
        this.#db
          .prepare(
            "SELECT count(*) AS n FROM sessions s WHERE expires>? AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.session=s.id)",
          )
          .get(this.time()).n < SERVICE_LIMITS.activeSessions,
        "active session limit",
      );
    };
    cap();
    const header = {
      protocol: this.manifest.protocol,
      realm: this.manifest.realm,
      keyset_id: this.manifest.keyset_id,
      kind,
      session: p.randomHex(16),
      expires: created + 300,
    };
    const e = this.#executor();
    try {
      const result = await e.session(header, { signal });
      this.#boundary("after-session-custody");
      this.#check();
      if (signal?.aborted) throw fail("CANCELLED");
      transaction(this.#db, () => {
        this.#admitted(generation);
        authorize();
        assert(
          this.time() >= created && this.time() < header.expires,
          "session expired or clock behind",
        );
        cap();
        this.#db
          .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
          .run(header.session, result.wire, result.protected, header.expires);
        this.#boundary("before-session-commit");
      });
      this.#boundary("after-session-commit");
      return p.parse(result.wire);
    } finally {
      e.close();
      this.#active.delete(e);
    }
  }
  recover(digest, capability) {
    this.#check();
    p.bytes(digest, 32);
    const hash = p.hash(p.bytes(capability, 32));
    const row = this.#db
      .prepare("SELECT recovery_hash,response FROM operations WHERE digest=?")
      .get(digest);
    if (!row) return null;
    assert(
      timingSafeEqual(p.bytes(row.recovery_hash, 32), p.bytes(hash, 32)),
      "recovery capability",
    );
    return row.response;
  }
  #session(r) {
    const row = this.#db
      .prepare("SELECT wire,protected FROM sessions WHERE id=?")
      .get(r.session);
    assert(row, "unknown session");
    const s = p.parse(row.wire, 2048);
    for (const k of Object.keys(s)) assert.equal(s[k], r[k], "session binding");
    return { wire: row.wire, protected: row.protected };
  }
  async submit(wire, capability, { signal, authorize = () => {} } = {}) {
    this.#check();
    const input = p.parse(wire),
      digest = p.hash(wire);
    assert.equal(
      input.recovery_hash,
      p.hash(p.bytes(capability, 32)),
      "request capability",
    );
    const prior = this.recover(digest, capability);
    if (prior !== null) return prior;
    const { r, nullifier } = p.request(wire, this.#pinned),
      session = this.#session(r),
      generation = this.#admitted(),
      started = this.time();
    assert(started < r.expires, "session expired");
    assert(
      this.counts().operations < SERVICE_LIMITS.operations,
      "operation limit",
    );
    const e = this.#executor();
    try {
      const response = await e.respond(wire, session, { signal });
      this.#boundary("after-response-custody");
      this.#check();
      if (signal?.aborted) throw fail("CANCELLED");
      const committed = transaction(this.#db, () => {
        const winner = this.recover(digest, capability);
        if (winner !== null) return winner;
        assert.equal(
          p.canonical(this.#session(r)),
          p.canonical(session),
          "stored session changed",
        );
        this.#admitted(generation);
        authorize();
        const now = this.time();
        assert(
          now >= started && now < r.expires,
          "session expired or clock behind",
        );
        assert(
          this.counts().operations < SERVICE_LIMITS.operations,
          "operation limit",
        );
        assert(
          !this.#db
            .prepare("SELECT 1 FROM operations WHERE session=?")
            .get(r.session),
          "session consumed",
        );
        if (r.kind === "issue") {
          assert(
            !this.#db
              .prepare("SELECT 1 FROM assets WHERE tag=?")
              .get(r.asset_tag),
            "duplicate asset",
          );
          this.#db
            .prepare("INSERT INTO assets VALUES(?,?)")
            .run(r.asset_tag, digest);
        } else {
          assert(
            !this.#db
              .prepare("SELECT 1 FROM spent WHERE keyset=? AND nullifier=?")
              .get(r.keyset_id, nullifier),
            "already spent",
          );
          this.#db
            .prepare("INSERT INTO spent VALUES(?,?,?)")
            .run(r.keyset_id, nullifier, digest);
        }
        this.#boundary("before-response-insert");
        this.#db
          .prepare(
            "INSERT INTO operations(digest,session,recovery_hash,response) VALUES(?,?,?,?)",
          )
          .run(digest, r.session, r.recovery_hash, response);
        this.#boundary("before-response-commit");
        return response;
      });
      this.#boundary("after-response-commit");
      return committed;
    } finally {
      e.close();
      this.#active.delete(e);
    }
  }
  checkShowing(wire, wallet, nonce, h) {
    this.#check();
    const nullifier = p.verifyShowing(wire, wallet, nonce, h, this.#pinned);
    const spent = !!this.#db
      .prepare("SELECT 1 FROM spent WHERE keyset=? AND nullifier=?")
      .get(this.manifest.keyset_id, nullifier);
    return {
      nullifier,
      state: spent ? "spent" : "unspent",
      walletAuthenticated: false,
    };
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const e of this.#active) e.close();
    this.#db.close();
  }
}
