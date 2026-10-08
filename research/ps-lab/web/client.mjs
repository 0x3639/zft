// Browser-owned credential state. Only encrypted journals reach persistence.
import assert from "./runtime.mjs";
import * as p from "./profile.mjs";
import { Client as Snapshot } from "./snapshot.mjs";
import { BrowserVault } from "./vault.mjs";
import { recordId } from "./schema.mjs";
import { FORMAT, MAX_CLEAR, sealState, openState } from "./client-cipher.mjs";
export const MAX_OPERATIONS = 8;
const credentialId = (c) => p.encodedPoint(p.mul(p.GN, p.scalar(c.s, true)));
const clone = (v) => p.parse(p.canonical(v), MAX_CLEAR);
function snapshot(wire, pinned) {
  return Snapshot.prototype.validateSnapshot.call({ pinned }, wire);
}
function validate(state, pinned, id) {
  p.fields(state, "format client_id manifest operations credentials");
  assert.equal(state.format, FORMAT);
  assert.equal(state.client_id, id);
  assert.equal(p.canonical(state.manifest), p.canonical(pinned.manifest));
  for (const map of [state.operations, state.credentials]) {
    assert(map && Object.getPrototypeOf(map) === Object.prototype);
    assert(Object.keys(map).length <= MAX_OPERATIONS, "journal capacity");
  }
  for (const [cid, row] of Object.entries(state.credentials)) {
    p.fields(row, "wire spent");
    assert(typeof row.spent === "boolean");
    const v = p.importBearer(row.wire, pinned);
    assert.equal(credentialId(v.credential), cid);
  }
  for (const [digest, row] of Object.entries(state.operations)) {
    p.fields(row, "snapshot backup_id backup_hash acknowledged response");
    const v = snapshot(row.snapshot, pinned);
    assert.equal(p.hash(v.wire), digest);
    assert(typeof row.acknowledged === "boolean");
    if (row.backup_id !== null) {
      p.bytes(row.backup_id, 16);
      p.bytes(row.backup_hash, 32);
    } else {
      assert.equal(row.backup_hash, null);
      assert.equal(row.acknowledged, false);
    }
    if (row.response !== null) {
      assert(row.acknowledged, "completed recovery gate");
      const c = p.finish(row.response, v, pinned),
        saved = state.credentials[credentialId(c)];
      assert(
        saved && saved.wire === p.bearer(p.bytes(v.asset), c, pinned),
        "completed credential",
      );
      if (v.source && state.credentials[credentialId(v.source)])
        assert(
          state.credentials[credentialId(v.source)].spent,
          "completed source spent",
        );
    }
  }
  assert(p.utf8(p.canonical(state)).length <= MAX_CLEAR, "journal size");
  return state;
}
export class BrowserClient {
  #state;
  #password;
  #persist;
  #epoch = 0;
  #pinned;
  #revision;
  constructor(state, password, revision, persist) {
    this.#pinned = p.trust(state.manifest);
    p.bytes(state.client_id, 16);
    this.#state = validate(state, this.#pinned, state.client_id);
    this.#password = password;
    this.#revision = revision;
    this.#persist = persist;
  }
  static async create(manifest, id, password, persist) {
    const c = new BrowserClient(
      {
        format: FORMAT,
        client_id: id,
        manifest,
        operations: {},
        credentials: {},
      },
      password,
      0,
      persist,
    );
    try {
      await c.#save(c.#state);
      return c;
    } catch (e) {
      c.lock();
      throw e;
    }
  }
  static async open(wire, password, manifest, id, revision, persist) {
    assert(Number.isSafeInteger(revision) && revision > 0, "revision");
    return new BrowserClient(
      validate(
        await openState(wire, password, manifest, id),
        p.trust(manifest),
        id,
      ),
      password,
      revision,
      persist,
    );
  }
  lock() {
    this.#epoch++;
    this.#state = null;
    this.#password = null;
  }
  #active(epoch = this.#epoch) {
    assert(this.#state && epoch === this.#epoch, "client locked");
  }
  async #save(next) {
    this.#active();
    validate(next, this.#pinned, this.#state.client_id);
    const epoch = this.#epoch,
      wire = await sealState(next, this.#password);
    this.#active(epoch);
    const revision = await this.#persist(wire, this.#revision);
    // The transaction may have committed during lock; never reopen afterward.
    this.#active(epoch);
    assert.equal(revision, this.#revision + 1, "commit revision");
    this.#revision = revision;
    this.#state = next;
  }
  summary() {
    this.#active();
    return {
      clientId: this.#state.client_id,
      revision: this.#revision,
      operations: Object.entries(this.#state.operations).map(([digest, r]) => ({
        digest,
        acknowledged: r.acknowledged,
        complete: r.response !== null,
        backupId: r.backup_id,
      })),
      credentials: Object.entries(this.#state.credentials).map(([id, r]) => ({
        id,
        locallySpent: r.spent,
      })),
    };
  }
  #row(digest) {
    this.#active();
    p.bytes(digest, 32);
    const r = this.#state.operations[digest];
    assert(r, "unknown operation");
    return r;
  }
  async #prepare(session, asset, source = null) {
    this.#active();
    assert(
      Object.keys(this.#state.operations).length < MAX_OPERATIONS,
      "operation capacity",
    );
    if (source)
      for (const r of Object.values(this.#state.operations)) {
        const old = snapshot(r.snapshot, this.#pinned);
        assert(
          !(
            old.source &&
            credentialId(old.source) === credentialId(source) &&
            r.response === null
          ),
          "source already pending",
        );
      }
    const h = p.assetValue(asset, this.#pinned),
      secret = p.scalarHex(p.randomScalar()),
      t = source ? p.scalarHex(p.randomScalar()) : null,
      capability = p.randomHex(32);
    const wire = source
      ? p.prepareSwap(session, source, secret, t, capability, this.#pinned)
      : p.prepareIssue(session, h, secret, capability, this.#pinned);
    const saved = p.canonical({
      ...this.#pinned.manifest,
      type: "pending",
      wire,
      asset: p.hex(asset),
      h,
      secret,
      t,
      capability,
      source,
    });
    snapshot(saved, this.#pinned);
    const digest = p.hash(wire),
      next = clone(this.#state);
    assert(!next.operations[digest]);
    next.operations[digest] = {
      snapshot: saved,
      backup_id: null,
      backup_hash: null,
      acknowledged: false,
      response: null,
    };
    await this.#save(next);
    return { digest };
  }
  prepareIssue(session, asset) {
    return this.#prepare(session, asset);
  }
  async prepareClaim(session, wire, password, expectedId) {
    this.#active();
    const epoch = this.#epoch;
    const v = await BrowserVault.open(
      wire,
      password,
      this.#pinned.manifest,
      expectedId,
    );
    try {
      this.#active(epoch);
      const records = v.list();
      assert.equal(records.length, 1);
      assert.equal(records[0].kind, "bearer");
      const old = p.importBearer(v.read(records[0].id).wire, this.#pinned);
      assert(
        !this.#state.credentials[credentialId(old.credential)]?.spent,
        "known spent",
      );
      return await this.#prepare(session, p.bytes(old.asset), old.credential);
    } finally {
      v.lock();
    }
  }
  prepareCancel(session, id) {
    const old = this.#credential(id);
    return this.#prepare(session, p.bytes(old.asset), old.credential);
  }
  #credential(id) {
    this.#active();
    p.point(id);
    const row = this.#state.credentials[id];
    assert(row && !row.spent, "unknown or spent");
    return p.importBearer(row.wire, this.#pinned);
  }
  async backup(digest, password) {
    const row = this.#row(digest),
      epoch = this.#epoch;
    assert(!row.acknowledged, "already acknowledged");
    const v = new BrowserVault(this.#pinned.manifest);
    try {
      v.add("recovery", row.snapshot);
      const wire = await v.seal(password);
      this.#active(epoch);
      const next = clone(this.#state);
      next.operations[digest].backup_id = v.id;
      next.operations[digest].backup_hash = p.hash(wire);
      await this.#save(next);
      return { wire, id: v.id };
    } finally {
      v.lock();
    }
  }
  async acknowledge(digest, wire, password) {
    const row = this.#row(digest),
      epoch = this.#epoch;
    assert.equal(p.hash(wire), row.backup_hash, "exact downloaded recovery");
    const v = await BrowserVault.open(
      wire,
      password,
      this.#pinned.manifest,
      row.backup_id,
    );
    try {
      this.#active(epoch);
      assert.equal(
        v.read(recordId("recovery", row.snapshot)).wire,
        row.snapshot,
        "exact snapshot",
      );
      const next = clone(this.#state);
      next.operations[digest].acknowledged = true;
      await this.#save(next);
    } finally {
      v.lock();
    }
  }
  async restore(wire, password, expectedId) {
    this.#active();
    const epoch = this.#epoch,
      v = await BrowserVault.open(
        wire,
        password,
        this.#pinned.manifest,
        expectedId,
      );
    try {
      this.#active(epoch);
      const records = v.list();
      assert.equal(records.length, 1);
      assert.equal(records[0].kind, "recovery");
      const saved = v.read(records[0].id).wire,
        pending = snapshot(saved, this.#pinned),
        digest = p.hash(pending.wire),
        next = clone(this.#state),
        old = next.operations[digest];
      if (old) assert.equal(old.snapshot, saved, "conflicting recovery");
      else {
        assert(
          Object.keys(next.operations).length < MAX_OPERATIONS,
          "operation capacity",
        );
        next.operations[digest] = {
          snapshot: saved,
          backup_id: v.id,
          backup_hash: p.hash(wire),
          acknowledged: true,
          response: null,
        };
      }
      next.operations[digest].acknowledged = true;
      // An existing prepared row might not yet have an export identity.
      if (!next.operations[digest].backup_id) {
        next.operations[digest].backup_id = v.id;
        next.operations[digest].backup_hash = p.hash(wire);
      }
      await this.#save(next);
      return { digest };
    } finally {
      v.lock();
    }
  }
  submission(digest, recover = false) {
    const row = this.#row(digest);
    assert(row.acknowledged, "recovery file required");
    const v = snapshot(row.snapshot, this.#pinned);
    return recover
      ? { action: "recover", digest, capability: v.capability }
      : { action: "submit", wire: v.wire, capability: v.capability };
  }
  async accept(digest, response) {
    const row = this.#row(digest);
    assert(row.acknowledged, "recovery file required");
    if (row.response !== null)
      assert.equal(row.response, response, "changed response");
    const v = snapshot(row.snapshot, this.#pinned),
      c = p.finish(response, v, this.#pinned),
      id = credentialId(c),
      wire = p.bearer(p.bytes(v.asset), c, this.#pinned),
      next = clone(this.#state);
    if (next.credentials[id])
      assert.equal(next.credentials[id].wire, wire, "conflicting credential");
    else next.credentials[id] = { wire, spent: false };
    if (v.source && next.credentials[credentialId(v.source)])
      next.credentials[credentialId(v.source)].spent = true;
    next.operations[digest].response = response;
    await this.#save(next);
    return { id };
  }
  async export(id, password) {
    const old = this.#credential(id),
      epoch = this.#epoch,
      v = new BrowserVault(this.#pinned.manifest);
    try {
      v.add(
        "bearer",
        p.bearer(p.bytes(old.asset), old.credential, this.#pinned),
      );
      const wire = await v.seal(password);
      this.#active(epoch);
      return { wire, id: v.id };
    } finally {
      v.lock();
    }
  }
}
