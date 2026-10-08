import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { browserModules } from "../web/modules.mjs";
import { fixture, asset } from "./test-support.mjs";
import { BrowserIssuer } from "./browser-client-api.mjs";
import { startBrowserLab } from "./browser-server.mjs";
import { LocalVault } from "./vault.mjs";
import * as p from "./profile.mjs";
const dir = mkdtempSync(join(tmpdir(), "zft-client-esm-"));
for (const [url, source] of browserModules()) {
  const path = join(dir, url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}
after(() => rmSync(dir, { recursive: true, force: true }));
const load = (n) => import(pathToFileURL(join(dir, "web", n)));
const { BrowserClient } = await load("client.mjs");
const { openState, sealState, MAX_FILE } = await load("client-cipher.mjs");
const password = "public browser client password";
function storage() {
  const store = { wire: null, revision: 0, fail: false, hold: null };
  store.persist = async (wire, expected) => {
    if (store.hold) await store.hold;
    if (store.fail) throw new Error("injected abort");
    assert.equal(expected, store.revision, "stale browser write");
    store.wire = wire;
    return ++store.revision;
  };
  return store;
}
async function client(f, id = p.randomHex(16), store = storage()) {
  return {
    id,
    store,
    c: await BrowserClient.create(
      f.issuer.pinned.manifest,
      id,
      password,
      store.persist,
    ),
  };
}
async function reopen(f, a) {
  a.c.lock();
  a.c = await BrowserClient.open(
    a.store.wire,
    password,
    f.issuer.pinned.manifest,
    a.id,
    a.store.revision,
    a.store.persist,
  );
  return a.c;
}
async function prepared(f, a) {
  const { digest } = await a.c.prepareIssue(f.issuer.session("issue"), asset);
  return digest;
}
async function ready(a, d) {
  const backup = await a.c.backup(d, password);
  await a.c.acknowledge(d, backup.wire, password);
  return backup;
}
async function submit(f, a, d) {
  const body = a.c.submission(d);
  return a.c.accept(d, f.issuer.submit(body.wire, body.capability));
}
async function issued(f, a) {
  const d = await prepared(f, a);
  await ready(a, d);
  return { d, ...(await submit(f, a, d)) };
}
async function decoded(f, a) {
  return openState(a.store.wire, password, f.issuer.pinned.manifest, a.id);
}

test("browser client completes encrypted mint claim cancel and rejects stale bearer", async (t) => {
  const f = fixture(t),
    a = await client(f),
    b = await client(f),
    { id } = await issued(f, a);
  const transfer = await a.c.export(id, password);
  assert.equal(
    LocalVault.open(
      transfer.wire,
      password,
      f.issuer.pinned.manifest,
      transfer.id,
    ).list()[0].kind,
    "bearer",
  );
  const claim = await b.c.prepareClaim(
    f.issuer.session("swap"),
    transfer.wire,
    password,
    transfer.id,
  );
  await ready(b, claim.digest);
  const owned = await submit(f, b, claim.digest);
  await reopen(f, b);
  assert.equal(b.c.summary().credentials[0].id, owned.id);
  const cancel = await b.c.prepareCancel(f.issuer.session("swap"), owned.id);
  await ready(b, cancel.digest);
  await submit(f, b, cancel.digest);
  await assert.rejects(() => b.c.export(owned.id, password));
  const stale = await a.c.prepareClaim(
    f.issuer.session("swap"),
    transfer.wire,
    password,
    transfer.id,
  );
  await ready(a, stale.digest);
  const req = a.c.submission(stale.digest);
  assert.throws(
    () => f.issuer.submit(req.wire, req.capability),
    /already spent/,
  );
  assert.equal(f.issuer.counts().operations, 3);
});
test("browser client requires persisted exact recovery reselection before any submission", async (t) => {
  const f = fixture(t),
    a = await client(f),
    d = await prepared(f, a);
  assert.throws(() => a.c.submission(d), /recovery file required/);
  const b = await a.c.backup(d, password);
  const before = a.store.wire;
  await assert.rejects(() => a.c.acknowledge(d, b.wire + " ", password));
  await assert.rejects(() =>
    a.c.acknowledge(d, b.wire, "wrong public password"),
  );
  assert.equal(a.store.wire, before);
  assert.throws(() => a.c.submission(d));
  a.store.fail = true;
  await assert.rejects(
    () => a.c.acknowledge(d, b.wire, password),
    /injected abort/,
  );
  assert.throws(() => a.c.submission(d));
  a.store.fail = false;
  await a.c.acknowledge(d, b.wire, password);
  await reopen(f, a);
  assert.equal(a.c.submission(d).action, "submit");
});
test("browser client aborted preparation never exposes a pending request", async (t) => {
  const f = fixture(t),
    a = await client(f),
    before = a.store.wire;
  a.store.fail = true;
  await assert.rejects(() => prepared(f, a), /injected abort/);
  assert.equal(a.c.summary().operations.length, 0);
  assert.equal(a.store.wire, before);
  assert.equal(f.issuer.counts().operations, 0);
});
test("browser client response loss restores in a third client without reminting", async (t) => {
  const f = fixture(t),
    a = await client(f),
    d = await prepared(f, a),
    backup = await ready(a, d),
    req = a.c.submission(d);
  const response = f.issuer.submit(req.wire, req.capability);
  a.c.lock();
  const third = await client(f);
  await third.c.restore(backup.wire, password, backup.id);
  const recovery = third.c.submission(d, true);
  assert.equal(f.issuer.recover(d, recovery.capability), response);
  await third.c.accept(d, response);
  await reopen(f, third);
  assert.equal(third.c.summary().operations[0].complete, true);
  assert.equal(f.issuer.counts().operations, 1);
});
test("browser client failed acceptance retains pending ciphertext and exact retry", async (t) => {
  const f = fixture(t),
    a = await client(f),
    d = await prepared(f, a);
  await ready(a, d);
  const body = a.c.submission(d),
    response = f.issuer.submit(body.wire, body.capability),
    before = a.store.wire;
  a.store.fail = true;
  await assert.rejects(() => a.c.accept(d, response), /injected abort/);
  assert.equal(a.store.wire, before);
  assert.equal(a.c.summary().credentials.length, 0);
  a.store.fail = false;
  await reopen(f, a);
  assert.deepEqual(a.c.submission(d), body);
  await a.c.accept(d, f.issuer.submit(body.wire, body.capability));
  assert.equal(f.issuer.counts().operations, 1);
});
test("browser client never persists invalid issuer responses", async (t) => {
  const f = fixture(t),
    a = await client(f),
    d = await prepared(f, a);
  await ready(a, d);
  const r = a.c.submission(d),
    response = p.parse(f.issuer.submit(r.wire, r.capability)),
    before = a.store.wire;
  for (const patch of [
    { digest: "00".repeat(32) },
    { u: p.encodedPoint(p.G1) },
    { v: p.encodedPoint(p.G1) },
    { realm: "ff".repeat(32) },
  ])
    await assert.rejects(() =>
      a.c.accept(d, p.canonical({ ...response, ...patch })),
    );
  assert.equal(a.store.wire, before);
  assert.equal(a.c.summary().credentials.length, 0);
});
test("browser client stale writer cannot replace a newer encrypted journal", async (t) => {
  const f = fixture(t),
    a = await client(f),
    stale = await BrowserClient.open(
      a.store.wire,
      password,
      f.issuer.pinned.manifest,
      a.id,
      a.store.revision,
      a.store.persist,
    );
  const d = await prepared(f, a),
    before = a.store.wire;
  await assert.rejects(
    () => stale.prepareIssue(f.issuer.session("issue"), p.utf8("other")),
    /stale browser write/,
  );
  assert.equal(a.store.wire, before);
  assert.equal(stale.summary().operations.length, 0);
  assert.equal((await decoded(f, a)).operations[d].acknowledged, false);
});
test("browser client lock during encryption prevents delayed persistence", async (t) => {
  const f = fixture(t),
    a = await client(f),
    before = a.store.wire;
  const attempt = prepared(f, a);
  a.c.lock();
  await assert.rejects(attempt, /locked/);
  assert.equal(a.store.wire, before);
  assert.throws(() => a.c.summary());
});
test("browser client lock after persistence starts cannot reopen completed ciphertext", async (t) => {
  const f = fixture(t),
    a = await client(f);
  let release, entered;
  const saved = a.store.persist;
  // Use a separately opened instance with an observable transaction-completion barrier.
  const gate = new Promise((r) => (entered = r));
  const c = await BrowserClient.open(
    a.store.wire,
    password,
    f.issuer.pinned.manifest,
    a.id,
    a.store.revision,
    async (w, r) => {
      entered();
      await new Promise((done) => (release = done));
      return saved(w, r);
    },
  );
  const attempt = c.prepareIssue(f.issuer.session("issue"), asset);
  await gate;
  c.lock();
  release();
  await assert.rejects(attempt, /locked/);
  assert.throws(() => c.summary());
  await reopen(f, a);
  assert.equal(a.c.summary().operations.length, 1);
  assert.equal(a.c.summary().operations[0].acknowledged, false);
});
test("browser client replayed recovery never revives a locally spent credential", async (t) => {
  const f = fixture(t),
    a = await client(f),
    d = await prepared(f, a),
    backup = await ready(a, d),
    { id } = await submit(f, a, d);
  const cancel = await a.c.prepareCancel(f.issuer.session("swap"), id);
  await ready(a, cancel.digest);
  await submit(f, a, cancel.digest);
  await a.c.restore(backup.wire, password, backup.id);
  const req = a.c.submission(d, true);
  await assert.doesNotReject(() =>
    a.c.accept(d, f.issuer.recover(d, req.capability)),
  );
  await assert.rejects(() => a.c.export(id, password));
  assert(a.c.summary().credentials.find((c) => c.id === id).locallySpent);
});
test("browser client prevents a second pending spend of the same source", async (t) => {
  const f = fixture(t),
    a = await client(f),
    { id } = await issued(f, a);
  await a.c.prepareCancel(f.issuer.session("swap"), id);
  const before = a.store.wire;
  await assert.rejects(
    () => a.c.prepareCancel(f.issuer.session("swap"), id),
    /source already pending/,
  );
  assert.equal(a.store.wire, before);
});
test("browser client unknown recovery preserves the saved request", async (t) => {
  const f = fixture(t),
    a = await client(f),
    d = await prepared(f, a);
  await ready(a, d);
  const before = a.store.wire,
    r = a.c.submission(d, true);
  assert.equal(f.issuer.recover(r.digest, r.capability), null);
  await assert.rejects(() => a.c.accept(d, null));
  assert.equal(a.store.wire, before);
});
test("browser client encrypted state rejects wrong password pins and tampering", async (t) => {
  const f = fixture(t),
    a = await client(f),
    manifest = f.issuer.pinned.manifest;
  await assert.rejects(() =>
    BrowserClient.open(
      a.store.wire,
      "wrong public password",
      manifest,
      a.id,
      a.store.revision,
      a.store.persist,
    ),
  );
  await assert.rejects(() =>
    BrowserClient.open(
      a.store.wire,
      password,
      manifest,
      "00".repeat(16),
      a.store.revision,
      a.store.persist,
    ),
  );
  await assert.rejects(() =>
    BrowserClient.open(
      a.store.wire,
      password,
      { ...manifest, realm: "00".repeat(32) },
      a.id,
      a.store.revision,
      a.store.persist,
    ),
  );
  for (const field of ["salt", "iv", "ciphertext", "tag"]) {
    const v = p.parse(a.store.wire, MAX_FILE);
    v[field] = (v[field][0] === "0" ? "1" : "0") + v[field].slice(1);
    await assert.rejects(() =>
      BrowserClient.open(
        p.canonical(v),
        password,
        manifest,
        a.id,
        a.store.revision,
        a.store.persist,
      ),
    );
  }
});
test("browser client authenticates and validates restored working state", async (t) => {
  const f = fixture(t),
    a = await client(f),
    d = await prepared(f, a),
    state = await decoded(f, a),
    manifest = f.issuer.pinned.manifest;
  const bad = structuredClone(state);
  bad.operations[d].snapshot = p.canonical({
    ...p.parse(bad.operations[d].snapshot, 300000),
    secret: "01".repeat(32),
  });
  await assert.rejects(() =>
    sealState(bad, password).then((w) =>
      BrowserClient.open(
        w,
        password,
        manifest,
        a.id,
        a.store.revision,
        a.store.persist,
      ),
    ),
  );
  const gate = structuredClone(state);
  gate.operations[d].acknowledged = true;
  await assert.rejects(() =>
    sealState(gate, password).then((w) =>
      BrowserClient.open(
        w,
        password,
        manifest,
        a.id,
        a.store.revision,
        a.store.persist,
      ),
    ),
  );
});
test("browser client summaries and encrypted storage do not expose authority", async (t) => {
  const f = fixture(t),
    a = await client(f),
    d = await prepared(f, a),
    state = await decoded(f, a),
    pending = p.parse(state.operations[d].snapshot, 300000);
  for (const out of [JSON.stringify(a.c.summary()), a.store.wire])
    for (const secret of [
      pending.secret,
      pending.capability,
      state.operations[d].snapshot,
      password,
    ])
      assert(!out.includes(secret));
  const out = JSON.parse(a.store.wire);
  assert.deepEqual(
    Object.keys(out).sort(),
    "cipher ciphertext client_id format iv kdf manifest salt tag"
      .split(" ")
      .sort(),
  );
});
test("browser client operation bound rejects before replacing journal", async (t) => {
  const f = fixture(t),
    a = await client(f);
  for (let i = 0; i < 8; i++)
    await a.c.prepareIssue(f.issuer.session("issue"), p.utf8("bounded " + i));
  const before = a.store.wire;
  await assert.rejects(() => prepared(f, a), /capacity/);
  assert.equal(a.store.wire, before);
});
test("browser client issuer surface only accepts public requests and retrieval capability", async (t) => {
  const f = fixture(t),
    api = new BrowserIssuer(f.issuer),
    b = api.dispatch({ action: "bootstrap" }),
    a = await client(f, b.clients.alice);
  const { digest } = await a.c.prepareIssue(
    api.dispatch({ action: "session", kind: "issue" }).session,
    asset,
  );
  await ready(a, digest);
  const request = a.c.submission(digest),
    response = api.dispatch(request).response;
  await a.c.accept(digest, response);
  assert.equal(
    f.a.db.prepare("SELECT COUNT(*) AS n FROM credentials").get().n,
    0,
  );
  assert.equal(f.b.db.prepare("SELECT COUNT(*) AS n FROM pending").get().n, 0);
  for (const input of [
    { action: "submit", ...request, password },
    { action: "unknown" },
    { action: "session", kind: "swap", secret: "bad" },
    { action: "submit", wire: "x".repeat(12289), capability: "00".repeat(32) },
  ])
    assert.throws(() => api.dispatch(input));
  const again = api.dispatch(a.c.submission(digest, true));
  assert.equal(again.response, response);
});
test("browser client HTTP issuer requires loopback authorization and exact schemas", async (t) => {
  const r = await startBrowserLab();
  t.after(() => r.close());
  async function api(value, extra = {}) {
    const out = await fetch(r.origin + "/issuer", {
      method: "POST",
      headers: {
        Origin: r.origin,
        Authorization: "Bearer " + r.token,
        "Content-Type": "application/json",
        ...extra,
      },
      body: p.canonical(value),
    });
    return { status: out.status, body: await out.json() };
  }
  assert.equal(
    (await api({ action: "bootstrap" }, { Origin: "https://foreign.invalid" }))
      .status,
    403,
  );
  assert.equal(
    (
      await api(
        { action: "bootstrap" },
        { Authorization: "Bearer " + "00".repeat(32) },
      )
    ).status,
    403,
  );
  const boot = await api({ action: "bootstrap" });
  assert.equal(boot.status, 200);
  assert.equal(boot.body.manifest.realm, r.lab.manifest.realm);
  assert.equal((await api({ action: "bootstrap", password })).status, 400);
  assert.equal((await api({ action: "state" })).status, 400);
  assert.equal((await fetch(r.origin + "/client/")).status, 200);
  const f = { issuer: r.lab.issuer },
    a = await client(f, boot.body.clients.alice),
    { digest } = await a.c.prepareIssue(
      (await api({ action: "session", kind: "issue" })).body.session,
      asset,
    );
  await ready(a, digest);
  const req = a.c.submission(digest),
    result = await api(req);
  assert.equal(result.status, 200);
  await a.c.accept(digest, result.body.response);
  for (const c of r.lab.clients.values()) {
    assert.equal(
      c.db.prepare("SELECT COUNT(*) AS n FROM credentials").get().n,
      0,
    );
    assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM pending").get().n, 0);
  }
});

// Real Worker orchestration and HTTP; persistence is a serialized in-memory
// adapter here. Actual IndexedDB transactions are separately exercised in-browser.
async function worker(t, r) {
  const { Worker } = await import("node:worker_threads");
  const workerDir = mkdtempSync(join(tmpdir(), "zft-client-worker-"));
  t.after(() => rmSync(workerDir, { recursive: true, force: true }));
  for (const [url, source] of browserModules()) {
    const path = join(workerDir, url);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      url === "/web/client-worker.mjs"
        ? source.replace('"./client-storage.mjs"', '"./test-storage.mjs"')
        : source,
    );
  }
  writeFileSync(
    join(workerDir, "web/test-storage.mjs"),
    `let row=null;export const openStore=async()=>({close(){}});export const readSlot=async()=>row;export async function writeSlot(db,m,id,wire,expected){if((row?.revision??0)!==expected)throw Error('stale');row={wire,revision:expected+1};return row.revision;}`,
  );
  const adapter = join(workerDir, "adapter.mjs");
  writeFileSync(
    adapter,
    `import {parentPort} from 'node:worker_threads';const fetchOriginal=fetch;globalThis.fetch=(url,options)=>fetchOriginal(new URL(url,${JSON.stringify(r.origin)}),{...options,headers:{...options.headers,Origin:${JSON.stringify(r.origin)}}});globalThis.self={postMessage:value=>parentPort.postMessage(value)};await import('./web/client-worker.mjs');parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({id:0,ok:true});`,
  );
  const w = new Worker(pathToFileURL(adapter)),
    seen = [],
    waiters = new Map();
  let id = 0;
  w.on("message", (v) => {
    seen.push(v);
    waiters.get(v.id)?.(v);
    waiters.delete(v.id);
  });
  t.after(() => w.terminate());
  const wait = (n) =>
    new Promise((resolve) => {
      const v = seen.find((x) => x.id === n);
      if (v) resolve(v);
      else waiters.set(n, resolve);
    });
  await wait(0);
  return {
    seen,
    send(action, data = {}) {
      const n = ++id;
      w.postMessage({ id: n, action, ...data });
      return wait(n);
    },
  };
}
test("browser client worker keeps authority local through HTTP mint and reopen", async (t) => {
  const r = await startBrowserLab();
  t.after(() => r.close());
  const { seen, send } = await worker(t, r),
    id = p.randomHex(16),
    manifest = r.lab.manifest;
  const setup = { token: r.token, manifest, clientId: id, password };
  assert((await send("create", setup)).ok);
  const minted = await send("mint", { asset: p.hex(asset) });
  assert(minted.ok);
  const d = minted.result.digest;
  assert.equal((await send("submit", { digest: d })).ok, false);
  const backup = await send("backup", { digest: d, password });
  assert(backup.ok);
  assert(
    (
      await send("acknowledge", {
        digest: d,
        wire: backup.result.wire,
        password,
      })
    ).ok,
  );
  const lost = await send("submit", { digest: d, loseResponse: true });
  assert(lost.ok && lost.result.lost);
  await send("lock");
  assert((await send("open", setup)).ok);
  const recovered = await send("recover", { digest: d });
  assert(recovered.ok);
  assert.equal(recovered.result.state.credentials.length, 1);
  const output = JSON.stringify(seen);
  const vault = LocalVault.open(
    backup.result.wire,
    password,
    manifest,
    backup.result.id,
  );
  const pending = p.parse(vault.read(vault.list()[0].id).wire, 300000);
  for (const secret of [password, pending.secret, pending.capability])
    assert(!output.includes(secret));
  for (const c of r.lab.clients.values())
    assert.equal(
      c.db.prepare("SELECT COUNT(*) AS n FROM credentials").get().n,
      0,
    );
});
test("browser client worker lock invalidates asynchronous creation", async (t) => {
  const r = await startBrowserLab();
  t.after(() => r.close());
  const { send } = await worker(t, r);
  const opening = send("create", {
    token: r.token,
    manifest: r.lab.manifest,
    clientId: p.randomHex(16),
    password,
  });
  assert((await send("lock")).ok);
  assert.equal((await opening).ok, false);
  assert.equal((await send("mint", { asset: p.hex(asset) })).ok, false);
});

test("browser client authenticated journal cannot replace inner trust or identity", async (t) => {
  const { scryptSync, createCipheriv } = await import("node:crypto");
  const f = fixture(t),
    a = await client(f),
    original = await decoded(f, a);
  for (const patch of [
    { client_id: "ff".repeat(16) },
    { manifest: { ...original.manifest, realm: "aa".repeat(32) } },
  ]) {
    const { ciphertext, tag, ...h } = p.parse(a.store.wire, MAX_FILE),
      key = scryptSync(password, Buffer.from(h.salt, "hex"), 32, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 67108864,
      }),
      enc = createCipheriv("aes-256-gcm", key, Buffer.from(h.iv, "hex"));
    enc.setAAD(Buffer.from(p.canonical(h)));
    const data = Buffer.concat([
      enc.update(p.canonical({ ...original, ...patch })),
      enc.final(),
    ]);
    const wire = p.canonical({
      ...h,
      ciphertext: data.toString("hex"),
      tag: enc.getAuthTag().toString("hex"),
    });
    await assert.rejects(() =>
      BrowserClient.open(
        wire,
        password,
        original.manifest,
        a.id,
        a.store.revision,
        a.store.persist,
      ),
    );
  }
});
