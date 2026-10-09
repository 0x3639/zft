import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  chmodSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, request as httpRequest } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { initializePersistent, PersistentLab } from "./persistent.mjs";
import { backupPersistent, restorePersistent } from "./persistent-ops.mjs";
import { startBrowserLab } from "./browser-server.mjs";
import { Client } from "./client.mjs";
import { probeHealth } from "./health-probe.mjs";
import {
  HealthMonitor,
  MONITOR,
  MONITOR_FILE,
  HEALTH_BYTES,
} from "./health.mjs";
import * as p from "./profile.mjs";
const cli = fileURLToPath(new URL("./persistent-cli.mjs", import.meta.url));
const image = p.bytes(
  JSON.parse(readFileSync(new URL("./image-fixtures.json", import.meta.url)))
    .images[0].pngHex,
);
const run = promisify(execFile);
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return "http://127.0.0.1:" + server.address().port;
}
async function close(server) {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}
async function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "zft-health-test-")));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const s = createServer(),
    origin = await listen(s);
  await close(s);
  const dir = join(parent, "issuer"),
    root = join(parent, "build");
  mkdirSync(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    "<html><head><title>ZFT</title></head><body></body></html>",
  );
  initializePersistent(dir, Number(origin.split(":").at(-1)));
  return {
    dir,
    root,
    parent,
    start: () =>
      startBrowserLab({ product: true, productRoot: root, persistentDir: dir }),
  };
}
function descriptor(dir) {
  return p.parse(readFileSync(join(dir, MONITOR_FILE), "utf8"));
}
function healthRequest(
  r,
  d,
  headers = {},
  path = "/ops/health",
  method = "GET",
) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      r.origin + path,
      {
        method,
        agent: false,
        headers: {
          Authorization: "Bearer " + d.token,
          "X-PS-Health-Challenge": p.randomHex(16),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (v) => chunks.push(v));
        res.once("error", reject);
        res.once("end", () =>
          resolve({
            status: res.statusCode,
            headers: new Headers(res.headers),
            json: async () => JSON.parse(Buffer.concat(chunks)),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}
function issuerRequest(r, body, token = r.token) {
  return fetch(r.origin + "/issuer", {
    method: "POST",
    headers: {
      Connection: "close",
      Origin: r.origin,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: p.canonical(body),
  });
}
function snapshot(dir) {
  return Object.fromEntries(
    [
      "private.json",
      "pins.json",
      "ready.json",
      "issuer.db",
      "presentations.db",
      "run.lock",
      MONITOR_FILE,
    ].map((f) => [f, p.hash(readFileSync(join(dir, f)))]),
  );
}
async function fakeMonitor(t, handler) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "zft-health-peer-")));
  chmodSync(dir, 0o700);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const server = createServer(handler),
    origin = await listen(server);
  t.after(() => close(server));
  const d = {
    format: MONITOR,
    origin,
    instance: p.randomHex(32),
    token: p.randomHex(32),
  };
  writeFileSync(join(dir, MONITOR_FILE), p.canonical(d), { mode: 0o600 });
  return { dir, d };
}
test("health probe is read only and reports only aggregate fields while issuer remains locked", async (t) => {
  const f = await fixture(t),
    r = await f.start();
  try {
    const before = snapshot(f.dir),
      h = await probeHealth(f.dir);
    assert.equal(h.status, "ok");
    assert.deepEqual(h.warnings, {});
    assert.equal(h.counts.operations, 0);
    assert.equal(h.sequence, 0);
    assert.equal(h.enabled, true);
    assert.deepEqual(snapshot(f.dir), before);
    assert.throws(() => new PersistentLab(f.dir), /EEXIST/);
    const wire = JSON.stringify(h),
      secrets = [
        r.token,
        descriptor(f.dir).token,
        f.dir,
        ...Object.values(r.lab.config.secrets),
        r.lab.config.status_private,
      ];
    for (const secret of secrets)
      assert(
        !wire.includes(secret),
        "no keys capability or path in health output",
      );
    assert.deepEqual(
      Object.keys(h).sort(),
      "format instance challenge sampledAt uptimeMs enabled restoreReviewRequired sequence counts databases status warnings"
        .split(" ")
        .sort(),
    );
    assert.equal(statSync(join(f.dir, MONITOR_FILE)).mode & 0o777, 0o600);
  } finally {
    await r.close();
  }
  assert(!existsSync(join(f.dir, MONITOR_FILE)));
});
test("monitor capability cannot mint and launch capability cannot inspect health", async (t) => {
  const f = await fixture(t),
    r = await f.start();
  try {
    const d = descriptor(f.dir);
    assert.notEqual(d.token, r.token);
    assert.equal(
      (await healthRequest(r, d, { Authorization: "Bearer " + r.token }))
        .status,
      403,
    );
    assert.equal(
      (
        await healthRequest(r, d, {
          Authorization: "Bearer " + "00".repeat(32),
        })
      ).status,
      403,
    );
    assert.equal(
      (await issuerRequest(r, { action: "session", kind: "issue" }, d.token))
        .status,
      403,
    );
    assert.equal(r.lab.issuer.counts().sessions, 0);
    assert.equal((await probeHealth(f.dir)).status, "ok");
  } finally {
    await r.close();
  }
});
test("health route rejects browser origins duplicate headers bodies and alternate paths", async (t) => {
  const f = await fixture(t),
    r = await f.start();
  try {
    const d = descriptor(f.dir);
    for (const headers of [
      { Origin: r.origin },
      { Origin: "https://foreign.invalid" },
      { "Sec-Fetch-Site": "same-origin" },
      { Host: "localhost:" + r.origin.split(":").at(-1) },
    ])
      assert.equal((await healthRequest(r, d, headers)).status, 403);
    for (const path of ["/ops/health?x=1", "/ops/health/", "/ops/%68ealth"])
      assert.equal((await healthRequest(r, d, {}, path)).status, 404);
    assert.equal(
      (await healthRequest(r, d, {}, "/ops/health", "POST")).status,
      404,
    );
    assert.equal(
      (await healthRequest(r, d, { "X-PS-Health-Challenge": "bad" })).status,
      400,
    );
    const raw = (extra, body = "") =>
      new Promise((resolve, reject) => {
        const request = httpRequest(
          r.origin + "/ops/health",
          {
            method: "GET",
            agent: false,
            headers: [
              "Host",
              r.origin.slice(7),
              "Authorization",
              "Bearer " + d.token,
              "X-PS-Health-Challenge",
              "01".repeat(16),
              ...extra,
            ],
          },
          (res) => {
            res.resume();
            res.once("end", () => resolve(res.statusCode));
          },
        );
        request.once("error", reject);
        request.end(body);
      });
    assert.equal(await raw(["Authorization", "Bearer " + d.token]), 403);
    assert.equal(await raw(["Host", r.origin.slice(7)]), 403);
    assert.equal(await raw(["X-PS-Health-Challenge", "02".repeat(16)]), 400);
    assert.equal(await raw(["Content-Length", "1"], "x"), 400);
    const good = await healthRequest(r, d);
    assert.equal(good.headers.get("cache-control"), "no-store");
    assert.equal(good.headers.get("access-control-allow-origin"), null);
  } finally {
    await r.close();
  }
});
test("health reports real operations and suspension without interrupting exact recovery", async (t) => {
  const f = await fixture(t),
    r = await f.start();
  const c = new Client(join(f.parent, "client.db"), r.lab.manifest);
  try {
    const digest = c.prepareIssue(r.lab.issuer.session("issue"), image);
    c.acknowledge(digest, p.hash(c.backup(digest)));
    c.submit(digest, r.lab.issuer);
    const pending = p.parse(c.backup(digest), 300000),
      expected = r.lab.issuer.recover(digest, pending.capability);
    let h = await probeHealth(f.dir);
    assert.equal(h.counts.sessions, 1);
    assert.equal(h.counts.activeSessions, 0);
    assert.equal(h.counts.operations, 1);
    assert.equal(h.sequence, 1);
    r.lab.issuer.setEnabled(false);
    h = await probeHealth(f.dir);
    assert.equal(h.status, "attention");
    assert.equal(h.warnings.admission_suspended, true);
    const response = await issuerRequest(r, {
      action: "recover",
      digest,
      capability: pending.capability,
    });
    assert.equal((await response.json()).response, expected);
    assert.equal(
      (await issuerRequest(r, { action: "session", kind: "issue" })).status,
      400,
    );
  } finally {
    c.close();
    await r.close();
  }
});
test("health distinguishes approaching active session capacity and actual saturation", async (t) => {
  const f = await fixture(t),
    r = await f.start();
  try {
    const db = r.lab.issuer.db,
      put = db.prepare("INSERT INTO sessions VALUES (?,?,?,?)");
    // Synthetic rows qualify count thresholds only, not signature/proof validity.
    for (let i = 0; i < 79; i++)
      put.run(
        "health" + i,
        "synthetic",
        "not-a-secret",
        r.lab.issuer.now() + 300,
      );
    assert.equal((await probeHealth(f.dir)).status, "ok");
    put.run("health79", "synthetic", "not-a-secret", r.lab.issuer.now() + 300);
    assert.equal(
      (await probeHealth(f.dir)).warnings.activeSessions_pressure,
      true,
    );
    for (let i = 80; i < 100; i++)
      put.run(
        "health" + i,
        "synthetic",
        "not-a-secret",
        r.lab.issuer.now() + 300,
      );
    assert.equal(
      (await probeHealth(f.dir)).warnings.activeSessions_limit,
      true,
    );
    db.exec("UPDATE sessions SET expires=0");
    assert.equal((await probeHealth(f.dir)).counts.activeSessions, 0);
    const pages = db.prepare("PRAGMA page_count").get().page_count;
    db.exec("PRAGMA max_page_count=" + pages);
    assert.equal((await probeHealth(f.dir)).warnings.issuer_page_limit, true);
  } finally {
    await r.close();
  }
});
test("restored issuer health requires review even when policy is manually enabled", async (t) => {
  const f = await fixture(t),
    backup = join(f.parent, "backup"),
    restored = join(f.parent, "restored");
  const b = await backupPersistent(f.dir, backup);
  await restorePersistent(backup, restored, b.checkpoint);
  const r = await startBrowserLab({
    product: true,
    productRoot: f.root,
    persistentDir: restored,
  });
  try {
    r.lab.issuer.setEnabled(true);
    const h = await probeHealth(restored);
    assert.equal(h.enabled, true);
    assert.equal(h.status, "attention");
    assert.equal(h.restoreReviewRequired, true);
    assert.equal(h.warnings.restore_review_required, true);
  } finally {
    await r.close();
  }
});
test("health sampling failures are generic and cannot become an ok report", async (t) => {
  const f = await fixture(t),
    r = await f.start();
  try {
    r.lab.issuer.db.exec("DROP TABLE assets");
    const response = await healthRequest(r, descriptor(f.dir));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Local health snapshot unavailable.",
    });
    await assert.rejects(() => probeHealth(f.dir));
  } finally {
    await r.close();
  }
});
test("monitor rotates across restart and refuses the previous capability", async (t) => {
  const f = await fixture(t);
  let r = await f.start();
  const old = descriptor(f.dir);
  await r.close();
  // Simulate the well-formed descriptor that can remain after a crash; lock handling is separately tested.
  writeFileSync(join(f.dir, MONITOR_FILE), p.canonical(old), { mode: 0o600 });
  r = await f.start();
  try {
    const fresh = descriptor(f.dir);
    assert.notEqual(fresh.token, old.token);
    assert.notEqual(fresh.instance, old.instance);
    assert.equal((await healthRequest(r, old)).status, 403);
    assert.equal((await probeHealth(f.dir)).instance, fresh.instance);
  } finally {
    await r.close();
  }
});
test("unsafe monitor descriptors fail closed without replacing another file", async (t) => {
  const f = await fixture(t),
    target = join(f.dir, MONITOR_FILE),
    sentinel = join(f.parent, "sentinel");
  writeFileSync(sentinel, "unchanged", { mode: 0o600 });
  symlinkSync(sentinel, target);
  await assert.rejects(() => f.start());
  assert.equal(readFileSync(sentinel, "utf8"), "unchanged");
  assert(!existsSync(join(f.dir, "run.lock")));
  rmSync(target);
  const r = await f.start();
  const data = readFileSync(target);
  await r.close();
  writeFileSync(target, data, { mode: 0o644 });
  await assert.rejects(() => probeHealth(f.dir));
  await assert.rejects(() => f.start());
});
test("health CLI reports ok attention and unavailable with distinct exit codes and no keys", async (t) => {
  const f = await fixture(t),
    r = await f.start();
  const args = ["--experimental-sqlite", cli, "health", f.dir];
  try {
    const result = await run(process.execPath, args, { timeout: 10000 });
    assert.equal(JSON.parse(result.stdout).status, "ok");
    assert(!result.stdout.includes(descriptor(f.dir).token));
    r.lab.issuer.setEnabled(false);
    await assert.rejects(
      () => run(process.execPath, args, { timeout: 10000 }),
      (e) => e.code === 2 && JSON.parse(e.stdout).status === "attention",
    );
  } finally {
    await r.close();
  }
  await assert.rejects(
    () => run(process.execPath, args, { timeout: 10000 }),
    (e) =>
      e.code === 1 &&
      JSON.parse(e.stdout).status === "unavailable" &&
      !e.stdout.includes(f.dir),
  );
});
test("health is absent from disposable mode and private monitoring files are never served", async (t) => {
  const f = await fixture(t),
    r = await startBrowserLab();
  try {
    assert.equal((await fetch(r.origin + "/ops/health")).status, 404);
  } finally {
    await r.close();
  }
  const persistent = await f.start();
  try {
    for (const path of [
      "/monitor.json",
      "/ops/monitor.json",
      "/ps/monitor.json",
    ])
      assert.equal((await fetch(persistent.origin + path)).status, 404);
  } finally {
    await persistent.close();
  }
});
test("probe rejects off-loopback descriptors without making a request", async (t) => {
  let requests = 0;
  const f = await fakeMonitor(t, (_q, res) => {
    requests++;
    res.end();
  });
  for (const origin of [
    "https://127.0.0.1:1234",
    "http://localhost:1234",
    "http://127.0.0.1:1234/path",
    "http://example.invalid:1234",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:01234",
  ]) {
    writeFileSync(join(f.dir, MONITOR_FILE), p.canonical({ ...f.d, origin }));
    await assert.rejects(() => probeHealth(f.dir));
  }
  assert.equal(requests, 0);
});
test("probe refuses redirects oversized malformed and replayed responses", async (t) => {
  const f = await fixture(t),
    real = await f.start();
  let good;
  try {
    good = await probeHealth(f.dir);
  } finally {
    await real.close();
  }
  let mode = "redirect",
    calls = 0;
  const fake = await fakeMonitor(t, (req, res) => {
    calls++;
    if (mode === "redirect") {
      res.writeHead(302, { Location: "/other" });
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        mode === "large"
          ? "x".repeat(HEALTH_BYTES + 1)
          : mode === "json"
            ? "{}"
            : p.canonical({
                ...good,
                instance: mode === "instance" ? good.instance : fake.d.instance,
                challenge:
                  mode === "challenge"
                    ? good.challenge
                    : req.headers["x-ps-health-challenge"],
              }),
      );
    }
  });
  await assert.rejects(() => probeHealth(fake.dir));
  assert.equal(calls, 1);
  for (mode of ["large", "json", "instance", "challenge"])
    await assert.rejects(() => probeHealth(fake.dir));
});
test("probe enforces an absolute deadline even when peer trickles bytes", async (t) => {
  const f = await fakeMonitor(t, (_q, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write("{");
    const timer = setInterval(() => res.write(" "), 20);
    res.once("close", () => clearInterval(timer));
  });
  const start = performance.now();
  let guard;
  const outcome = await Promise.race([
    probeHealth(f.dir, { timeoutMs: 150 }).then(
      () => "accepted",
      () => "rejected",
    ),
    new Promise((resolve) => {
      guard = setTimeout(() => resolve("late"), 2000);
    }),
  ]);
  clearTimeout(guard);
  assert.equal(outcome, "rejected", "bounded complete response deadline");
  assert(performance.now() - start < 2000);
});

