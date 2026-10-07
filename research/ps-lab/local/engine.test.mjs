import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { Issuer } from "./issuer.mjs";
import { Client } from "./client.mjs";
import * as p from "./profile.mjs";
const vectors = JSON.parse(
  readFileSync(new URL("../vectors.json", import.meta.url), "utf8"),
);
export const secrets = Object.fromEntries(
  ["x", "yh", "ys"].map((k) => [k, vectors.test_secrets[k]]),
);
const realm = "71".repeat(32),
  wallet = "42".repeat(20),
  nonce = "31".repeat(32);
const asset = p.utf8("local PS lab artwork; no real assets");
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zft PS engine # ")),
    opened = [];
  const openIssuer = (extra = {}) => {
    const i = new Issuer(join(dir, "issuer.db"), realm, secrets, {
      ...options,
      ...extra,
    });
    opened.push(i);
    return i;
  };
  const issuer = openIssuer();
  const client = (name, extra = {}) => {
    const c = new Client(
      join(dir, name + ".db"),
      issuer.pinned.manifest,
      extra,
    );
    opened.push(c);
    return c;
  };
  const a = client("a"),
    b = client("b");
  t.after(() => {
    for (const c of opened)
      try {
        c.close();
      } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  const acknowledge = (c, d) => c.acknowledge(d, p.hash(c.backup(d)));
  const mint = () => {
    const d = a.prepareIssue(issuer.session("issue"), asset);
    acknowledge(a, d);
    return a.submit(d, issuer);
  };
  return { dir, issuer, a, b, client, openIssuer, acknowledge, mint };
}
function pending(c, d) {
  return p.parse(c.backup(d), 300000);
}
function child(job) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const c = fork(
    fileURLToPath(new URL("./process-worker.mjs", import.meta.url)),
    [],
    {
      env,
      execArgv: ["--experimental-sqlite"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let stderr = "",
    message;
  c.stderr.on("data", (x) => {
    stderr += x;
  });
  const ready = new Promise((resolve, reject) => {
    c.once("error", reject);
    c.once("message", (m) => {
      assert(m.ready);
      resolve();
    });
    c.once("exit", (code, signal) => {
      if (code || signal) reject(new Error("child startup: " + stderr));
    });
  });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      c.kill("SIGKILL");
      reject(new Error("worker timeout " + stderr));
    }, 30000);
    c.on("message", (m) => {
      if (!m.ready) message = m;
    });
    c.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    c.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, message, stderr });
    });
  });
  c.send(job);
  return { ready, run: () => c.send({ go: true }), done };
}
function job(f, c, d, crash) {
  const v = pending(c, d);
  return {
    path: join(f.dir, "issuer.db"),
    realm,
    secrets,
    wire: v.wire,
    capability: v.capability,
    crash,
  };
}

