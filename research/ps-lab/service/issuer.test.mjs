import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { join } from "node:path";
import * as p from "../local/profile.mjs";
import { ServiceIssuer } from "./issuer.mjs";
import { initializeServiceStore, openServiceStore } from "./store.mjs";
import { ProtectedRecord } from "./protected-record.mjs";
import {
  fixture,
  config,
  transport,
  asset,
  wallet,
  nonce,
} from "./test-support.mjs";
const tick = () => new Promise((r) => setImmediate(r));
const alter = (wire, fn) => {
  const v = JSON.parse(wire);
  fn(v);
  return p.canonical(v);
};

test("service creation and open never adopt missing partial or foreign state", async (t) => {
  const f = await fixture(t);
  assert.throws(
    () =>
      initializeServiceStore(f.path, config.manifest, config.configurationId),
    /EEXIST/,
  );
  const missing = join(f.dir, "missing.db");
  assert.throws(
    () => openServiceStore(missing, config.manifest, config.configurationId),
    /ENOENT/,
  );
  assert(!fs.existsSync(missing));
  const partial = join(f.dir, "partial.db");
  fs.writeFileSync(partial, "", { mode: 0o600 });
  assert.throws(
    () => openServiceStore(partial, config.manifest, config.configurationId),
    /no such table/,
  );
  assert.throws(
    () => openServiceStore(f.path, config.manifest, "82".repeat(32)),
    /identity mismatch/,
  );
  const second = join(f.dir, "new.db");
  initializeServiceStore(second, config.manifest, config.configurationId);
  const i = new ServiceIssuer(second, {
    ...config,
    transport: f.custody.transport,
  });
  t.after(() => i.close());
  await assert.rejects(i.session("issue"), /suspended/);
});
test("service issue claim cancel and showing preserve frozen client compatibility", async (t) => {
  const f = await fixture(t),
    old = await f.mint(),
    envelope = f.a.export(old);
  const d = f.b.prepareClaim(await f.issuer.session("swap"), envelope),
    current = await f.submit(f.b, d);
  assert.notEqual(current, old);
  const stale = f.a.prepareClaim(await f.issuer.session("swap"), envelope);
  await assert.rejects(f.submit(f.a, stale), /already spent/);
  const cancel = f.b.prepareCancel(await f.issuer.session("swap"), current),
    fresh = await f.submit(f.b, cancel);
  assert.notEqual(fresh, current);
  const h = p.assetValue(asset, p.trust(config.manifest));
  assert.deepEqual(
    f.issuer.checkShowing(f.b.show(fresh, wallet, nonce), wallet, nonce, h),
    { nullifier: fresh, state: "unspent", walletAuthenticated: false },
  );
  assert.equal(
    f.issuer.checkShowing(f.a.show(old, wallet, nonce), wallet, nonce, h).state,
    "spent",
  );
  assert.equal(f.issuer.counts().operations, 3);
});
test("service sessions store only protected scalar bytes and survive reopen", async (t) => {
  const f = await fixture(t),
    s = await f.issuer.session("issue"),
    row = f.issuer.database
      .prepare("SELECT wire,protected FROM sessions WHERE id=?")
      .get(s.session);
  assert.deepEqual(Object.keys(row).sort(), ["protected", "wire"]);
  const protector = new ProtectedRecord({
    ...config,
    purpose: "session",
    recordId: p.hash(row.wire),
    transport,
  });
  const bytes = await protector.open(row.protected);
  protector.close();
  assert.equal(p.encodedPoint(p.mul(p.G1, p.scalar(p.hex(bytes), true))), s.u);
  const db = fs.readFileSync(f.path);
  assert.equal(
    db.indexOf(Buffer.from(bytes)),
    -1,
    "no raw session scalar in database",
  );
  assert(
    !db.includes(Buffer.from(p.hex(bytes))),
    "no hex session scalar in database",
  );
  bytes.fill(0);
  const d = f.a.prepareIssue(s, asset),
    other = f.open();
  await f.submit(f.a, d, other);
  assert.equal(other.counts().operations, 1);
});
test("service verifies request proof before custody and rejects incorrect response equations", async (t) => {
  const f = await fixture(t),
    s = await f.issuer.session("issue"),
    d = f.a.prepareIssue(s, asset),
    v = f.pending(f.a, d);
  let calls = 0;
  const counted = f.open({
    transport: (r) => {
      calls++;
      return f.custody.transport(r);
    },
  });
  const bad = alter(v.wire, (r) => {
    r.proof = r.proof.replace(/^../, r.proof.startsWith("00") ? "01" : "00");
  });
  await assert.rejects(counted.submit(bad, v.capability));
  assert.equal(calls, 0);
  for (const which of ["response", "k2", "ys_k2"]) {
    const i = f.open({
      transport: async (r) =>
        alter(await f.custody.transport(r), (out) => {
          if (which === "response")
            out.result.response = alter(out.result.response, (x) => {
              x.v = p.encodedPoint(p.G1);
            });
          else out.result[which] = p.encodedPoint(p.G2);
        }),
    });
    await assert.rejects(i.submit(v.wire, v.capability), {
      code: "ERR_PS_EXECUTOR_RESPONSE",
    });
    assert.equal(f.issuer.counts().operations, 0);
  }
  await f.submit(f.a, d);
});
test("service exact response recovery survives expiry and admission suspension", async (t) => {
  const f = await fixture(t),
    d = f.a.prepareIssue(await f.issuer.session("issue"), asset),
    v = f.pending(f.a, d);
  await f.submit(f.a, d);
  const response = f.issuer.recover(d, v.capability);
  f.setTime(2000);
  f.issuer.setEnabled(false);
  const offline = f.open({
    transport: () => {
      throw new Error("custody unavailable");
    },
  });
  assert.equal(await offline.submit(v.wire, v.capability), response);
  assert.equal(offline.recover(d, v.capability), response);
  assert.throws(() => offline.recover(d, "00".repeat(32)), /capability/);
  assert.equal(offline.recover("00".repeat(32), v.capability), null);
});
test("service rechecks expiry and admission generation after async custody", async (t) => {
  for (const change of [
    (f) => f.setTime(1300),
    (f) => {
      f.issuer.setEnabled(false);
      f.issuer.setEnabled(true);
    },
  ]) {
    const f = await fixture(t),
      d = f.a.prepareIssue(await f.issuer.session("issue"), asset),
      v = f.pending(f.a, d);
    const delayed = f.open({
      transport: async (r) => {
        const response = await f.custody.transport(r);
        change(f);
        return response;
      },
    });
    await assert.rejects(
      delayed.submit(v.wire, v.capability),
      /expired|admission changed/,
    );
    assert.equal(f.issuer.counts().operations, 0);
    assert.equal(f.issuer.counts().assets, 0);
  }
});
test("service rejects changed or denied session unwrap without consuming state", async (t) => {
  const f = await fixture(t),
    s = await f.issuer.session("issue"),
    d = f.a.prepareIssue(s, asset),
    v = f.pending(f.a, d),
    original = f.issuer.database
      .prepare("SELECT protected FROM sessions WHERE id=?")
      .get(s.session).protected;
  f.issuer.database.prepare("UPDATE sessions SET protected=? WHERE id=?").run(
    alter(original, (x) => {
      x.tag = (x.tag.startsWith("00") ? "01" : "00") + x.tag.slice(2);
    }),
    s.session,
  );
  await assert.rejects(f.issuer.submit(v.wire, v.capability), {
    code: "ERR_PS_EXECUTOR_UNAVAILABLE",
  });
  assert.equal(f.issuer.counts().operations, 0);
  f.issuer.database
    .prepare("UPDATE sessions SET protected=? WHERE id=?")
    .run(original, s.session);
  await f.submit(f.a, d);
});
test("service commits a single winner after concurrent asynchronous claims", async (t) => {
  const f = await fixture(t),
    old = await f.mint(),
    envelope = f.a.export(old),
    c = f.client("c");
  const d1 = f.b.prepareClaim(await f.issuer.session("swap"), envelope),
    d2 = c.prepareClaim(await f.issuer.session("swap"), envelope),
    v1 = f.pending(f.b, d1),
    v2 = f.pending(c, d2);
  let ready = 0,
    releases = [];
  const concurrent = f.open({
    transport: async (r) => {
      const result = await f.custody.transport(r);
      ready++;
      return new Promise((resolve) => releases.push(() => resolve(result)));
    },
  });
  const a = concurrent.submit(v1.wire, v1.capability),
    b = concurrent.submit(v2.wire, v2.capability);
  const outcomes = Promise.allSettled([a, b]);
  while (ready < 2) await tick();
  for (const release of releases) release();
  const results = await outcomes;
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.filter((x) => x.status === "rejected").length, 1);
  assert.equal(f.issuer.counts().spent, 1);
  assert.equal(f.issuer.counts().operations, 2);
});
test("service serializes duplicate async requests to the same exact durable response", async (t) => {
  const f = await fixture(t),
    d = f.a.prepareIssue(await f.issuer.session("issue"), asset),
    v = f.pending(f.a, d);
  const results = await Promise.all([
    f.issuer.submit(v.wire, v.capability),
    f.issuer.submit(v.wire, v.capability),
  ]);
  assert.equal(results[0], results[1]);
  assert.equal(f.issuer.counts().operations, 1);
});
test("service uncertain committed response is recovered without another custody call", async (t) => {
  const f = await fixture(t),
    d = f.a.prepareIssue(await f.issuer.session("issue"), asset),
    v = f.pending(f.a, d);
  const broken = f.open({
    boundary: (name) => {
      if (name === "after-response-commit")
        throw new Error("lost acknowledgement");
    },
  });
  await assert.rejects(
    broken.submit(v.wire, v.capability),
    /lost acknowledgement/,
  );
  assert.equal(f.issuer.counts().operations, 1);
  let calls = 0;
  const recovered = f.open({
    transport: () => {
      calls++;
      throw new Error("no");
    },
  });
  assert.equal(
    await recovered.submit(v.wire, v.capability),
    recovered.recover(d, v.capability),
  );
  assert.equal(calls, 0);
});
test("service transaction failure rolls back spend and exact response together", async (t) => {
  const f = await fixture(t),
    old = await f.mint(),
    d = f.b.prepareClaim(await f.issuer.session("swap"), f.a.export(old)),
    v = f.pending(f.b, d);
  for (const point of ["before-response-insert", "before-response-commit"]) {
    const broken = f.open({
      boundary: (name) => {
        if (name === point) throw new Error("transaction fault");
      },
    });
    await assert.rejects(
      broken.submit(v.wire, v.capability),
      /transaction fault/,
    );
    assert.equal(f.issuer.counts().spent, 0);
    assert.equal(f.issuer.counts().operations, 1);
  }
  await f.submit(f.b, d);
  assert.equal(f.issuer.counts().spent, 1);
});
test("service closing an active request prevents delayed commit", async (t) => {
  const f = await fixture(t),
    d = f.a.prepareIssue(await f.issuer.session("issue"), asset),
    v = f.pending(f.a, d);
  let release;
  const closing = f.open({
    transport: (r) =>
      new Promise((resolve) => {
        release = async () => resolve(await f.custody.transport(r));
      }),
  });
  const pending = closing.submit(v.wire, v.capability);
  await tick();
  closing.close();
  await assert.rejects(pending, { code: "ERR_PS_EXECUTOR_CLOSED" });
  await release();
  await tick();
  assert.equal(f.issuer.counts().operations, 0);
});