test("monitor startup preserves the original failure when temporary cleanup also fails", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "zft-health-cleanup-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Test-only synchronous filesystem faults; no device-failure qualification.
  for (const operation of ["writeFileSync", "renameSync"]) {
    for (const cleanupFails of [false, true]) {
      const original = Object.assign(new Error("injected " + operation), {
        code: "EIO",
      });
      const cleanup = Object.assign(new Error("injected cleanup"), {
        code: "EPERM",
      });
      const savedOperation = fs[operation],
        savedUnlink = fs.unlinkSync;
      let attempted;
      try {
        fs[operation] = () => {
          throw original;
        };
        fs.unlinkSync = (path) => {
          assert.equal(attempted, undefined, "one cleanup attempt");
          attempted = path;
          if (cleanupFails) throw cleanup;
          return savedUnlink(path);
        };
        syncBuiltinESMExports();
        assert.throws(
          () => new HealthMonitor({ dir }, null, "http://127.0.0.1:12345"),
          (error) => error === original,
          "original monitor startup error survives cleanup",
        );
        assert.equal(typeof attempted, "string", "temporary cleanup attempted");
        assert.equal(existsSync(attempted), cleanupFails, "cleanup outcome");
        assert.equal(
          existsSync(join(dir, MONITOR_FILE)),
          false,
          "failed descriptor unpublished",
        );
      } finally {
        fs[operation] = savedOperation;
        fs.unlinkSync = savedUnlink;
        syncBuiltinESMExports();
      }
    }
  }
});