test("issue → export → claim → stale-copy rejection → cancel → public showing", (t) => {
  const f = fixture(t),
    old = f.mint(),
    envelope = f.a.export(old);
  assert.equal(statSync(join(f.dir, "a.db")).mode & 0o777, 0o600);
  const d = f.b.prepareClaim(f.issuer.session("swap"), envelope);
  f.acknowledge(f.b, d);
  const current = f.b.submit(d, f.issuer);
  assert.notEqual(current, old);
  const stale = f.a.prepareClaim(f.issuer.session("swap"), envelope);
  f.acknowledge(f.a, stale);
  assert.throws(() => f.a.submit(stale, f.issuer), /already spent/);
  const copy = f.b.export(current),
    cancel = f.b.prepareCancel(f.issuer.session("swap"), current);
  f.acknowledge(f.b, cancel);
  const fresh = f.b.submit(cancel, f.issuer);
  assert.notEqual(fresh, current);
  assert.throws(() => f.b.export(current), /known spent/);
  const late = f.a.prepareClaim(f.issuer.session("swap"), copy);
  f.acknowledge(f.a, late);
  assert.throws(() => f.a.submit(late, f.issuer), /already spent/);
  const show = f.b.show(fresh, wallet, nonce),
    h = p.assetValue(asset, f.issuer.pinned);
  assert.deepEqual(f.issuer.checkShowing(show, wallet, nonce, h), {
    nullifier: fresh,
    state: "unspent",
    walletAuthenticated: false,
  });
  assert.equal(
    f.issuer.checkShowing(f.a.show(old, wallet, nonce), wallet, nonce, h).state,
    "spent",
  );
  const publicWire = p.parse(show);
  assert(!("secret" in publicWire));
  assert(!("credential" in publicWire));
  assert.deepEqual(f.issuer.counts(), {
    sessions: 5,
    operations: 3,
    assets: 1,
    spent: 2,
  });
});
test("submission requires acknowledgment of the exact saved recovery snapshot", (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset);
  assert.throws(() => f.a.submit(d, f.issuer), /recovery snapshot required/);
  assert.throws(() => f.a.acknowledge(d, "00".repeat(32)), /acknowledgment/);
  assert.equal(f.issuer.counts().operations, 0);
  f.acknowledge(f.a, d);
  f.a.submit(d, f.issuer);
});
test("duplicate initial issuance rejects without consuming the second session", (t) => {
  const f = fixture(t);
  f.mint();
  const d = f.b.prepareIssue(f.issuer.session("issue"), asset);
  f.acknowledge(f.b, d);
  assert.throws(() => f.b.submit(d, f.issuer), /duplicate asset/);
  assert.equal(f.issuer.counts().operations, 1);
});
test("exact replay is byte-identical and a changed request cannot reuse a consumed session", (t) => {
  const f = fixture(t),
    s = f.issuer.session("issue"),
    d = f.a.prepareIssue(s, asset),
    v = pending(f.a, d);
  f.acknowledge(f.a, d);
  f.a.submit(d, f.issuer);
  const first = f.issuer.recover(d, v.capability);
  assert.equal(f.issuer.submit(v.wire, v.capability), first);
  const changed = f.b.prepareIssue(s, p.utf8("different asset"));
  f.acknowledge(f.b, changed);
  assert.throws(() => f.b.submit(changed, f.issuer), /session consumed/);
  assert.equal(f.issuer.counts().operations, 1);
});
test("recovery capability substitution invalidates the proof", (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    v = pending(f.a, d),
    r = p.parse(v.wire);
  const cap = "ab".repeat(32),
    wire = p.canonical({ ...r, recovery_hash: p.hash(p.bytes(cap)) });
  assert.throws(() => f.issuer.submit(wire, cap), /linear challenge/);
  assert.equal(f.issuer.counts().operations, 0);
});
test("unknown and wrong-capability recovery never issue credentials", (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    v = pending(f.a, d);
  f.acknowledge(f.a, d);
  assert.equal(f.issuer.recover(d, v.capability), null);
  assert.throws(() => f.a.recover(d, f.issuer), /unknown issuer operation/);
  f.a.submit(d, f.issuer);
  assert.throws(
    () => f.issuer.recover(d, "ff".repeat(32)),
    /recovery capability/,
  );
});
test("expired uncommitted sessions reject; committed responses survive expiry and suspension", (t) => {
  let now = 1000;
  const f = fixture(t, { now: () => now }),
    s = f.issuer.session("issue"),
    d = f.a.prepareIssue(s, asset),
    v = pending(f.a, d);
  f.acknowledge(f.a, d);
  f.a.submit(d, f.issuer);
  const waiting = f.b.prepareIssue(f.issuer.session("issue"), p.utf8("next"));
  f.acknowledge(f.b, waiting);
  now = 1300;
  assert.throws(() => f.b.submit(waiting, f.issuer), /expired/);
  f.issuer.setEnabled(false);
  assert.throws(() => f.issuer.session("issue"), /suspended/);
  assert.equal(
    f.issuer.submit(v.wire, v.capability),
    f.issuer.recover(d, v.capability),
  );
  f.a.recover(d, f.issuer);
});
test("suspension is rechecked inside the commit boundary", (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    v = pending(f.a, d);
  const original = f.issuer.checkedSession.bind(f.issuer);
  let calls = 0;
  f.issuer.checkedSession = (r) => {
    const s = original(r);
    if (++calls === 2) f.issuer.setEnabled(false);
    return s;
  };
  assert.throws(() => f.issuer.submit(v.wire, v.capability), /suspended/);
  assert.equal(f.issuer.counts().assets, 0);
});
test("restored pending swap recovers into a third client after lost response", (t) => {
  const f = fixture(t),
    old = f.mint(),
    d = f.b.prepareClaim(f.issuer.session("swap"), f.a.export(old));
  f.acknowledge(f.b, d);
  const v = pending(f.b, d),
    snapshot = f.b.backup(d);
  const response = f.issuer.submit(v.wire, v.capability);
  const recovered = f.client("recovered");
  assert.equal(recovered.restore(snapshot), d);
  const id = recovered.recover(d, f.issuer);
  assert.equal(f.b.accept(d, response), id);
  assert.equal(recovered.export(id), f.b.export(id));
  assert.equal(f.issuer.counts().spent, 1);
  assert.equal(recovered.backup(d), snapshot);
});
test("tampered recovery secret, blinding, capability, asset or request is rejected before persistence", (t) => {
  const f = fixture(t),
    old = f.mint(),
    d = f.b.prepareClaim(f.issuer.session("swap"), f.a.export(old)),
    v = pending(f.b, d),
    other = f.client("other");
  for (const field of ["secret", "t", "capability", "h"])
    assert.throws(
      () => other.restore(p.canonical({ ...v, [field]: "01".repeat(32) })),
      undefined,
      field,
    );
  assert.throws(() =>
    other.restore(p.canonical({ ...v, asset: p.hex(p.utf8("wrong image")) })),
  );
  assert.throws(() => other.restore(p.canonical({ ...v, wire: v.wire + " " })));
  assert.throws(() => other.pending(d), /unknown local/);
});
test("changed response base, digest, keyset or signature leaves the client pending", (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    v = pending(f.a, d);
  f.acknowledge(f.a, d);
  const response = p.parse(f.issuer.submit(v.wire, v.capability));
  for (const patch of [
    { u: p.encodedPoint(p.G1) },
    { digest: "00".repeat(32) },
    { keyset_id: "03" + "00".repeat(32) },
    { v: p.encodedPoint(p.G1) },
  ])
    assert.throws(() => f.a.accept(d, p.canonical({ ...response, ...patch })));
  assert.equal(f.a.pending(d).response, null);
  f.a.recover(d, f.issuer);
});
test("bearer envelope validates artwork, manifest, exact schema and protocol", (t) => {
  const f = fixture(t),
    id = f.mint(),
    v = p.parse(f.a.export(id), 140000);
  for (const patch of [
    { asset: "00" },
    { realm: "00".repeat(32) },
    { protocol: "psnft1" },
    { extra: 1 },
    { public_key: "00".repeat(336) },
  ])
    assert.throws(() =>
      p.importBearer(p.canonical({ ...v, ...patch }), f.a.pinned),
    );
  assert.throws(
    () =>
      new Client(join(f.dir, "wrong.db"), {
        ...f.issuer.pinned.manifest,
        protocol: "v1",
      }),
  );
});
test("existing database refuses another realm or keyset", (t) => {
  const f = fixture(t);
  f.mint();
  f.issuer.close();
  assert.throws(
    () => new Issuer(join(f.dir, "issuer.db"), "00".repeat(32), secrets),
    /identity mismatch/,
  );
  assert.throws(
    () =>
      new Issuer(join(f.dir, "issuer.db"), realm, {
        ...secrets,
        x: p.scalarHex(7n),
      }),
    /identity mismatch/,
  );
  const again = f.openIssuer();
  assert.equal(again.counts().assets, 1);
});
test("wire parser rejects oversized, noncanonical, duplicate-key, nested and extra input", (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    v = pending(f.a, d);
  for (const wire of [
    " ".repeat(12289),
    v.wire + " ",
    v.wire.replace("{", '{"kind":"swap",'),
    p.canonical({ ...p.parse(v.wire), extra: 1 }),
  ])
    assert.throws(() => f.issuer.submit(wire, v.capability));
  assert.throws(() => p.parse('{"a":'.repeat(9) + "1" + "}".repeat(9)));
  assert.throws(() =>
    f.a.prepareIssue(
      f.issuer.session("issue"),
      new Uint8Array(p.MAX_ASSET + 1),
    ),
  );
  assert.throws(() =>
    f.a.prepareIssue(f.issuer.session("issue"), new Uint8Array()),
  );
});
test("purpose, session, base, realm and parameter substitutions fail", (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    v = pending(f.a, d),
    r = p.parse(v.wire);
  for (const patch of [
    { kind: "swap" },
    { session: "ff".repeat(16) },
    { u: p.encodedPoint(p.G1) },
    { expires: r.expires + 1 },
    { realm: "ff".repeat(32) },
    { keyset_id: "03" + "00".repeat(32) },
  ])
    assert.throws(() =>
      f.issuer.submit(p.canonical({ ...r, ...patch }), v.capability),
    );
  assert.equal(f.issuer.counts().operations, 0);
});
test("swap proofs bind destination, commitment and all presentation fields", (t) => {
  const f = fixture(t),
    old = f.mint(),
    d = f.b.prepareClaim(f.issuer.session("swap"), f.a.export(old)),
    v = pending(f.b, d),
    r = p.parse(v.wire);
  for (const patch of [
    { s: p.encodedPoint(p.G1) },
    { b: p.encodedPoint(p.G1) },
    { owner_proof: "00".repeat(64) },
    { proof: "00".repeat(128) },
    { recovery_hash: "00".repeat(32) },
  ])
    assert.throws(() =>
      p.request(p.canonical({ ...r, ...patch }), f.issuer.pinned),
    );
  for (const [start, end, group] of [
    [66, 162, 1],
    [162, 258, 1],
    [258, 450, 2],
    [450, 546, 1],
    [546, 642, 1],
  ]) {
    const replacement = p.encodedPoint(
      p
        .point(r.presentation.slice(start, end), group)
        .add(group === 1 ? p.G1 : p.G2),
    );
    assert.throws(() =>
      p.request(
        p.canonical({
          ...r,
          presentation:
            r.presentation.slice(0, start) +
            replacement +
            r.presentation.slice(end),
        }),
        f.issuer.pinned,
      ),
    );
  }
});
test("showing binds wallet, asset, realm, purpose and fresh verifier challenge", (t) => {
  const f = fixture(t),
    id = f.mint(),
    show = f.a.show(id, wallet, nonce),
    r = p.parse(show),
    h = p.assetValue(asset, f.issuer.pinned);
  for (const patch of [
    { wallet: "22".repeat(20) },
    { nonce: "23".repeat(32) },
    { realm: "24".repeat(32) },
    { h: p.scalarHex(1n) },
    { purpose: "swap" },
    { v: p.encodedPoint(p.G1) },
  ])
    assert.throws(() =>
      p.verifyShowing(
        p.canonical({ ...r, ...patch }),
        patch.wallet ?? wallet,
        patch.nonce ?? nonce,
        patch.h ?? h,
        f.a.pinned,
      ),
    );
  assert.throws(() => p.request(show, f.a.pinned));
});
for (const boundary of ["before-commit", "after-commit"])
  test(`SIGKILL ${boundary} preserves atomic spend and response recovery`, async (t) => {
    const f = fixture(t),
      old = f.mint(),
      d = f.b.prepareClaim(f.issuer.session("swap"), f.a.export(old));
    f.acknowledge(f.b, d);
    const v = pending(f.b, d),
      c = child(job(f, f.b, d, boundary));
    await c.ready;
    c.run();
    const result = await c.done;
    assert.equal(result.signal, "SIGKILL");
    f.issuer.close();
    const reopened = f.openIssuer();
    if (boundary === "before-commit") {
      assert.equal(reopened.counts().spent, 0);
      assert.equal(reopened.recover(d, v.capability), null);
      f.b.submit(d, reopened);
    } else {
      assert.equal(reopened.counts().spent, 1);
      assert(reopened.recover(d, v.capability));
      f.b.recover(d, reopened);
    }
    assert.equal(reopened.counts().operations, 2);
    assert.equal(reopened.counts().spent, 1);
  });
