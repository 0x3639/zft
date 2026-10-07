// LOCAL RESEARCH ONLY: signed observations, not wallet authentication or spend authority.
import assert from "node:assert/strict";
import { createPublicKey, sign, verify } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { store, transaction } from "./store.mjs";
import {
  trust,
  canonical,
  parse,
  fields,
  bytes,
  hex,
  hash,
  utf8,
  randomHex,
  scalar,
  verifyShowing,
} from "./profile.mjs";

export const STATE_PROTOCOL = "zft-ps-local-state-v1";
export const STATE_TTL = 60;
export const STATE_LIMIT = 8192;
const LABEL = "ZFT_PS_Local_State_v1/";
const SPKI = "302a300506032b6570032100";
const CONTEXT =
  "protocol realm keyset_id ps_manifest_hash status_key_id purpose audience challenge wallet h created_at expires_at min_sequence";
const BODY =
  CONTEXT + " request_hash showing_hash nullifier state sequence observed_at";
const framed = (purpose, value) =>
  utf8(LABEL + purpose + "\0" + canonical(value));
function integer(n) {
  assert(
    Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0),
    "state integer",
  );
  return n;
}
function publicKey(raw) {
  bytes(raw, 32);
  const point = ed25519.Point.fromHex(raw, false);
  assert(
    !point.isSmallOrder() && point.isTorsionFree(),
    "state public key subgroup",
  );
  assert.equal(point.toHex(), raw, "canonical state public key");
  return createPublicKey({
    key: Buffer.from(SPKI + raw, "hex"),
    format: "der",
    type: "spki",
  });
}
export function stateManifest(psManifest, rawPublicKey) {
  const ps = trust(psManifest);
  publicKey(rawPublicKey);
  return Object.freeze({
    protocol: STATE_PROTOCOL,
    realm: ps.manifest.realm,
    keyset_id: ps.manifest.keyset_id,
    ps_manifest_hash: hash(canonical(ps.manifest)),
    algorithm: "Ed25519",
    public_key: rawPublicKey,
    status_key_id: hash(framed("key", rawPublicKey)),
  });
}
function pin(psManifest, manifest) {
  const m = parse(canonical(manifest), 2048);
  assert.equal(
    canonical(m),
    canonical(stateManifest(psManifest, m.public_key)),
    "pinned state manifest",
  );
  return {
    ps: trust(psManifest),
    manifest: Object.freeze(m),
    publicKey: publicKey(m.public_key),
  };
}
function scope(context, pinned) {
  for (const k of [
    "protocol",
    "realm",
    "keyset_id",
    "ps_manifest_hash",
    "status_key_id",
  ])
    assert.equal(context[k], pinned.manifest[k], "state scope: " + k);
}
function context(value, pinned) {
  fields(value, CONTEXT);
  scope(value, pinned);
  assert.equal(value.purpose, "credential-state", "state purpose");
  bytes(value.audience, 32); // Opaque caller-pinned application/context ID, never a URL.
  bytes(value.challenge, 32);
  bytes(value.wallet, 20);
  scalar(value.h);
  integer(value.created_at);
  integer(value.expires_at);
  integer(value.min_sequence);
  assert.equal(
    value.expires_at - value.created_at,
    STATE_TTL,
    "state lifetime",
  );
  return value;
}
function fresh(c, now) {
  integer(now);
  assert(
    now >= c.created_at && now < c.expires_at,
    "state challenge expired or clock behind",
  );
}
export function showingChallenge(c) {
  // Every observation context field is bound through the existing PS showing nonce.
  return hash(framed("show", c));
}
function checkedRequest(wire, pinned) {
  const r = parse(wire, STATE_LIMIT);
  fields(r, CONTEXT + " showing");
  const { showing, ...c } = r;
  context(c, pinned);
  const nullifier = verifyShowing(
    showing,
    c.wallet,
    showingChallenge(c),
    c.h,
    pinned.ps,
  );
  return { c, showing, nullifier };
}

