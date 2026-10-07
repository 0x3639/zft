// Observer persistence qualification: disposable local databases and public PS keys.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { join } from "node:path";
import * as p from "./profile.mjs";
import {
  StateIssuer,
  StateObserver,
  stateManifest,
  showingChallenge,
} from "./state.mjs";
import { fixture, asset, wallet, child } from "./test-support.mjs";
import { fullAt, sqliteError, integrity } from "./fault-support.mjs";

const audience = "28".repeat(32);
function setup(t) {
  const f = fixture(t),
    id = f.mint(),
    h = p.assetValue(asset, f.a.pinned);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = stateManifest(
    f.issuer.pinned.manifest,
    publicKey
      .export({ format: "der", type: "spki" })
      .subarray(12)
      .toString("hex"),
  );
  let now = 1000;
  const path = join(f.dir, "observer.db");
  const open = () =>
    f.track(
      new StateObserver(path, f.issuer.pinned.manifest, manifest, {
        now: () => now,
      }),
    );
  const observer = open();
  const issuer = new StateIssuer(f.issuer, manifest, privateKey, {
    now: () => now,
  });
  const prepare = (o = observer) => o.prepare(wallet, h, audience);
  const showing = (c) => f.a.show(id, wallet, showingChallenge(c));
  const query = () => {
    const c = prepare(),
      show = showing(c),
      wire = observer.request(c.challenge, show);
    return { c, show, wire, receipt: issuer.observe(wire) };
  };
  return {
    f,
    h,
    path,
    manifest,
    observer,
    issuer,
    open,
    prepare,
    showing,
    query,
    time: (value) => {
      now = value;
    },
    job: (extra) => ({
      observer: true,
      path,
      psManifest: f.issuer.pinned.manifest,
      stateManifest: manifest,
      wallet,
      h,
      audience,
      now,
      ...extra,
    }),
  };
}
function state(o) {
  return {
    clock: o.clock(),
    challenges: o.db.prepare("SELECT * FROM challenges ORDER BY id").all(),
  };
}
function accepted(s, o, q) {
  const result = o.accept(q.c.challenge, q.receipt);
  assert.equal(result.issuerReported, "unspent");
  assert.equal(result.walletAuthenticated, false);
  assert.equal(result.sequence, 1);
  assert.equal(o.row(q.c.challenge).wire, q.wire);
  assert.equal(o.row(q.c.challenge).receipt, q.receipt);
  assert.throws(() => o.accept(q.c.challenge, q.receipt), /consumed/);
  assert.equal(s.f.issuer.counts().operations, 1);
  integrity(o.db);
}
async function killed(job) {
  const worker = child(job);
  await worker.ready;
  worker.run();
  const result = await worker.done;
  assert.equal(result.signal, "SIGKILL", result.stderr);
  assert.equal(result.message, undefined, "no return before interruption");
}

for (const crash of [
  "after-state-challenge-insert",
  "after-state-challenge-commit",
])
  test(`SIGKILL ${crash} preserves complete observer preparation`, async (t) => {
    const s = setup(t),
      before = state(s.observer);
    s.observer.close();
    await killed(s.job({ action: "prepare", crash }));
    const o = s.open(),
      rows = state(o).challenges;
    if (crash === "after-state-challenge-insert")
      assert.deepEqual(state(o), before);
    else {
      assert.equal(rows.length, 1);
      assert.equal(rows[0].wire, null);
      assert.equal(rows[0].consumed, 0);
      assert.equal(rows[0].receipt, null);
      assert.equal(o.clock().time, 1000);
    }
    const c = rows.length ? p.parse(rows[0].context) : s.prepare(o);
    assert.equal(o.row(c.challenge).context, p.canonical(c));
    const wire = o.request(c.challenge, s.showing(c));
    accepted(s, o, { c, wire, receipt: s.issuer.observe(wire) });
  });

for (const crash of ["after-state-request-write", "after-state-request-commit"])
  test(`SIGKILL ${crash} preserves exact observer request binding`, async (t) => {
    const s = setup(t),
      c = s.prepare(),
      show = s.showing(c),
      before = state(s.observer);
    const wire = p.canonical({ ...c, showing: show });
    s.time(1001);
    s.observer.close();
    await killed(
      s.job({
        action: "request",
        challenge: c.challenge,
        showing: show,
        crash,
      }),
    );
    const o = s.open();
    if (crash === "after-state-request-write") {
      assert.deepEqual(state(o), before);
      assert.throws(
        () => o.accept(c.challenge, s.issuer.observe(wire)),
        /not saved/,
      );
    } else {
      assert.equal(o.row(c.challenge).wire, wire);
      assert.equal(o.clock().time, 1001);
      assert.throws(
        () => o.request(c.challenge, s.showing(c)),
        /already bound/,
      );
    }
    assert.equal(o.request(c.challenge, show), wire);
    accepted(s, o, { c, wire, receipt: s.issuer.observe(wire) });
  });

