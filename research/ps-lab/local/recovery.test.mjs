// Local storage-failure qualification; public test keys and disposable databases only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import * as p from "./profile.mjs";
import { asset, fixture, pending, child, job } from "./test-support.mjs";
import { fullAt, sqliteError, integrity } from "./fault-support.mjs";

async function killed(job) {
  const c = child(job);
  await c.ready;
  c.run();
  const result = await c.done;
  assert.equal(result.signal, "SIGKILL", result.stderr);
  assert.equal(
    result.message,
    undefined,
    "no result exposed before interruption",
  );
}
function clientJob(f, extra) {
  return {
    client: true,
    path: join(f.dir, "a.db"),
    manifest: f.issuer.pinned.manifest,
    ...extra,
  };
}
function state(c, digest) {
  return {
    pending: c.pending(digest),
    credentials: c.db.prepare("SELECT * FROM credentials ORDER BY id").all(),
  };
}
function replacement(f) {
  const old = f.mint(),
    digest = f.a.prepareCancel(f.issuer.session("swap"), old);
  f.acknowledge(f.a, digest);
  const v = pending(f.a, digest),
    response = f.issuer.submit(v.wire, v.capability);
  return { old, digest, response };
}
function completed(f, c, { old, digest, response }) {
  const id = c.recover(digest, f.issuer);
  assert.notEqual(id, old);
  p.importBearer(c.export(id), c.pinned);
  assert.throws(() => c.export(old), /known spent/);
  assert.equal(c.pending(digest).response, response);
  assert.equal(c.pending(digest).credential_id, id);
  assert.equal(f.issuer.counts().operations, 2);
  assert.equal(f.issuer.counts().spent, 1);
  integrity(c.db);
  return id;
}

for (const crash of ["before-pending-save", "after-pending-save"])
  test(`SIGKILL ${crash} never submits an unacknowledged request`, async (t) => {
    const f = fixture(t),
      session = f.issuer.session("issue");
    f.a.close();
    await killed(
      clientJob(f, { action: "prepare", session, asset: [...asset], crash }),
    );
    const c = f.client("a"),
      rows = c.db.prepare("SELECT * FROM pending").all();
    assert.equal(rows.length, crash === "before-pending-save" ? 0 : 1);
    assert.equal(f.issuer.counts().operations, 0);
    if (rows.length) {
      const { digest, snapshot, acknowledged } = rows[0];
      assert.equal(acknowledged, 0);
      assert.throws(
        () => c.submit(digest, f.issuer),
        /recovery snapshot required/,
      );
      assert.equal(c.validateSnapshot(snapshot).wire, pending(c, digest).wire);
      f.acknowledge(c, digest);
      p.importBearer(c.export(c.submit(digest, f.issuer)), c.pinned);
      assert.equal(c.backup(digest), snapshot);
    }
    integrity(c.db);
  });

for (const crash of ["before-acknowledge", "after-acknowledge"])
  test(`SIGKILL ${crash} preserves the exact backup gate`, async (t) => {
    const f = fixture(t),
      digest = f.a.prepareIssue(f.issuer.session("issue"), asset),
      snapshot = f.a.backup(digest);
    f.a.close();
    await killed(
      clientJob(f, {
        action: "acknowledge",
        digest,
        snapshotHash: p.hash(snapshot),
        crash,
      }),
    );
    const c = f.client("a");
    assert.equal(c.backup(digest), snapshot);
    assert.equal(
      c.pending(digest).acknowledged,
      crash === "before-acknowledge" ? 0 : 1,
    );
    assert.equal(f.issuer.counts().operations, 0);
    if (crash === "before-acknowledge")
      assert.throws(
        () => c.submit(digest, f.issuer),
        /recovery snapshot required/,
      );
    f.acknowledge(c, digest);
    c.submit(digest, f.issuer);
    integrity(c.db);
  });

