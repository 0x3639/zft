import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { request } from "node:http";
import {
  BrowserLab,
  MAX_OPERATIONS,
  MAX_BACKUPS,
  MAX_BODY,
} from "./browser-lab.mjs";
import { startBrowserLab } from "./browser-server.mjs";
import * as p from "./profile.mjs";
import { importImage } from "./image.mjs";
const password = "public browser test password";
function local(t) {
  const lab = new BrowserLab();
  t.after(() => lab.close());
  return lab;
}
const wire = (r) => Buffer.from(r.download.base64, "base64").toString("utf8");
const state = (lab) => lab.dispatch({ action: "state" }).state;
function mint(lab, actor = "alice", fixture = 0) {
  lab.dispatch({ action: "mint", actor, fixture });
  return state(lab)
    .operations.filter((o) => o.actor === actor)
    .at(-1).digest;
}
function backup(lab, actor, digest) {
  const r = lab.dispatch({ action: "backup", actor, digest, password });
  return { file: wire(r), backup: r.state.backups.at(-1).id };
}
function acknowledge(lab, actor, digest, b) {
  return lab.dispatch({ action: "acknowledge", actor, digest, ...b, password });
}
function submit(lab, actor, digest, loseResponse = false) {
  return lab.dispatch({ action: "submit", actor, digest, loseResponse });
}
function issued(lab) {
  const digest = mint(lab);
  const b = backup(lab, "alice", digest);
  acknowledge(lab, "alice", digest, b);
  submit(lab, "alice", digest);
  return state(lab).credentials.at(-1).id;
}
function api(running, value, extra = {}) {
  const body =
    typeof value === "string" || Buffer.isBuffer(value)
      ? value
      : p.canonical(value);
  return new Promise((resolve, reject) => {
    const req = request(
      running.origin + "/api",
      {
        method: "POST",
        headers: {
          Host: new URL(running.origin).host,
          Origin: running.origin,
          Authorization: "Bearer " + running.token,
          "Content-Type": "application/json",
          ...extra,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
            value: JSON.parse(data),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
async function httpLab(t) {
  const r = await startBrowserLab();
  t.after(() => r.close());
  return r;
}

test("browser recovery reselection gates submission and restores a lost response", () => {
  const lab = new BrowserLab();
  try {
    const digest = mint(lab);
    const before = state(lab);
    assert.throws(
      () => submit(lab, "alice", digest),
      /recovery snapshot required/,
    );
    const b = backup(lab, "alice", digest);
    assert.equal(state(lab).operations[0].acknowledged, false);
    assert.throws(() =>
      acknowledge(lab, "alice", digest, { ...b, file: b.file.slice(0, -1) }),
    );
    assert.throws(() =>
      lab.dispatch({
        action: "acknowledge",
        actor: "alice",
        digest,
        ...b,
        password: "different public password",
      }),
    );
    assert.equal(state(lab).operations[0].acknowledged, false);
    assert.equal(state(lab).counts.operations, before.counts.operations);
    acknowledge(lab, "alice", digest, b);
    const lost = submit(lab, "alice", digest, true);
    assert.match(lost.message, /deliberately lost/);
    assert.equal(lost.state.counts.operations, 1);
    assert.equal(lost.state.credentials.length, 0);
    lab.dispatch({ action: "restore", ...b, password });
    const recovered = lab.dispatch({
      action: "recover",
      actor: "restored",
      digest,
    });
    assert.equal(recovered.state.credentials[0].actor, "restored");
    assert.equal(recovered.state.counts.operations, 1);
    const id = recovered.state.credentials[0].id;
    lab.dispatch({ action: "recover", actor: "restored", digest });
    const file = lab.dispatch({
      action: "export",
      actor: "restored",
      credential: id,
      public: false,
    });
    assert(
      importImage(Buffer.from(file.download.base64, "base64"), lab.manifest),
    );
    const publicFile = lab.dispatch({
      action: "export",
      actor: "restored",
      credential: id,
      public: true,
    });
    assert.equal(publicFile.download.base64, state(lab).fixtures[0].base64);
    assert.throws(() =>
      importImage(
        Buffer.from(publicFile.download.base64, "base64"),
        lab.manifest,
      ),
    );
  } finally {
    lab.close();
  }
});

test("browser copied image claims and cancellation keep stale copies rejected", (t) => {
  const lab = local(t),
    id = issued(lab);
  const file = lab.dispatch({
    action: "export",
    actor: "alice",
    credential: id,
    public: false,
  }).download.base64;
  lab.dispatch({ action: "claim", actor: "bob", file });
  const d = state(lab).operations.at(-1).digest;
  acknowledge(lab, "bob", d, backup(lab, "bob", d));
  submit(lab, "bob", d);
  const bob = state(lab).credentials.find((c) => c.actor === "bob").id;
  lab.dispatch({ action: "cancel", actor: "bob", credential: bob });
  const cancel = state(lab).operations.at(-1).digest;
  acknowledge(lab, "bob", cancel, backup(lab, "bob", cancel));
  submit(lab, "bob", cancel);
  assert.equal(
    state(lab).credentials.find((c) => c.id === bob).locallySpent,
    true,
  );
  lab.dispatch({ action: "claim", actor: "alice", file });
  const stale = state(lab).operations.at(-1).digest;
  acknowledge(lab, "alice", stale, backup(lab, "alice", stale));
  assert.throws(() => submit(lab, "alice", stale), /already spent/);
  assert.equal(state(lab).counts.operations, 3);
});

test("browser encrypted bearer export can prepare a verified claim", (t) => {
  const lab = local(t),
    id = issued(lab),
    r = lab.dispatch({
      action: "saveBearer",
      actor: "alice",
      credential: id,
      password,
    });
  const backupId = r.state.backups.at(-1).id;
  lab.dispatch({
    action: "claimVault",
    actor: "bob",
    backup: backupId,
    file: wire(r),
    password,
  });
  const d = state(lab).operations.at(-1).digest;
  acknowledge(lab, "bob", d, backup(lab, "bob", d));
  submit(lab, "bob", d);
  assert.equal(state(lab).counts.spent, 1);
});

test("browser state excludes private snapshots credentials and capabilities", (t) => {
  const lab = local(t),
    id = issued(lab),
    d = state(lab).operations[0].digest;
  const snapshot = p.parse(lab.client("alice").backup(d), 300000),
    envelope = lab.client("alice").export(id);
  const serialized = JSON.stringify(state(lab));
  for (const secret of [
    snapshot.secret,
    snapshot.capability,
    snapshot.wire,
    envelope,
  ])
    assert(!serialized.includes(secret));
  assert.deepEqual(state(lab).manifest, lab.manifest);
  assert.equal(p.trust(state(lab).manifest).pk.id, lab.manifest.keyset_id);
});

test("browser validates file and actor inputs before creating issuer sessions", (t) => {
  const lab = local(t),
    before = state(lab);
  for (const bad of [
    { action: "claim", actor: "alice", file: "!!!!" },
    { action: "claim", actor: "alice", file: before.fixtures[0].base64 },
    { action: "mint", actor: "../../outside", fixture: 0 },
    { action: "mint", actor: "alice", fixture: 99 },
    { action: "mint", actor: "alice", fixture: 0, extra: "bad" },
    { action: "cancel", actor: "alice", credential: "not-an-id" },
  ])
    assert.throws(() => lab.dispatch(bad));
  assert.deepEqual(state(lab), before);
});

test("browser backup identity actor and operation cannot be substituted", (t) => {
  const lab = local(t),
    a = mint(lab),
    b = mint(lab, "bob", 1),
    saved = backup(lab, "alice", a);
  assert.throws(() => acknowledge(lab, "bob", b, saved), /backup actor/);
  assert.throws(
    () => acknowledge(lab, "alice", a, { ...saved, backup: "ff".repeat(16) }),
    /identity/,
  );
  assert.throws(() =>
    lab.dispatch({
      action: "restore",
      ...saved,
      file: saved.file.replace('"vault_id":"', '"vault_id":"aa'),
      password,
    }),
  );
  assert(state(lab).operations.every((o) => !o.acknowledged));
  assert.equal(
    lab.client("restored").db.prepare("SELECT count(*) AS n FROM pending").get()
      .n,
    0,
  );
});

test("browser bounds operation and encrypted export growth", (t) => {
  const lab = local(t),
    d = mint(lab);
  for (let i = 0; i < MAX_BACKUPS; i++) backup(lab, "alice", d);
  assert.throws(() => backup(lab, "alice", d), /backup export limit/);
  assert.equal(state(lab).operations[0].acknowledged, false);
  for (let i = 1; i < MAX_OPERATIONS; i++) mint(lab);
  const before = state(lab).counts;
  assert.throws(() => mint(lab), /operation limit/);
  assert.deepEqual(state(lab).counts, before);
});

test("browser shutdown removes private stores and a new realm rejects old files", (t) => {
  const old = new BrowserLab(),
    dir = old.dir;
  const id = issued(old),
    file = old.dispatch({
      action: "export",
      actor: "alice",
      credential: id,
      public: false,
    }).download.base64;
  assert.equal(statSync(dir).mode & 0o077, 0);
  old.close();
  assert.equal(existsSync(dir), false);
  assert.throws(() => old.dispatch({ action: "state" }), /closed lab/);
  const next = local(t);
  assert.notEqual(next.manifest.realm, old.manifest.realm);
  assert.throws(() => next.dispatch({ action: "claim", actor: "bob", file }));
  assert.equal(state(next).counts.sessions, 0);
});

test("browser HTTP rejects foreign origins and missing launch capabilities", async (t) => {
  const r = await httpLab(t),
    before = state(r.lab);
  for (const extra of [
    { Origin: "https://other.example" },
    { Origin: "null" },
    { Origin: "" },
    { Origin: [r.origin, r.origin] },
    { Authorization: "" },
    { Authorization: "Bearer " + "00".repeat(32) },
    { Host: "localhost:" + new URL(r.origin).port },
    { Host: "other.example" },
  ]) {
    const out = await api(
      r,
      { action: "mint", actor: "alice", fixture: 0 },
      extra,
    );
    assert.equal(out.status, 403);
    assert.equal(out.headers["access-control-allow-origin"], undefined);
  }
  assert.deepEqual(state(r.lab), before);
});

test("browser HTTP has strict bounded bodies and generic secret-free errors", async (t) => {
  const r = await httpLab(t),
    before = state(r.lab);
  for (const body of [
    '{"action":"state","action":"mint"}',
    '{ "action": "state" }',
    p.canonical({ action: "state", password: "do-not-echo-this" }),
    p.canonical({ action: "mint", actor: "alice", fixture: 99 }),
    Buffer.from([0xff]),
  ]) {
    const out = await api(r, body);
    assert.equal(out.status, 400);
    assert(!out.body.includes("do-not-echo-this"));
    assert(!out.body.includes(r.lab.dir));
  }
  const media = await api(
    r,
    { action: "state" },
    { "Content-Type": "text/plain" },
  );
  assert.equal(media.status, 415);
  // Actual chunked bytes are bounded, independently of an omitted Content-Length.
  let rejected = false;
  try {
    const out = await api(r, " ".repeat(MAX_BODY + 1));
    rejected = out.status === 400;
  } catch (error) {
    assert(["ECONNRESET", "EPIPE"].includes(error.code));
    rejected = true;
  }
  assert(rejected);
  assert.deepEqual(state(r.lab), before);
  assert.equal((await api(r, { action: "state" })).status, 200);
});

test("browser HTTP serves only fixed assets with restrictive response policy", async (t) => {
  const r = await httpLab(t);
  const page = await fetch(r.origin);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(html.includes("Disposable research"));
  assert(!html.includes(r.token));
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert(
    page.headers.get("content-security-policy").includes("connect-src 'self'"),
  );
  assert(
    page.headers.get("content-security-policy").includes("worker-src 'self'"),
  );
  for (const path of [
    "/vault/",
    "/vault/style.css",
    "/web/worker.mjs",
    "/web/vault.mjs",
    "/web/profile.mjs",
    "/vendor/@noble/hashes/scrypt.js",
    "/licenses/noble-curves",
    "/licenses/noble-hashes",
  ]) {
    const asset = await fetch(r.origin + path);
    assert.equal(asset.status, 200, path);
    const text = await asset.text();
    assert(!text.includes(r.token));
    if (path.endsWith(".mjs") || path.endsWith(".js")) {
      assert.match(asset.headers.get("content-type"), /javascript/);
      assert(!/["']node:/.test(text));
    }
    if (path.startsWith("/licenses/")) assert(text.includes("MIT License"));
  }
  for (const path of [
    "/api",
    "/vectors.json",
    "/web/modules.mjs",
    "/web/local/client.mjs",
    "/vendor/@noble/hashes/package.json",
    "/../vault.mjs",
    "/?token=" + r.token,
  ])
    assert.equal((await fetch(r.origin + path)).status, 404);
  assert.equal(
    (await fetch(r.origin + "/api", { method: "OPTIONS" })).status,
    404,
  );
});

test("browser real HTTP transports exact encrypted recovery and replays safely", async (t) => {
  const r = await httpLab(t);
  const call = async (value) => {
    const out = await api(r, value);
    assert.equal(out.status, 200, out.body);
    return out.value;
  };
  const prepared = await call({ action: "mint", actor: "alice", fixture: 0 }),
    d = prepared.state.operations[0].digest;
  assert.equal(
    (
      await api(r, {
        action: "submit",
        actor: "alice",
        digest: d,
        loseResponse: false,
      })
    ).status,
    400,
  );
  const saved = await call({
      action: "backup",
      actor: "alice",
      digest: d,
      password,
    }),
    b = saved.state.backups[0].id;
  await call({
    action: "acknowledge",
    actor: "alice",
    digest: d,
    backup: b,
    file: wire(saved),
    password,
  });
  const lost = await call({
    action: "submit",
    actor: "alice",
    digest: d,
    loseResponse: true,
  });
  assert.equal(lost.state.credentials.length, 0);
  await call({ action: "restore", backup: b, file: wire(saved), password });
  const final = await call({ action: "recover", actor: "restored", digest: d });
  assert.equal(final.state.credentials.length, 1);
  assert.equal(final.state.counts.operations, 1);
});
