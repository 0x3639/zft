// Durable asynchronous historical observations, compatible with the frozen StateObserver.
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import * as p from "../local/profile.mjs";
import {
  stateManifest,
  STATE_TTL,
  STATE_LIMIT,
  showingChallenge,
} from "../local/state.mjs";
import { StatusSigner } from "../local/status-signer.mjs";
import { transaction } from "./store.mjs";
import { SERVICE_LIMITS } from "./issuer.mjs";
import { failure } from "./boundary.mjs";
const CONTEXT =
  "protocol realm keyset_id ps_manifest_hash status_key_id purpose audience challenge wallet h created_at expires_at min_sequence";
const fail = (c) => failure("STATUS_SERVICE", c);
const integer = (n) => {
  assert(
    Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0),
    "state integer",
  );
  return n;
};
const framed = (body) =>
  p.utf8("ZFT_PS_Local_State_v1/receipt\0" + p.canonical(body));

/** Persist the original observation snapshot before signing and the exact receipt before release. */
export class ServiceStatus {
  #issuer;
  #publicKey;
  #manifest;
  #signer;
  #now;
  #boundary;
  #closed = false;
  #active = new Set();
  constructor(
    issuer,
    {
      manifest,
      keyId,
      transport,
      timeoutMs = 5000,
      now = () => Math.floor(Date.now() / 1000),
      boundary = () => {},
    },
  ) {
    this.#issuer = issuer;
    this.#manifest = stateManifest(issuer.manifest, manifest.public_key);
    assert.equal(
      p.canonical(this.#manifest),
      p.canonical(manifest),
      "status manifest pin",
    );
    this.#publicKey = createPublicKey({
      key: Buffer.from("302a300506032b6570032100" + manifest.public_key, "hex"),
      type: "spki",
      format: "der",
    });
    this.#signer = {
      psManifest: issuer.manifest,
      manifest,
      keyId,
      transport,
      timeoutMs,
    };
    const probe = new StatusSigner(this.#signer);
    probe.close();
    this.#now = now;
    this.#boundary = boundary;
  }
  #check() {
    if (this.#closed) throw fail("CLOSED");
  }
  #request(wire) {
    const r = p.parse(wire, STATE_LIMIT);
    p.fields(r, CONTEXT + " showing");
    const { showing, ...context } = r;
    for (const k of [
      "protocol",
      "realm",
      "keyset_id",
      "ps_manifest_hash",
      "status_key_id",
    ])
      assert.equal(context[k], this.#manifest[k], "state scope");
    assert.equal(context.purpose, "credential-state");
    p.bytes(context.audience, 32);
    p.bytes(context.challenge, 32);
    p.bytes(context.wallet, 20);
    p.scalar(context.h);
    integer(context.created_at);
    integer(context.expires_at);
    integer(context.min_sequence);
    assert.equal(context.expires_at - context.created_at, STATE_TTL);
    const report = this.#issuer.checkShowing(
      showing,
      context.wallet,
      showingChallenge(context),
      context.h,
    );
    return {
      context,
      showing,
      nullifier: report.nullifier,
      hash: p.hash(wire),
    };
  }
  #body(wire, r) {
    const body = p.parse(wire, STATE_LIMIT);
    p.fields(
      body,
      CONTEXT +
        " request_hash showing_hash nullifier state sequence observed_at",
    );
    for (const key of Object.keys(r.context))
      assert.equal(body[key], r.context[key], "saved observation context");
    assert.equal(body.request_hash, r.hash, "saved request hash");
    assert.equal(body.showing_hash, p.hash(r.showing), "saved showing hash");
    assert.equal(body.nullifier, r.nullifier, "saved nullifier");
    assert(["spent", "unspent"].includes(body.state), "saved state");
    integer(body.sequence);
    integer(body.observed_at);
    assert(body.sequence >= r.context.min_sequence, "saved sequence");
    assert(
      body.observed_at >= r.context.created_at &&
        body.observed_at < r.context.expires_at,
      "saved observation time",
    );
    return body;
  }
  #receipt(wire, r, bodyWire) {
    const value = p.parse(wire, STATE_LIMIT);
    p.fields(value, "body signature");
    assert.equal(p.canonical(value.body), bodyWire, "saved receipt body");
    const body = this.#body(bodyWire, r);
    assert(
      verify(null, framed(body), this.#publicKey, p.bytes(value.signature, 64)),
      "saved receipt signature",
    );
    return wire;
  }
  #fresh(c) {
    const now = integer(this.#now());
    assert(
      now >= c.created_at && now < c.expires_at,
      "state challenge expired or clock behind",
    );
    return now;
  }
  #admitted(generation) {
    const current = this.#issuer.policy();
    assert.equal(current.enabled, 1, "issuer suspended");
    assert.equal(current.restore_required, 0, "restore review required");
    if (generation !== undefined)
      assert.equal(current.generation, generation, "admission changed");
    return current.generation;
  }
  recover(wire) {
    this.#check();
    const r = this.#request(wire);
    const row = this.#issuer.database
      .prepare("SELECT body,receipt FROM observations WHERE request_hash=?")
      .get(r.hash);
    return row?.receipt ? this.#receipt(row.receipt, r, row.body) : null;
  }
  async observe(wire, { signal, authorize = () => {} } = {}) {
    this.#check();
    if (signal !== undefined && !(signal instanceof AbortSignal))
      throw fail("INPUT");
    if (signal?.aborted) throw fail("CANCELLED");
    const r = this.#request(wire),
      generation = this.#admitted();
    this.#fresh(r.context);
    const db = this.#issuer.database;
    const saved = transaction(db, () => {
      this.#admitted(generation);
      authorize();
      const observed_at = this.#fresh(r.context);
      const existing = db
        .prepare(
          "SELECT request_hash,body,receipt FROM observations WHERE challenge=?",
        )
        .get(r.context.challenge);
      if (existing) {
        assert.equal(existing.request_hash, r.hash, "challenge already bound");
        return { body: existing.body, receipt: existing.receipt };
      }
      assert(
        this.#issuer.counts().observations < SERVICE_LIMITS.observations,
        "observation capacity",
      );
      const sequence = integer(
        db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM operations").get().n,
      );
      assert(
        sequence >= r.context.min_sequence,
        "issuer sequence behind observer",
      );
      const spent = !!db
        .prepare("SELECT 1 FROM spent WHERE keyset=? AND nullifier=?")
        .get(r.context.keyset_id, r.nullifier);
      const body = p.canonical({
        ...r.context,
        request_hash: r.hash,
        showing_hash: p.hash(r.showing),
        nullifier: r.nullifier,
        state: spent ? "spent" : "unspent",
        sequence,
        observed_at,
      });
      db.prepare(
        "INSERT INTO observations(request_hash,challenge,body) VALUES(?,?,?)",
      ).run(r.hash, r.context.challenge, body);
      this.#boundary("before-observation-snapshot-commit");
      return { body, receipt: null };
    });
    this.#boundary("after-observation-snapshot-commit");
    if (saved.receipt !== null)
      return this.#receipt(saved.receipt, r, saved.body);
    if (this.#active.size >= SERVICE_LIMITS.inflight) throw fail("BUSY");
    const signer = new StatusSigner(this.#signer);
    this.#active.add(signer);
    try {
      const body = this.#body(saved.body, r),
        signature = await signer.sign(framed(body), { signal });
      this.#boundary("after-observation-sign");
      this.#check();
      if (signal?.aborted) throw fail("CANCELLED");
      const receipt = p.canonical({ body, signature });
      const committed = transaction(this.#issuer.database, () => {
        this.#admitted(generation);
        authorize();
        const now = this.#fresh(r.context);
        assert(now >= body.observed_at, "state clock behind snapshot");
        const current = db
          .prepare("SELECT body,receipt FROM observations WHERE request_hash=?")
          .get(r.hash);
        assert(
          current && current.body === saved.body,
          "observation snapshot changed",
        );
        if (current.receipt !== null)
          return this.#receipt(current.receipt, r, current.body);
        db.prepare(
          "UPDATE observations SET receipt=? WHERE request_hash=?",
        ).run(receipt, r.hash);
        this.#boundary("before-observation-receipt-commit");
        return receipt;
      });
      this.#boundary("after-observation-receipt-commit");
      return committed;
    } finally {
      signer.close();
      this.#active.delete(signer);
    }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const signer of this.#active) signer.close();
  }
}