for (const crash of ["before-restore-commit", "after-restore-commit"])
  test(`SIGKILL ${crash} restores a complete snapshot or nothing`, async (t) => {
    const f = fixture(t),
      digest = f.b.prepareIssue(f.issuer.session("issue"), asset),
      snapshot = f.b.backup(digest),
      v = pending(f.b, digest);
    const response = f.issuer.submit(v.wire, v.capability);
    f.a.close();
    await killed(clientJob(f, { action: "restore", snapshot, crash }));
    const c = f.client("a");
    if (crash === "before-restore-commit")
      assert.throws(() => c.pending(digest), /unknown local/);
    else {
      assert.equal(c.backup(digest), snapshot);
      assert.equal(c.pending(digest).acknowledged, 1);
    }
    assert.equal(c.restore(snapshot), digest);
    c.recover(digest, f.issuer);
    assert.equal(c.pending(digest).response, response);
    assert.equal(f.issuer.counts().operations, 1);
    integrity(c.db);
  });

for (const crash of [
  "after-credential-insert",
  "after-source-spent",
  "before-client-commit",
  "after-client-commit",
])
  test(`SIGKILL ${crash} keeps client replacement atomic`, async (t) => {
    const f = fixture(t),
      op = replacement(f),
      before = state(f.a, op.digest);
    f.a.close();
    await killed(clientJob(f, { ...op, crash }));
    const c = f.client("a");
    if (crash !== "after-client-commit")
      assert.deepEqual(state(c, op.digest), before);
    else {
      assert.equal(c.pending(op.digest).response, op.response);
      assert.equal(
        c.db.prepare("SELECT count(*) AS n FROM credentials").get().n,
        2,
      );
      assert.throws(() => c.export(op.old), /known spent/);
      p.importBearer(c.export(c.pending(op.digest).credential_id), c.pinned);
    }
    completed(f, c, op);
    assert.equal(c.backup(op.digest), before.pending.snapshot);
  });

test("SIGKILL after-response-insert rolls back the entire issuer operation", async (t) => {
  const f = fixture(t),
    old = f.mint(),
    digest = f.b.prepareClaim(f.issuer.session("swap"), f.a.export(old));
  f.acknowledge(f.b, digest);
  const before = f.issuer.counts(),
    v = pending(f.b, digest);
  await killed(job(f, f.b, digest, "after-response-insert"));
  f.issuer.close();
  const issuer = f.openIssuer();
  assert.deepEqual(issuer.counts(), before);
  assert.equal(issuer.recover(digest, v.capability), null);
  f.b.submit(digest, issuer);
  assert.equal(issuer.counts().spent, 1);
  assert.equal(issuer.counts().operations, 2);
  integrity(issuer.db);
});

test("SQLITE_FULL while saving pending material exposes no operation", (t) => {
  const f = fixture(t),
    session = f.issuer.session("issue"),
    clear = fullAt(f.a.db, "INSERT ON pending", () =>
      f.a.prepareIssue(session, asset),
    );
  assert.equal(f.a.db.prepare("SELECT count(*) AS n FROM pending").get().n, 0);
  assert.equal(f.issuer.counts().operations, 0);
  clear();
  const digest = f.a.prepareIssue(session, asset);
  assert.equal(f.a.pending(digest).acknowledged, 0);
  f.acknowledge(f.a, digest);
  f.a.submit(digest, f.issuer);
});

test("read-only acknowledgment fails closed and retains recovery bytes", (t) => {
  const f = fixture(t),
    digest = f.a.prepareIssue(f.issuer.session("issue"), asset),
    before = state(f.a, digest);
  f.a.db.exec("PRAGMA query_only=ON");
  sqliteError(() => f.acknowledge(f.a, digest), 8);
  assert.deepEqual(state(f.a, digest), before);
  assert.throws(
    () => f.a.submit(digest, f.issuer),
    /recovery snapshot required/,
  );
  assert.equal(f.issuer.counts().operations, 0);
  f.a.db.exec("PRAGMA query_only=OFF");
  f.acknowledge(f.a, digest);
  f.a.submit(digest, f.issuer);
});