export class StateIssuer {
  constructor(
    issuer,
    manifest,
    privateKey,
    { now = () => Math.floor(Date.now() / 1000) } = {},
  ) {
    this.issuer = issuer;
    this.pinned = pin(issuer.pinned.manifest, manifest);
    assert.equal(privateKey.type, "private", "private state key required");
    assert.equal(
      privateKey.asymmetricKeyType,
      "ed25519",
      "Ed25519 state key required",
    );
    const der = createPublicKey(privateKey).export({
      format: "der",
      type: "spki",
    });
    assert.equal(
      der.toString("hex"),
      SPKI + this.pinned.manifest.public_key,
      "state signing key mismatch",
    );
    this.privateKey = privateKey;
    this.now = now;
  }
  observe(wire) {
    const { c, showing, nullifier } = checkedRequest(wire, this.pinned);
    fresh(c, this.now());
    // Serialize with issuer writers; sequence and spent state belong to one snapshot.
    const body = transaction(this.issuer.db, () => {
      const observed_at = integer(this.now());
      fresh(c, observed_at);
      const sequence = integer(
        this.issuer.db
          .prepare("SELECT COALESCE(MAX(seq),0) AS n FROM operations")
          .get().n,
      );
      assert(sequence >= c.min_sequence, "issuer sequence behind observer");
      const spent = !!this.issuer.db
        .prepare("SELECT 1 FROM spent WHERE keyset=? AND nullifier=?")
        .get(c.keyset_id, nullifier);
      return {
        ...c,
        request_hash: hash(wire),
        showing_hash: hash(showing),
        nullifier,
        state: spent ? "spent" : "unspent",
        sequence,
        observed_at,
      };
    });
    const signature = hex(sign(null, framed("receipt", body), this.privateKey));
    return canonical({ body, signature });
  }
}

