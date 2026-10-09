import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as p from "../local/profile.mjs";
import { StateObserver, showingChallenge } from "../local/state.mjs";
import { ServiceStatus } from "./status.mjs";
import { statusConfig } from "./status-test-support.mjs";
import { fixture, config, asset, wallet } from "./test-support.mjs";
async function killed(t, f, job) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = fork(
    fileURLToPath(new URL("./process-worker.mjs", import.meta.url)),
    [],
    {
      execArgv: ["--experimental-sqlite"],
      env,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let message,
    stderr = "";
  child.on("message", (m) => {
    message = m;
  });
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  let timeout = false;
  const mark = setTimeout(() => {
    timeout = true;
  }, 19500);
  t.after(() => {
    clearTimeout(timer);
    clearTimeout(mark);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  child.send({ keys: f.keys, digest: f.receipt.sha256, path: f.path, ...job });
  const result = await done;
  clearTimeout(timer);
  clearTimeout(mark);
  assert.equal(timeout, false, "worker boundary reached in time: " + stderr);
  assert.deepEqual(result, { code: null, signal: "SIGKILL" });
  assert.equal(message, undefined, "no response escaped before kill");
}
for (const crash of [
  "after-session-custody",
  "before-session-commit",
  "after-session-commit",
]) {
  test(
    "service SIGKILL " + crash + " retains only committed protected sessions",
    async (t) => {
      const f = await fixture(t);
      await killed(t, f, { action: "session", crash });
      const reopened = f.open();
      assert.equal(
        reopened.counts().sessions,
        crash === "after-session-commit" ? 1 : 0,
      );
      assert.equal(reopened.counts().operations, 0);
      await reopened.session("issue");
    },
  );
}
for (const crash of [
  "after-response-custody",
  "before-response-insert",
  "before-response-commit",
  "after-response-commit",
]) {
  test(
    "service SIGKILL " + crash + " preserves spend and exact recovery",
    async (t) => {
      const f = await fixture(t),
        old = await f.mint(),
        d = f.b.prepareClaim(await f.issuer.session("swap"), f.a.export(old)),
        v = f.pending(f.b, d);
      await killed(t, f, {
        action: "submit",
        crash,
        wire: v.wire,
        capability: v.capability,
      });
      const reopened = f.open(),
        committed = crash === "after-response-commit";
      assert.equal(reopened.counts().spent, committed ? 1 : 0);
      assert.equal(reopened.counts().operations, committed ? 2 : 1);
      assert.equal(reopened.recover(d, v.capability) !== null, committed);
      const response = await reopened.submit(v.wire, v.capability);
      assert.equal(reopened.recover(d, v.capability), response);
      assert.equal(reopened.counts().spent, 1);
      assert.equal(reopened.counts().operations, 2);
      f.b.acknowledge(d, p.hash(f.b.backup(d)));
      p.importBearer(
        f.b.export(f.b.accept(d, response)),
        p.trust(config.manifest),
      );
    },
  );
}
for (const crash of [
  "before-observation-snapshot-commit",
  "after-observation-snapshot-commit",
  "after-observation-sign",
  "before-observation-receipt-commit",
  "after-observation-receipt-commit",
]) {
  test(
    "status SIGKILL " + crash + " preserves snapshot and exact receipt",
    async (t) => {
      const f = await fixture(t),
        id = await f.mint(),
        o = new StateObserver(
          join(f.dir, "observer.db"),
          config.manifest,
          statusConfig.manifest,
          { now: () => 1000 },
        );
      t.after(() => o.close());
      const c = o.prepare(
          wallet,
          p.assetValue(asset, p.trust(config.manifest)),
          "86".repeat(32),
        ),
        wire = o.request(
          c.challenge,
          f.a.show(id, wallet, showingChallenge(c)),
        );
      await killed(t, f, { action: "observe", crash, wire });
      const reopened = f.open(),
        status = new ServiceStatus(reopened, {
          ...statusConfig,
          now: () => 1000,
        });
      t.after(() => status.close());
      assert.equal(
        reopened.counts().observations,
        crash === "before-observation-snapshot-commit" ? 0 : 1,
      );
      const saved = status.recover(wire);
      assert.equal(
        saved !== null,
        crash === "after-observation-receipt-commit",
      );
      const receipt = await status.observe(wire);
      if (saved) assert.equal(receipt, saved);
      assert.equal(o.accept(c.challenge, receipt).proofValid, true);
    },
  );
}
