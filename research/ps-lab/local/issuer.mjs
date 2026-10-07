// In-process research issuer, no HTTP listener, wallet admission, chain or hosted keys.
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { store, transaction } from "./store.mjs";
import {
  canonical,
  parse,
  manifest,
  trust,
  bytes,
  hash,
  randomHex,
  randomScalar,
  scalarHex,
  encodedPoint,
  G1,
  mul,
  request,
  issueResponse,
  verifyShowing,
} from "./profile.mjs";
export class Issuer {
  constructor(
    path,
    realm,
    secrets,
    { now = () => Math.floor(Date.now() / 1000), boundary = () => {} } = {},
  ) {
    this.secrets = Object.freeze({ ...secrets });
    this.pinned = trust(manifest(realm, this.secrets));
    this.now = now;
    this.boundary = boundary;
    this.db = store(path, this.pinned, "issuer");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policy (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL);
      INSERT OR IGNORE INTO policy VALUES (1,1);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, wire TEXT NOT NULL, k TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (seq INTEGER PRIMARY KEY AUTOINCREMENT, digest TEXT UNIQUE NOT NULL, session TEXT UNIQUE NOT NULL REFERENCES sessions(id), recovery_hash TEXT NOT NULL, response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (tag TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS spent (keyset TEXT NOT NULL, nullifier TEXT NOT NULL, digest TEXT UNIQUE NOT NULL, PRIMARY KEY(keyset,nullifier));
    `);
  }
  close() {
    this.db.close();
  }
  setEnabled(enabled) {
    assert.equal(typeof enabled, "boolean");
    this.db
      .prepare("UPDATE policy SET enabled=? WHERE id=1")
      .run(Number(enabled));
  }
  enabled() {
    assert.equal(
      this.db.prepare("SELECT enabled FROM policy WHERE id=1").get().enabled,
      1,
      "issuer suspended",
    );
  }
  session(kind) {
    assert(["issue", "swap"].includes(kind), "session purpose");
    return transaction(this.db, () => {
      this.enabled();
      const now = this.now();
      const count = this.db
        .prepare(
          "SELECT count(*) AS n FROM sessions s WHERE expires>? AND NOT EXISTS (SELECT 1 FROM operations o WHERE o.session=s.id)",
        )
        .get(now).n;
      assert(count < 100, "active session limit");
      const k = randomScalar();
      const value = {
        protocol: this.pinned.manifest.protocol,
        realm: this.pinned.manifest.realm,
        keyset_id: this.pinned.pk.id,
        kind,
        session: randomHex(16),
        expires: now + 300,
        u: encodedPoint(mul(G1, k)),
      };
      this.db
        .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
        .run(value.session, canonical(value), scalarHex(k), value.expires);
      return value;
    });
  }
  recover(digest, capability) {
    bytes(digest, 32);
    const capabilityHash = hash(bytes(capability, 32));
    const row = this.db
      .prepare("SELECT recovery_hash,response FROM operations WHERE digest=?")
      .get(digest);
    if (!row) return null; // Unknown is not an authorization to generate a new request.
    assert(
      timingSafeEqual(bytes(row.recovery_hash, 32), bytes(capabilityHash, 32)),
      "recovery capability",
    );
    return row.response;
  }
  checkedSession(r) {
    const row = this.db
      .prepare("SELECT wire,k FROM sessions WHERE id=?")
      .get(r.session);
    assert(row, "unknown session");
    const s = parse(row.wire);
    for (const key of Object.keys(s))
      assert.equal(r[key], s[key], "session binding: " + key);
    return row;
  }
  submit(wire, capability) {
    // Bound before expensive proofs. Fast exact-result recovery survives retirement/expiry.
    const input = parse(wire),
      digest = hash(wire);
    assert.equal(
      input.recovery_hash,
      hash(bytes(capability, 32)),
      "request capability",
    );
    const old = this.recover(digest, capability);
    if (old !== null) return old;
    const { r, nullifier } = request(wire, this.pinned),
      s = this.checkedSession(r);
    this.enabled();
    assert(this.now() < r.expires, "session expired");
    const response = issueResponse(r, digest, s.k, this.secrets);
    const committed = transaction(this.db, () => {
      const winner = this.recover(digest, capability);
      if (winner !== null) return winner;
      this.checkedSession(r);
      this.enabled();
      assert(this.now() < r.expires, "session expired");
      assert(
        !this.db
          .prepare("SELECT 1 FROM operations WHERE session=?")
          .get(r.session),
        "session consumed",
      );
      if (r.kind === "issue") {
        assert(
          !this.db.prepare("SELECT 1 FROM assets WHERE tag=?").get(r.asset_tag),
          "duplicate asset",
        );
        this.db
          .prepare("INSERT INTO assets VALUES (?,?)")
          .run(r.asset_tag, digest);
      } else {
        assert(
          !this.db
            .prepare("SELECT 1 FROM spent WHERE keyset=? AND nullifier=?")
            .get(r.keyset_id, nullifier),
          "already spent",
        );
        this.db
          .prepare("INSERT INTO spent VALUES (?,?,?)")
          .run(r.keyset_id, nullifier, digest);
      }
      this.boundary("before-commit"); // Fault injection: spend exists only in the open transaction.
      this.db
        .prepare(
          "INSERT INTO operations (digest,session,recovery_hash,response) VALUES (?,?,?,?)",
        )
        .run(digest, r.session, r.recovery_hash, response);
      this.boundary("after-response-insert");
      return this.db
        .prepare("SELECT response FROM operations WHERE digest=?")
        .get(digest).response;
    });
    this.boundary("after-commit"); // A killed caller must recover the exact durable response.
    return committed;
  }
  checkShowing(wire, wallet, nonce, h) {
    const nullifier = verifyShowing(wire, wallet, nonce, h, this.pinned);
    const spent = !!this.db
      .prepare("SELECT 1 FROM spent WHERE keyset=? AND nullifier=?")
      .get(this.pinned.pk.id, nullifier);
    return {
      nullifier,
      state: spent ? "spent" : "unspent",
      walletAuthenticated: false,
    };
  }
  counts() {
    return Object.fromEntries(
      ["sessions", "operations", "assets", "spent"].map((name) => [
        name,
        this.db.prepare(`SELECT count(*) AS n FROM ${name}`).get().n,
      ]),
    );
  }
}