export class StateObserver {
  constructor(
    path,
    psManifest,
    manifest,
    { now = () => Math.floor(Date.now() / 1000), boundary = () => {} } = {},
  ) {
    this.pinned = pin(psManifest, manifest);
    this.now = now;
    this.boundary = boundary;
    // A separate store: it holds public proofs/observations, never credential secrets.
    this.db = store(
      path,
      {
        manifest: { ps: this.pinned.ps.manifest, state: this.pinned.manifest },
      },
      "state-observer",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS observation_clock (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL, time INTEGER NOT NULL);
      INSERT OR IGNORE INTO observation_clock VALUES (1,0,0);
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, context TEXT NOT NULL, expires INTEGER NOT NULL, wire TEXT, consumed INTEGER NOT NULL DEFAULT 0, receipt TEXT);
    `);
  }
  close() {
    this.db.close();
  }
  clock() {
    return this.db
      .prepare("SELECT sequence,time FROM observation_clock WHERE id=1")
      .get();
  }
  time() {
    const now = integer(this.now());
    assert(now >= this.clock().time, "observer clock rollback");
    return now;
  }
  row(challenge) {
    bytes(challenge, 32);
    const row = this.db
      .prepare("SELECT * FROM challenges WHERE id=?")
      .get(challenge);
    assert(row, "unknown state challenge");
    return row;
  }
  prepare(wallet, h, audience) {
    bytes(wallet, 20);
    scalar(h);
    bytes(audience, 32);
    const prepared = transaction(this.db, () => {
      const created_at = this.time(),
        clock = this.clock();
      const active = this.db
        .prepare(
          "SELECT count(*) AS n FROM challenges WHERE consumed=0 AND expires>?",
        )
        .get(created_at).n;
      assert(active < 100, "active state challenge limit");
      const { protocol, realm, keyset_id, ps_manifest_hash, status_key_id } =
        this.pinned.manifest;
      const c = context(
        {
          protocol,
          realm,
          keyset_id,
          ps_manifest_hash,
          status_key_id,
          purpose: "credential-state",
          wallet,
          h,
          audience,
          challenge: randomHex(32),
          created_at,
          expires_at: integer(created_at + STATE_TTL),
          min_sequence: clock.sequence,
        },
        this.pinned,
      );
      this.db
        .prepare("INSERT INTO challenges (id,context,expires) VALUES (?,?,?)")
        .run(c.challenge, canonical(c), c.expires_at);
      this.boundary("after-state-challenge-insert");
      this.db
        .prepare("UPDATE observation_clock SET time=? WHERE id=1")
        .run(created_at);
      return Object.freeze(c);
    });
    this.boundary("after-state-challenge-commit");
    return prepared;
  }
  request(challenge, showing) {
    parse(showing, STATE_LIMIT); // Bound the public API input before reserializing it.
    const row = this.row(challenge),
      c = context(parse(row.context), this.pinned);
    const wire = canonical({ ...c, showing });
    checkedRequest(wire, this.pinned);
    const saved = transaction(this.db, () => {
      const current = this.row(challenge),
        now = this.time();
      assert.equal(current.consumed, 0, "state challenge consumed");
      fresh(c, now);
      if (current.wire !== null)
        assert.equal(current.wire, wire, "state request already bound");
      this.db
        .prepare("UPDATE challenges SET wire=? WHERE id=?")
        .run(wire, challenge);
      this.boundary("after-state-request-write");
      this.db
        .prepare("UPDATE observation_clock SET time=? WHERE id=1")
        .run(now);
      return wire;
    });
    this.boundary("after-state-request-commit");
    return saved;
  }
  accept(challenge, receipt) {
    const row = this.row(challenge);
    assert.equal(row.consumed, 0, "state challenge consumed");
    assert(row.wire !== null, "state request not saved");
    const { c, showing, nullifier } = checkedRequest(row.wire, this.pinned);
    const envelope = parse(receipt, STATE_LIMIT);
    fields(envelope, "body signature");
    const { body, signature } = envelope;
    fields(body, BODY);
    bytes(signature, 64);
    assert(
      verify(
        null,
        framed("receipt", body),
        this.pinned.publicKey,
        bytes(signature),
      ),
      "state signature",
    );
    for (const k of Object.keys(c))
      assert.equal(body[k], c[k], "state context: " + k);
    assert.equal(body.request_hash, hash(row.wire), "state request digest");
    assert.equal(body.showing_hash, hash(showing), "state showing digest");
    assert.equal(body.nullifier, nullifier, "state nullifier");
    assert(["unspent", "spent"].includes(body.state), "state value");
    integer(body.sequence);
    integer(body.observed_at);
    assert(
      body.observed_at >= c.created_at && body.observed_at < c.expires_at,
      "observation time outside challenge",
    );
    this.boundary("before-state-accept");
    transaction(this.db, () => {
      const current = this.row(challenge),
        now = this.time();
      assert.equal(current.consumed, 0, "state challenge consumed");
      assert.equal(current.wire, row.wire, "state request changed");
      fresh(c, now);
      assert(body.observed_at <= now, "observation from future");
      assert(
        body.sequence >= Math.max(c.min_sequence, this.clock().sequence),
        "state sequence rollback",
      );
      this.db
        .prepare("UPDATE observation_clock SET sequence=?,time=? WHERE id=1")
        .run(body.sequence, now);
      this.boundary("after-state-watermark");
      this.db
        .prepare("UPDATE challenges SET consumed=1,receipt=? WHERE id=?")
        .run(receipt, challenge);
      this.boundary("before-state-receipt-commit");
    });
    this.boundary("after-state-commit");
    // This describes an issuer assertion at observedAt; it is not a spend reservation.
    return {
      issuerReported: body.state,
      observedAt: body.observed_at,
      expiresAt: c.expires_at,
      sequence: body.sequence,
      proofValid: true,
      walletAuthenticated: false,
    };
  }
}
