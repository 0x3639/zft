import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { fixture, config, asset, wallet } from "./test-support.mjs";
import { statusConfig } from "./status-test-support.mjs";
import { ServiceStatus } from "./status.mjs";
import { createServiceHandler, HTTP_LIMITS } from "./http.mjs";
import { ServiceClient } from "./client.mjs";
import { grant, revoke, pruneGrants, authorize } from "./admission.mjs";
import { health, HealthAlert } from "./operations.mjs";
import { StateObserver, showingChallenge } from "../local/state.mjs";
import * as p from "../local/profile.mjs";
async function server(t, options = {}) {
  const f = await fixture(t),
    issuer = options.issuer ? options.issuer(f) : f.issuer,
    status = new ServiceStatus(issuer, { ...statusConfig, now: () => 1000 });
  let handler;
  const server = http.createServer((req, res) => handler(req, res));
  server.headersTimeout = 5000;
  server.requestTimeout = 15000;
  server.maxHeadersCount = 32;
  server.maxConnections = 16;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  handler = createServiceHandler(
    { issuer, status },
    { origin, now: () => 1000, ...options.http },
  );
  const roles = Object.fromEntries(
    ["participant", "operator", "monitor"].map((r) => [
      r,
      grant(issuer.database, r, 60, 1000),
    ]),
  );
  const client = new ServiceClient(origin, roles.participant.token);
  t.after(() => {
    client.close();
    status.close();
    server.closeAllConnections();
    server.close();
  });
  const request = (path, body, extra = {}) =>
    new Promise((resolve, reject) => {
      const wire = body === undefined ? undefined : p.canonical(body);
      const req = http.request(
        origin + path,
        {
          method: body === undefined ? "GET" : "POST",
          ...extra,
          headers: {
            Origin: origin,
            Authorization: "Bearer " + roles.participant.token,
            ...(wire === undefined
              ? {}
              : {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(wire),
                }),
            ...extra.headers,
          },
        },
        (res) => {
          let text = "";
          res.on("data", (x) => (text += x));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(text),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(wire);
    });
  return { ...f, issuer, status, server, origin, roles, client, request };
}
const ack = (c, d) => c.acknowledge(d, p.hash(c.backup(d)));
test("HTTP client completes mint claim cancel state and exact recovery with unchanged client and observer", async (t) => {
  const f = await server(t);
  const d = f.a.prepareIssue(await f.client.session("issue"), asset);
  await assert.rejects(f.client.submit(f.a, d), /snapshot required/);
  ack(f.a, d);
  const id = await f.client.submit(f.a, d);
  assert.equal(await f.client.recover(f.a, d), id);
  const claim = f.b.prepareClaim(
    await f.client.session("swap"),
    f.a.export(id),
  );
  ack(f.b, claim);
  const claimed = await f.client.submit(f.b, claim);
  const cancel = f.b.prepareCancel(await f.client.session("swap"), claimed);
  ack(f.b, cancel);
  const current = await f.client.submit(f.b, cancel);
  const observer = new StateObserver(
    join(f.dir, "http-observer.db"),
    config.manifest,
    statusConfig.manifest,
    { now: () => 1000 },
  );
  t.after(() => observer.close());
  const c = observer.prepare(
      wallet,
      p.assetValue(asset, p.trust(config.manifest)),
      "84".repeat(32),
    ),
    wire = observer.request(
      c.challenge,
      f.b.show(current, wallet, showingChallenge(c)),
    );
  const receipt = await f.client.observe(wire);
  assert.equal(observer.accept(c.challenge, receipt).issuerReported, "unspent");
  assert.equal(f.issuer.counts().operations, 3);
  const stale = f.a.prepareCancel(await f.client.session("swap"), id);
  ack(f.a, stale);
  await assert.rejects(f.client.submit(f.a, stale));
  assert.equal(f.issuer.counts().operations, 3);
});
test("HTTP rejects missing wrong-role revoked and expired grants before custody", async (t) => {
  const f = await server(t);
  for (const token of [
    "",
    f.roles.monitor.token,
    f.roles.operator.token,
    "00".repeat(32),
  ])
    assert.equal(
      (
        await f.request(
          "/api/ps/session",
          { kind: "issue" },
          { headers: { Authorization: "Bearer " + token } },
        )
      ).status,
      400,
    );
  const expired = grant(f.issuer.database, "participant", 1, 900);
  assert.equal(
    (
      await f.request(
        "/api/ps/session",
        { kind: "issue" },
        { headers: { Authorization: "Bearer " + expired.token } },
      )
    ).status,
    400,
  );
  revoke(f.issuer.database, f.roles.participant.hash);
  assert.equal(
    (await f.request("/api/ps/session", { kind: "issue" })).status,
    400,
  );
  assert.equal(f.issuer.counts().sessions, 0);
});
test("HTTP requires exact host origin path method and refuses duplicate or proxy headers", async (t) => {
  const f = await server(t);
  for (const headers of [
    { Origin: "https://evil.invalid" },
    { Host: "localhost" },
    { Origin: [f.origin, f.origin] },
    {
      Authorization: [
        "Bearer " + f.roles.participant.token,
        "Bearer " + f.roles.participant.token,
      ],
    },
    { "X-Forwarded-Host": new URL(f.origin).host },
    { Forwarded: "for=127.0.0.1" },
    { Cookie: "ignored=x" },
    { "Sec-Fetch-Site": "cross-site" },
  ])
    assert.equal(
      (await f.request("/api/ps/session", { kind: "issue" }, { headers }))
        .status,
      400,
    );
  for (const path of [
    "/api/ps/session?x=1",
    "//api/ps/session",
    "/api/ps/%73ession",
  ])
    assert.equal((await f.request(path, { kind: "issue" })).status, 400);
  assert.equal((await f.request("/api/ps/session")).status, 400);
  assert.equal(f.issuer.counts().sessions, 0);
});
test("HTTP bounds body encodings and rejects unexpected fields without secret error output", async (t) => {
  const f = await server(t);
  for (const [body, headers] of [
    [{ kind: "issue", extra: true }, {}],
    [{ kind: "x".repeat(20000) }, {}],
    [{ kind: "issue" }, { "Content-Encoding": "gzip" }],
    [{ kind: "issue" }, { "Content-Type": "text/plain" }],
  ]) {
    const r = await f.request("/api/ps/session", body, { headers });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: "request-rejected" });
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  }
  assert.equal(f.issuer.counts().sessions, 0);
});
test("HTTP rechecks revoked grants before delayed custody can commit", async (t) => {
  let release, started;
  const ready = new Promise((r) => (started = r));
  const f = await server(t, {
    issuer: (f) =>
      f.open({
        transport: (req, options) => {
          started();
          return new Promise(
            (resolve) =>
              (release = async () =>
                resolve(await f.custody.transport(req, options))),
          );
        },
      }),
  });
  const request = f.request("/api/ps/session", { kind: "issue" });
  await ready;
  revoke(f.issuer.database, f.roles.participant.hash);
  await release();
  assert.equal((await request).status, 400);
  assert.equal(
    f.issuer.counts().sessions,
    0,
    "revoked delayed request must not commit",
  );
});
test("HTTP request deadline prevents delayed result from committing", async (t) => {
  let release, started;
  const ready = new Promise((r) => (started = r));
  const f = await server(t, {
    http: { deadlineMs: 100 },
    issuer: (f) =>
      f.open({
        transport: (req, options) => {
          started();
          return new Promise(
            (resolve) =>
              (release = async () => {
                try {
                  resolve(await f.custody.transport(req, options));
                } catch (e) {
                  resolve("late");
                }
              }),
          );
        },
      }),
  });
  const request = f.request("/api/ps/session", { kind: "issue" });
  await ready;
  assert.equal((await request).status, 503);
  await release();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.issuer.counts().sessions, 0);
});
test("HTTP applies bounded per-grant rates and monitor access returns only aggregate health", async (t) => {
  const f = await server(t);
  for (let n = 0; n < HTTP_LIMITS.perGrant; n++)
    assert.equal(
      (
        await f.request("/ops/health", undefined, {
          headers: { Authorization: "Bearer " + f.roles.monitor.token },
        })
      ).status,
      200,
    );
  assert.equal(
    (
      await f.request("/ops/health", undefined, {
        headers: { Authorization: "Bearer " + f.roles.monitor.token },
      })
    ).status,
    400,
  );
  assert.equal((await f.request("/ops/health")).status, 400);
  const h = health(f.issuer);
  assert.deepEqual(
    Object.keys(h).sort(),
    [
      "format",
      "status",
      "enabled",
      "restoreReviewRequired",
      "counts",
      "sequence",
      "uptimeSeconds",
      "pageCount",
      "pageSize",
      "warnings",
    ].sort(),
  );
  assert(!JSON.stringify(h).includes(f.roles.participant.token));
});
test("operator routes manage access while participants cannot change policy or issue grants", async (t) => {
  const f = await server(t),
    body = { role: "participant", ttl: 30 };
  assert.equal((await f.request("/ops/grant", body)).status, 400);
  const h = { Authorization: "Bearer " + f.roles.operator.token },
    g = await f.request("/ops/grant", body, { headers: h });
  assert.equal(g.status, 200);
  assert.equal(
    authorize(f.issuer.database, g.body.token, "participant", 1000).hash,
    g.body.hash,
  );
  assert.equal(
    (await f.request("/ops/revoke", { hash: g.body.hash }, { headers: h }))
      .status,
    200,
  );
  assert.throws(() =>
    authorize(f.issuer.database, g.body.token, "participant", 1000),
  );
  assert.equal(
    (await f.request("/ops/admission", { enabled: false }, { headers: h }))
      .status,
    200,
  );
  await assert.rejects(f.client.session("issue"));
});
test("retention removes only explicitly selected expired grants and preserves durable evidence", async (t) => {
  const f = await fixture(t);
  await f.mint();
  grant(f.issuer.database, "monitor", 1, 900);
  grant(f.issuer.database, "operator", 60, 1000);
  const before = f.issuer.counts();
  assert.deepEqual(pruneGrants(f.issuer.database, 1000), {
    eligible: 1,
    removed: 0,
  });
  assert.equal(
    f.issuer.database.prepare("SELECT count(*) AS n FROM grants").get().n,
    2,
  );
  assert.deepEqual(pruneGrants(f.issuer.database, 1000, { apply: true }), {
    eligible: 1,
    removed: 1,
  });
  assert.deepEqual(f.issuer.counts(), before);
  assert.equal(
    f.issuer.database.prepare("SELECT count(*) AS n FROM grants").get().n,
    1,
    "active grants survive retention",
  );
});
test("alerts deliver only fixed aggregates, deduplicate acknowledged states and sanitize failures", async (t) => {
  const f = await fixture(t),
    events = [],
    a = new HealthAlert((event) => {
      events.push(event);
      return true;
    });
  t.after(() => a.close());
  assert.deepEqual(await a.sample(f.issuer), { changed: true });
  assert.deepEqual(await a.sample(f.issuer), { changed: false });
  f.issuer.setEnabled(false);
  assert.deepEqual(await a.sample(f.issuer), { changed: true });
  assert.deepEqual(
    events.map((e) => e.warnings),
    [[], ["suspended"]],
  );
  a.close();
  await assert.rejects(a.sample(f.issuer), { code: "ERR_PS_ALERT_CLOSED" });
  const denied = new HealthAlert(() => {
    throw new Error("secret provider detail");
  });
  t.after(() => denied.close());
  await assert.rejects(
    denied.sample(f.issuer),
    (e) =>
      e.code === "ERR_PS_ALERT_UNAVAILABLE" &&
      !e.message.includes("secret") &&
      !e.cause,
  );
});
test("HTTP bounds simultaneous provider work and does not queue new requests", async (t) => {
  const releases = [],
    starts = [];
  const f = await server(t, {
    issuer: (f) =>
      f.open({
        transport: (req, options) => {
          starts.push(req);
          return new Promise((resolve) =>
            releases.push(async () =>
              resolve(await f.custody.transport(req, options)),
            ),
          );
        },
      }),
  });
  const pending = Array.from({ length: 4 }, () =>
    f.request("/api/ps/session", { kind: "issue" }),
  );
  while (starts.length < 4) await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    (await f.request("/api/ps/session", { kind: "issue" })).status,
    400,
  );
  assert.equal(starts.length, 4);
  await Promise.all(releases.map((r) => r()));
  assert((await Promise.all(pending)).every((r) => r.status === 200));
  assert.equal(f.issuer.counts().sessions, 4);
});
test("HTTP body deadline closes a stalled upload without custody work", async (t) => {
  const f = await server(t, { http: { deadlineMs: 100 } });
  const result = await new Promise((resolve, reject) => {
    const req = http.request(
      f.origin + "/api/ps/session",
      {
        method: "POST",
        headers: {
          Origin: f.origin,
          Authorization: "Bearer " + f.roles.participant.token,
          "Content-Type": "application/json",
          "Content-Length": "20",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.write("{");
  });
  assert.equal(result, 503);
  assert.equal(f.issuer.counts().sessions, 0);
});
