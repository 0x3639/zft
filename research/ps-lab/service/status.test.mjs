import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { StateObserver, showingChallenge } from "../local/state.mjs";
import * as p from "../local/profile.mjs";
import { ServiceStatus } from "./status.mjs";
import { statusConfig } from "./status-test-support.mjs";
import { fixture, config, asset, wallet } from "./test-support.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function observation(t) {
  const f = await fixture(t),
    id = await f.mint();
  let now = 1000;
  const observer = new StateObserver(
    join(f.dir, "observer.db"),
    config.manifest,
    statusConfig.manifest,
    { now: () => now },
  );
  t.after(() => observer.close());
  const status = (extra = {}) => {
    const s = new ServiceStatus(f.issuer, {
      ...statusConfig,
      now: () => now,
      ...extra,
    });
    t.after(() => s.close());
    return s;
  };
  const context = observer.prepare(
    wallet,
    p.assetValue(asset, p.trust(config.manifest)),
    "84".repeat(32),
  );
  const wire = observer.request(
    context.challenge,
    f.a.show(id, wallet, showingChallenge(context)),
  );
  return {
    ...f,
    id,
    observer,
    context,
    wire,
    status,
    time: (n) => {
      now = n;
      f.setTime(n);
    },
  };
}
test("async status receipt is accepted by unchanged observer and exactly recoverable", async (t) => {
  const f = await observation(t),
    s = f.status(),
    receipt = await s.observe(f.wire);
  const report = f.observer.accept(f.context.challenge, receipt);
  assert.equal(report.issuerReported, "unspent");
  assert.equal(report.sequence, 1);
  assert.equal(report.walletAuthenticated, false);
  assert.equal(s.recover(f.wire), receipt);
  assert.equal(await s.observe(f.wire), receipt);
  assert.equal(f.issuer.counts().observations, 1);
});
test("async status retains original snapshot while issuer advances during signing", async (t) => {
  const f = await observation(t);
  let release, started;
  const ready = new Promise((r) => {
    started = r;
  });
  const s = f.status({
    transport: (req) => {
      started();
      return new Promise((resolve) => {
        release = () => resolve(statusConfig.transport(req));
      });
    },
  });
  const pending = s.observe(f.wire);
  await ready;
  const d = f.b.prepareClaim(await f.issuer.session("swap"), f.a.export(f.id));
  await f.submit(f.b, d);
  f.time(1005);
  release();
  const receipt = await pending,
    body = JSON.parse(receipt).body;
  assert.equal(body.observed_at, 1000);
  assert.equal(body.sequence, 1);
  assert.equal(body.state, "unspent");
  assert.equal(
    f.observer.accept(f.context.challenge, receipt).observedAt,
    1000,
  );
});
test("async status denied signing preserves snapshot for explicit retry", async (t) => {
  const f = await observation(t),
    broken = f.status({
      transport: () => {
        throw new Error("provider private diagnostic");
      },
    });
  await assert.rejects(broken.observe(f.wire), {
    code: "ERR_PS_STATUS_SIGNER_UNAVAILABLE",
  });
  assert.equal(f.issuer.counts().observations, 1);
  assert.equal(broken.recover(f.wire), null);
  f.time(1007);
  const receipt = await f.status().observe(f.wire);
  assert.equal(JSON.parse(receipt).body.observed_at, 1000);
  assert.equal(
    f.observer.accept(f.context.challenge, receipt).proofValid,
    true,
  );
});
test("async status rechecks expiry and admission after signing", async (t) => {
  for (const mutate of [
    (f) => f.time(1060),
    (f) => {
      f.issuer.setEnabled(false);
      f.issuer.setEnabled(true);
    },
  ]) {
    const f = await observation(t),
      s = f.status({
        transport: (req) => {
          const result = statusConfig.transport(req);
          mutate(f);
          return result;
        },
      });
    await assert.rejects(s.observe(f.wire), /expired|admission changed/);
    assert.equal(s.recover(f.wire), null);
  }
});
test("async status concurrent duplicate calls converge on committed receipt", async (t) => {
  const f = await observation(t),
    s = f.status(),
    r = await Promise.all([s.observe(f.wire), s.observe(f.wire)]);
  assert.equal(r[0], r[1]);
  assert.equal(f.issuer.counts().observations, 1);
});
test("async status signature denial and malformed responses never persist receipt", async (t) => {
  for (const transport of [
    () => "{}",
    (req) => {
      const v = JSON.parse(statusConfig.transport(req));
      v.signature = "00".repeat(64);
      return p.canonical(v);
    },
  ]) {
    const f = await observation(t),
      s = f.status({ transport });
    await assert.rejects(s.observe(f.wire), {
      code: "ERR_PS_STATUS_SIGNER_RESPONSE",
    });
    assert.equal(s.recover(f.wire), null);
  }
});
test("async status commit failure and lost acknowledgement have distinct recovery", async (t) => {
  for (const point of [
    "before-observation-receipt-commit",
    "after-observation-receipt-commit",
  ]) {
    const f = await observation(t),
      s = f.status({
        boundary: (name) => {
          if (name === point) throw new Error("disk or acknowledgement fault");
        },
      });
    await assert.rejects(s.observe(f.wire), /fault/);
    const receipt = s.recover(f.wire);
    assert.equal(
      receipt !== null,
      point === "after-observation-receipt-commit",
    );
    const retried = await f.status().observe(f.wire);
    if (receipt) assert.equal(retried, receipt);
    assert.equal(
      f.observer.accept(f.context.challenge, retried).proofValid,
      true,
    );
  }
});
test("async status cancellation and close discard late signatures", async (t) => {
  const f = await observation(t);
  let release;
  const s = f.status({
    transport: (req) =>
      new Promise((resolve) => {
        release = () => resolve(statusConfig.transport(req));
      }),
  });
  const c = new AbortController(),
    pending = s.observe(f.wire, { signal: c.signal });
  await tick();
  c.abort();
  await assert.rejects(pending, { code: "ERR_PS_STATUS_SIGNER_CANCELLED" });
  release();
  await tick();
  assert.equal(s.recover(f.wire), null);
  s.close();
  await assert.rejects(s.observe(f.wire), {
    code: "ERR_PS_STATUS_SERVICE_CLOSED",
  });
});
test("async status rejects invalid showing before durable snapshot or signer", async (t) => {
  const f = await observation(t);
  let calls = 0;
  const s = f.status({
      transport: () => {
        calls++;
        return "{}";
      },
    }),
    v = JSON.parse(f.wire);
  v.wallet = "00".repeat(20);
  await assert.rejects(s.observe(p.canonical(v)));
  assert.equal(calls, 0);
  assert.equal(f.issuer.counts().observations, 0);
});

test("async status validates saved snapshot and cached signature before reuse", async (t) => {
  const f = await observation(t),
    denied = f.status({
      transport: () => {
        throw new Error("denied");
      },
    });
  await assert.rejects(denied.observe(f.wire));
  const row = f.issuer.database.prepare("SELECT body FROM observations").get();
  const damaged = JSON.parse(row.body);
  damaged.wallet = "00".repeat(20);
  f.issuer.database
    .prepare("UPDATE observations SET body=?")
    .run(p.canonical(damaged));
  let calls = 0;
  await assert.rejects(
    f
      .status({
        transport: (req) => {
          calls++;
          return statusConfig.transport(req);
        },
      })
      .observe(f.wire),
    /saved observation context/,
  );
  assert.equal(calls, 0);
  f.issuer.database.prepare("UPDATE observations SET body=?").run(row.body);
  const status = f.status(),
    receipt = await status.observe(f.wire);
  const invalid = JSON.parse(receipt);
  invalid.signature = "00".repeat(64);
  f.issuer.database
    .prepare("UPDATE observations SET receipt=?")
    .run(p.canonical(invalid));
  assert.throws(() => status.recover(f.wire), /saved receipt signature/);
  await assert.rejects(status.observe(f.wire), /saved receipt signature/);
});
