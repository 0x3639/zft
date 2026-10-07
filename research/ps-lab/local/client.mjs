// Plaintext, private SQLite lab client. No browser vault or production file format.
import assert from "node:assert/strict";
import { store, transaction } from "./store.mjs";
import {
  trust,
  canonical,
  parse,
  fields,
  scope,
  bytes,
  hex,
  hash,
  assetValue,
  randomHex,
  randomScalar,
  scalarHex,
  scalar,
  point,
  encodedPoint,
  credential,
  G1,
  GN,
  GA,
  mul,
  prepareIssue,
  prepareSwap,
  request,
  finish,
  bearer,
  importBearer,
  showing,
} from "./profile.mjs";
export class Client {
  constructor(path, manifest, { boundary = () => {} } = {}) {
    this.pinned = trust(manifest);
    this.boundary = boundary;
    this.db = store(path, this.pinned, "client");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending (digest TEXT PRIMARY KEY, snapshot TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, response TEXT, credential_id TEXT);
      CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, spent INTEGER NOT NULL DEFAULT 0);
    `);
  }
  close() {
    this.db.close();
  }
  validateSnapshot(snapshot) {
    const v = parse(snapshot, 300000);
    fields(
      v,
      "protocol realm keyset_id public_key type wire asset h secret t capability source",
    );
    scope(v, this.pinned);
    assert.equal(
      v.public_key,
      this.pinned.manifest.public_key,
      "pinned parameters",
    );
    assert.equal(v.type, "pending");
    assert.equal(assetValue(bytes(v.asset), this.pinned), v.h, "pending asset");
    scalar(v.secret, true);
    bytes(v.capability, 32);
    const { r, nullifier } = request(v.wire, this.pinned);
    assert.equal(
      r.recovery_hash,
      hash(bytes(v.capability)),
      "pending capability",
    );
    assert.equal(
      r.s,
      encodedPoint(mul(G1, scalar(v.secret, true))),
      "pending destination",
    );
    if (r.kind === "issue") {
      assert.equal(v.source, null);
      assert.equal(v.t, null);
      assert.equal(
        r.asset_tag,
        encodedPoint(mul(GA, scalar(v.h))),
        "pending asset tag",
      );
      assert.equal(
        r.b,
        encodedPoint(mul(this.pinned.pk.Yh1, scalar(v.h))),
        "pending commitment",
      );
    } else {
      fields(v.source, "keyset_id u v h s");
      credential(v.source, this.pinned.pk);
      assert.equal(v.source.h, v.h, "source asset");
      assert.equal(
        nullifier,
        encodedPoint(mul(GN, scalar(v.source.s, true))),
        "source nullifier",
      );
      assert.equal(
        r.b,
        encodedPoint(
          mul(point(r.u), scalar(v.h)).add(mul(G1, scalar(v.t, true))),
        ),
        "pending unblinding",
      );
      assert.notEqual(v.secret, v.source.s, "fresh destination secret");
    }
    return v;
  }
  savePending(s, asset, source = null) {
    const h = assetValue(asset, this.pinned),
      secret = scalarHex(randomScalar()),
      capability = randomHex(32);
    const t = source ? scalarHex(randomScalar()) : null;
    const wire = source
      ? prepareSwap(s, source, secret, t, capability, this.pinned)
      : prepareIssue(s, h, secret, capability, this.pinned);
    const snapshot = canonical({
      ...this.pinned.manifest,
      type: "pending",
      wire,
      asset: hex(asset),
      h,
      secret,
      t,
      capability,
      source,
    });
    this.validateSnapshot(snapshot);
    const digest = hash(wire);
    this.db
      .prepare("INSERT INTO pending (digest,snapshot) VALUES (?,?)")
      .run(digest, snapshot);
    return digest;
  }
  prepareIssue(s, asset) {
    return this.savePending(s, asset);
  }
  prepareClaim(s, envelope) {
    const old = importBearer(envelope, this.pinned);
    return this.savePending(s, bytes(old.asset), old.credential);
  }
  prepareCancel(s, id) {
    return this.prepareClaim(s, this.export(id));
  }
  pending(digest) {
    bytes(digest, 32);
    const row = this.db
      .prepare("SELECT * FROM pending WHERE digest=?")
      .get(digest);
    assert(row, "unknown local operation");
    return row;
  }
  backup(digest) {
    return this.pending(digest).snapshot;
  }
  acknowledge(digest, snapshotHash) {
    assert.equal(
      hash(this.backup(digest)),
      snapshotHash,
      "exact recovery snapshot acknowledgment",
    );
    this.db
      .prepare("UPDATE pending SET acknowledged=1 WHERE digest=?")
      .run(digest);
  }
  restore(snapshot) {
    const v = this.validateSnapshot(snapshot),
      digest = hash(v.wire);
    // Restoring proves availability of this exact snapshot, without a wallet signature.
    transaction(this.db, () => {
      const row = this.db
        .prepare("SELECT snapshot FROM pending WHERE digest=?")
        .get(digest);
      if (row) {
        assert.equal(row.snapshot, snapshot, "conflicting local recovery");
        this.db
          .prepare("UPDATE pending SET acknowledged=1 WHERE digest=?")
          .run(digest);
      } else
        this.db
          .prepare(
            "INSERT INTO pending (digest,snapshot,acknowledged) VALUES (?,?,1)",
          )
          .run(digest, snapshot);
    });
    return digest;
  }
  submit(digest, issuer) {
    const row = this.pending(digest);
    assert.equal(row.acknowledged, 1, "recovery snapshot required");
    const v = this.validateSnapshot(row.snapshot);
    const response = issuer.submit(v.wire, v.capability);
    return this.accept(digest, response);
  }
  recover(digest, issuer) {
    const row = this.pending(digest);
    assert.equal(row.acknowledged, 1, "recovery snapshot required");
    const v = this.validateSnapshot(row.snapshot),
      response = issuer.recover(digest, v.capability);
    assert(
      response !== null,
      "unknown issuer operation; preserve pending request",
    );
    return this.accept(digest, response);
  }
  accept(digest, response) {
    const row = this.pending(digest);
    assert.equal(row.acknowledged, 1, "recovery snapshot required");
    const v = this.validateSnapshot(row.snapshot),
      c = finish(response, v, this.pinned);
    const id = encodedPoint(mul(GN, scalar(c.s, true))),
      envelope = bearer(bytes(v.asset), c, this.pinned);
    this.boundary("before-client-save");
    transaction(this.db, () => {
      const current = this.pending(digest);
      if (current.response !== null)
        assert.equal(current.response, response, "changed committed response");
      const old = this.db
        .prepare("SELECT envelope FROM credentials WHERE id=?")
        .get(id);
      if (old) assert.equal(old.envelope, envelope, "conflicting credential");
      else
        this.db
          .prepare("INSERT INTO credentials (id,envelope) VALUES (?,?)")
          .run(id, envelope);
      if (v.source)
        this.db
          .prepare("UPDATE credentials SET spent=1 WHERE id=?")
          .run(encodedPoint(mul(GN, scalar(v.source.s, true))));
      this.db
        .prepare("UPDATE pending SET response=?,credential_id=? WHERE digest=?")
        .run(response, id, digest);
    });
    return id;
  }
  export(id) {
    point(id);
    const row = this.db
      .prepare("SELECT envelope,spent FROM credentials WHERE id=?")
      .get(id);
    assert(row, "unknown credential");
    assert.equal(row.spent, 0, "known spent credential");
    importBearer(row.envelope, this.pinned);
    return row.envelope;
  }
  show(id, wallet, nonce) {
    const { credential: c } = importBearer(this.export(id), this.pinned);
    return showing(c, wallet, nonce, this.pinned);
  }
}