for (const kind of ["issue", "swap"])
  test(`SQLITE_FULL at ${kind} response insertion rolls back reservation or spend`, (t) => {
    const f = fixture(t),
      digest =
        kind === "issue"
          ? f.a.prepareIssue(f.issuer.session("issue"), asset)
          : f.a.prepareCancel(f.issuer.session("swap"), f.mint());
    f.acknowledge(f.a, digest);
    const v = pending(f.a, digest),
      before = f.issuer.counts(),
      local = state(f.a, digest),
      clear = fullAt(f.issuer.db, "INSERT ON operations", () =>
        f.a.submit(digest, f.issuer),
      );
    assert.deepEqual(f.issuer.counts(), before);
    assert.equal(f.issuer.recover(digest, v.capability), null);
    assert.deepEqual(state(f.a, digest), local);
    clear();
    f.a.submit(digest, f.issuer);
    const response = f.issuer.recover(digest, v.capability);
    assert.equal(f.issuer.submit(v.wire, v.capability), response);
    assert.equal(f.issuer.counts().operations, before.operations + 1);
    assert.equal(f.a.backup(digest), local.pending.snapshot);
  });

test("SQLITE_FULL at client completion rolls back credential and source writes", (t) => {
  const f = fixture(t),
    op = replacement(f),
    before = state(f.a, op.digest),
    clear = fullAt(f.a.db, "UPDATE OF response ON pending", () =>
      f.a.accept(op.digest, op.response),
    );
  assert.deepEqual(state(f.a, op.digest), before);
  clear();
  completed(f, f.a, op);
  assert.equal(f.a.backup(op.digest), before.pending.snapshot);
});

test("writer contention prevents pending save without an issuer operation", (t) => {
  const f = fixture(t),
    other = f.client("a"),
    session = f.issuer.session("issue");
  f.a.db.exec("PRAGMA busy_timeout=1");
  other.db.exec("BEGIN IMMEDIATE");
  try {
    sqliteError(() => f.a.prepareIssue(session, asset), 5);
    assert.equal(
      f.a.db.prepare("SELECT count(*) AS n FROM pending").get().n,
      0,
    );
    assert.equal(f.issuer.counts().operations, 0);
  } finally {
    other.db.exec("ROLLBACK");
  }
  const digest = f.a.prepareIssue(session, asset);
  f.acknowledge(f.a, digest);
  f.a.submit(digest, f.issuer);
});

test("SQLITE_BUSY at client COMMIT rolls back and allows exact recovery", (t) => {
  const f = fixture(t),
    op = replacement(f),
    before = state(f.a, op.digest),
    reader = f.client("a");
  let reached = false;
  f.a.boundary = (phase) => {
    if (phase === "before-client-commit") reached = true;
  };
  f.a.db.exec("PRAGMA busy_timeout=1");
  reader.db.exec("BEGIN");
  reader.db.prepare("SELECT * FROM credentials").all();
  try {
    sqliteError(() => f.a.accept(op.digest, op.response), 5);
    assert(reached, "all client writes completed before COMMIT failed");
    assert.deepEqual(state(f.a, op.digest), before);
  } finally {
    reader.db.exec("ROLLBACK");
  }
  completed(f, f.a, op);
});

test("replaying completed recovery cannot revive a subsequently spent credential", (t) => {
  const f = fixture(t),
    op = replacement(f),
    id = completed(f, f.a, op),
    snapshot = f.a.backup(op.digest);
  const next = f.a.prepareCancel(f.issuer.session("swap"), id);
  f.acknowledge(f.a, next);
  const current = f.a.submit(next, f.issuer);
  f.a.close();
  const c = f.client("a");
  assert.equal(c.restore(snapshot), op.digest);
  assert.equal(c.recover(op.digest, f.issuer), id);
  assert.throws(() => c.export(id), /known spent/);
  assert.throws(() => c.export(op.old), /known spent/);
  p.importBearer(c.export(current), c.pinned);
  assert.equal(f.issuer.counts().operations, 3);
  assert.equal(f.issuer.counts().spent, 2);
  assert.equal(
    c.db.prepare("SELECT count(*) AS n FROM credentials WHERE spent=0").get().n,
    1,
  );
  integrity(c.db);
});