test("SIGKILL before client save recovers verified replacement from retained journal", async (t) => {
  const f = fixture(t),
    old = f.mint(),
    d = f.b.prepareClaim(f.issuer.session("swap"), f.a.export(old));
  f.acknowledge(f.b, d);
  const v = pending(f.b, d),
    response = f.issuer.submit(v.wire, v.capability);
  f.b.close();
  const c = child({
    client: true,
    path: join(f.dir, "b.db"),
    manifest: f.issuer.pinned.manifest,
    digest: d,
    response,
    crash: "before-client-save",
  });
  await c.ready;
  c.run();
  assert.equal((await c.done).signal, "SIGKILL");
  const restarted = f.client("b");
  assert.equal(restarted.pending(d).response, null);
  restarted.recover(d, f.issuer);
});
test("two processes racing the same bearer commit exactly one replacement", async (t) => {
  const f = fixture(t),
    old = f.mint(),
    file = f.a.export(old),
    d1 = f.b.prepareClaim(f.issuer.session("swap"), file),
    d2 = f.a.prepareClaim(f.issuer.session("swap"), file);
  f.acknowledge(f.b, d1);
  f.acknowledge(f.a, d2);
  const workers = [child(job(f, f.b, d1)), child(job(f, f.a, d2))];
  await Promise.all(workers.map((c) => c.ready));
  workers.forEach((c) => c.run());
  const results = await Promise.all(workers.map((c) => c.done));
  assert(results.every((r) => r.code === 0));
  assert.equal(results.filter((r) => r.message.ok).length, 1);
  assert.match(
    results.find((r) => !r.message.ok).message.error,
    /already spent/,
  );
  assert.equal(f.issuer.counts().spent, 1);
  assert.equal(f.issuer.counts().operations, 2);
});
test("two processes retrying an identical request return identical response bytes", async (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    j = job(f, f.a, d);
  const workers = [child(j), child(j)];
  await Promise.all(workers.map((c) => c.ready));
  workers.forEach((c) => c.run());
  const results = await Promise.all(workers.map((c) => c.done));
  assert(results.every((r) => r.code === 0 && r.message.ok));
  assert.equal(results[0].message.value, results[1].message.value);
  assert.equal(f.issuer.counts().operations, 1);
});
test("active sessions are bounded", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 100; i++) f.issuer.session("issue");
  assert.throws(() => f.issuer.session("issue"), /session limit/);
});
test("expiry is rechecked after proof verification before registry commit", (t) => {
  let now = 1000;
  const f = fixture(t, { now: () => now }),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    v = pending(f.a, d);
  const original = f.issuer.checkedSession.bind(f.issuer);
  let calls = 0;
  f.issuer.checkedSession = (r) => {
    const s = original(r);
    if (++calls === 2) now = r.expires;
    return s;
  };
  assert.throws(() => f.issuer.submit(v.wire, v.capability), /expired/);
  assert.equal(f.issuer.counts().assets, 0);
});
test("direct response acceptance requires backup and same-store restoration acknowledges it", (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    v = pending(f.a, d),
    snapshot = f.a.backup(d);
  const response = f.issuer.submit(v.wire, v.capability);
  assert.throws(() => f.a.accept(d, response), /recovery snapshot required/);
  f.a.restore(snapshot);
  f.a.accept(d, response);
});
test("invalid proof does not consume session or duplicate tag", (t) => {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), asset),
    v = pending(f.a, d),
    r = p.parse(v.wire);
  assert.throws(() =>
    f.issuer.submit(
      p.canonical({ ...r, proof: "00".repeat(96) }),
      v.capability,
    ),
  );
  assert.equal(f.issuer.counts().assets, 0);
  assert(f.issuer.submit(v.wire, v.capability));
});
test("two processes racing duplicate issuance reserve the asset exactly once", async (t) => {
  const f = fixture(t),
    d1 = f.a.prepareIssue(f.issuer.session("issue"), asset),
    d2 = f.b.prepareIssue(f.issuer.session("issue"), asset);
  const workers = [child(job(f, f.a, d1)), child(job(f, f.b, d2))];
  await Promise.all(workers.map((c) => c.ready));
  workers.forEach((c) => c.run());
  const results = await Promise.all(workers.map((c) => c.done));
  assert(results.every((r) => r.code === 0));
  assert.equal(results.filter((r) => r.message.ok).length, 1);
  assert.match(
    results.find((r) => !r.message.ok).message.error,
    /duplicate asset/,
  );
  assert.equal(f.issuer.counts().assets, 1);
  assert.equal(f.issuer.counts().operations, 1);
});

test("a bearer cannot be relabeled into another realm even with the same issuer key", (t) => {
  const f = fixture(t),
    id = f.mint(),
    envelope = p.parse(f.a.export(id), 140000);
  const other = p.trust(p.manifest("98".repeat(32), secrets));
  const relabeled = p.canonical({ ...envelope, ...other.manifest });
  assert.throws(() => p.importBearer(relabeled, other), /asset binding/);
  const forged = p.canonical({
    ...envelope,
    ...other.manifest,
    credential: { ...envelope.credential, h: p.assetValue(asset, other) },
  });
  assert.throws(() => p.importBearer(forged, other), /PS pairing equation/);
});