test("SIGKILL before-state-receipt-commit leaves the original request retryable", async (t) => {
  const s = setup(t),
    q = s.query(),
    before = state(s.observer);
  s.time(1001);
  s.observer.close();
  await killed(
    s.job({
      challenge: q.c.challenge,
      receipt: q.receipt,
      crash: "before-state-receipt-commit",
    }),
  );
  const o = s.open();
  assert.deepEqual(state(o), before);
  accepted(s, o, q);
});

test("SQLITE_FULL during preparation clock update rolls back the challenge", (t) => {
  const s = setup(t),
    before = state(s.observer);
  const clear = fullAt(
    s.observer.db,
    "UPDATE OF time ON observation_clock",
    () => s.prepare(),
  );
  assert.deepEqual(state(s.observer), before);
  clear();
  s.observer.close();
  const o = s.open(),
    c = s.prepare(o),
    wire = o.request(c.challenge, s.showing(c));
  accepted(s, o, { c, wire, receipt: s.issuer.observe(wire) });
});

test("SQLITE_FULL during request clock update rolls back the exact wire", (t) => {
  const s = setup(t),
    c = s.prepare(),
    show = s.showing(c),
    before = state(s.observer);
  s.time(1001);
  const clear = fullAt(
    s.observer.db,
    "UPDATE OF time ON observation_clock",
    () => s.observer.request(c.challenge, show),
  );
  assert.deepEqual(state(s.observer), before);
  clear();
  s.observer.close();
  const o = s.open(),
    wire = o.request(c.challenge, show);
  assert.equal(wire, p.canonical({ ...c, showing: show }));
  accepted(s, o, { c, wire, receipt: s.issuer.observe(wire) });
});

test("SQLITE_FULL during receipt insertion preserves request and sequence", (t) => {
  const s = setup(t),
    q = s.query(),
    before = state(s.observer);
  s.time(1001);
  const clear = fullAt(s.observer.db, "UPDATE OF receipt ON challenges", () =>
    s.observer.accept(q.c.challenge, q.receipt),
  );
  assert.deepEqual(state(s.observer), before);
  clear();
  s.observer.close();
  const o = s.open();
  assert.deepEqual(state(o), before);
  accepted(s, o, q);
});

test("read-only observer acceptance preserves the pending receipt request", (t) => {
  const s = setup(t),
    q = s.query(),
    before = state(s.observer);
  s.observer.db.exec("PRAGMA query_only=ON");
  try {
    sqliteError(() => s.observer.accept(q.c.challenge, q.receipt), 8);
    assert.deepEqual(state(s.observer), before);
  } finally {
    s.observer.db.exec("PRAGMA query_only=OFF");
  }
  accepted(s, s.observer, q);
});

test("observer writer contention leaves acceptance retryable", (t) => {
  const s = setup(t),
    q = s.query(),
    other = s.open(),
    before = state(s.observer);
  s.observer.db.exec("PRAGMA busy_timeout=1");
  other.db.exec("BEGIN IMMEDIATE");
  try {
    sqliteError(() => s.observer.accept(q.c.challenge, q.receipt), 5);
    assert.deepEqual(state(s.observer), before);
  } finally {
    other.db.exec("ROLLBACK");
  }
  accepted(s, s.observer, q);
});

test("SQLITE_BUSY at observer COMMIT rolls back receipt and replay memory", (t) => {
  const s = setup(t),
    q = s.query(),
    reader = s.open(),
    before = state(s.observer);
  let reached = false;
  s.time(1001);
  s.observer.boundary = (phase) => {
    if (phase === "before-state-receipt-commit") reached = true;
  };
  s.observer.db.exec("PRAGMA busy_timeout=1");
  reader.db.exec("BEGIN");
  reader.db.prepare("SELECT * FROM challenges").all();
  try {
    sqliteError(() => s.observer.accept(q.c.challenge, q.receipt), 5);
    assert(reached, "all acceptance writes reached before COMMIT failed");
    assert.deepEqual(state(s.observer), before);
  } finally {
    reader.db.exec("ROLLBACK");
  }
  s.observer.close();
  const o = s.open();
  assert.deepEqual(state(o), before);
  accepted(s, o, q);
});

test("failed persistence cannot extend an expired observation challenge", (t) => {
  const s = setup(t),
    q = s.query(),
    before = state(s.observer);
  const clear = fullAt(s.observer.db, "UPDATE OF receipt ON challenges", () =>
    s.observer.accept(q.c.challenge, q.receipt),
  );
  assert.deepEqual(state(s.observer), before);
  clear();
  s.time(q.c.expires_at);
  s.observer.close();
  const o = s.open();
  assert.throws(() => o.accept(q.c.challenge, q.receipt), /expired/);
  assert.throws(() => s.issuer.observe(q.wire), /expired/);
  assert.deepEqual(state(o), before);
  const c = s.prepare(o),
    wire = o.request(c.challenge, s.showing(c));
  assert.notEqual(c.challenge, q.c.challenge);
  accepted(s, o, { c, wire, receipt: s.issuer.observe(wire) });
  assert.equal(o.row(q.c.challenge).consumed, 0);
  assert.equal(o.row(q.c.challenge).wire, q.wire);
});
