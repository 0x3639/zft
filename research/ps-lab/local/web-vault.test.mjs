import assert from "node:assert/strict";
import { test, after } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { scryptSync, createCipheriv } from "node:crypto";
import { browserModules } from "../web/modules.mjs";
import { fixture, secrets, realm } from "./test-support.mjs";
import * as p from "./profile.mjs";
import { LocalVault, recordId, MAX_FILE } from "./vault.mjs";
const directory = mkdtempSync(join(tmpdir(), "zft-browser-esm-"));
const modules = browserModules();
for (const [url, source] of modules) {
  const path = join(directory, url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}
after(() => rmSync(directory, { recursive: true, force: true }));
const moduleUrl = (name) => pathToFileURL(join(directory, "web", name));
const { BrowserVault, derive } = await import(moduleUrl("vault.mjs"));
const portable = await import(moduleUrl("profile.mjs"));
const password = "public test browser password ü";
const manifest = p.manifest(realm, secrets);
function prepared(t) {
  const f = fixture(t),
    d = f.a.prepareIssue(f.issuer.session("issue"), p.utf8("browser record"));
  const snapshot = f.a.backup(d);
  f.a.acknowledge(d, p.hash(snapshot));
  const id = f.a.submit(d, f.issuer),
    bearer = f.a.export(id);
  const v = new LocalVault(manifest);
  v.add("recovery", snapshot);
  v.add("bearer", bearer);
  return { ...f, v, snapshot, bearer, wire: v.seal(password) };
}
function tamper(wire, fn) {
  const v = JSON.parse(wire);
  fn(v);
  return p.canonical(v);
}
function authenticated(wire, clear) {
  const { ciphertext, tag, ...h } = JSON.parse(wire),
    key = scryptSync(password, Buffer.from(h.salt, "hex"), 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 67108864,
    }),
    c = createCipheriv("aes-256-gcm", key, Buffer.from(h.iv, "hex"));
  c.setAAD(Buffer.from(p.canonical(h)));
  const enc = Buffer.concat([c.update(clear), c.final()]);
  return p.canonical({
    ...h,
    ciphertext: enc.toString("hex"),
    tag: c.getAuthTag().toString("hex"),
  });
}

test("web vault module closure is deterministic and has no Node imports", () => {
  assert.deepEqual([...modules], [...browserModules()]);
  assert(modules.has("/vendor/@noble/hashes/scrypt.js"));
  for (const [url, source] of modules) {
    assert(!/["']node:/.test(source), url);
    for (const m of source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
      const target = new URL(m[1], pathToFileURL(join(directory, url)));
      assert.equal(target.protocol, "file:");
      assert(readFileSync(target));
    }
  }
});
test("web vault browser adapters preserve canonical encodings and curve checks", () => {
  const a = portable.trust(manifest),
    b = p.trust(manifest);
  assert.equal(a.pk.id, b.pk.id);
  for (const data of [
    new Uint8Array(),
    p.utf8("ü #\0"),
    new Uint8Array([0, 255, 17]),
  ]) {
    assert.equal(portable.hash(data), p.hash(data));
    assert.equal(portable.hex(data), p.hex(data));
    assert.equal(
      portable.assetValue(data.length ? data : new Uint8Array([1]), a),
      p.assetValue(data.length ? data : new Uint8Array([1]), b),
    );
  }
  for (const wire of ["{} ", '{"x":1,"x":2}', '{"x":-0}', '{"x":1.0}'])
    assert.throws(() => portable.parse(wire));
  assert.throws(() => portable.point("00".repeat(48)));
});
test("web vault scrypt agrees with Node at the fixed profile cost", async () => {
  const salt = new Uint8Array(16).fill(7);
  const actual = await derive(password, salt),
    expected = scryptSync(Buffer.from(password), salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 67108864,
    });
  assert.equal(Buffer.from(actual).toString("hex"), expected.toString("hex"));
  actual.fill(0);
});
test("web vault opens Node records and Node opens browser ciphertext", async (t) => {
  const f = prepared(t),
    web = await BrowserVault.open(f.wire, password, manifest, f.v.id);
  assert.deepEqual(
    web.list(),
    LocalVault.open(f.wire, password, manifest, f.v.id).list(),
  );
  assert.equal(web.read(recordId("recovery", f.snapshot)).wire, f.snapshot);
  const wire = await web.seal(password),
    node = LocalVault.open(wire, password, manifest, f.v.id);
  assert.deepEqual(
    node.list().sort((a, b) => a.id.localeCompare(b.id)),
    web.list().sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.equal(node.read(recordId("bearer", f.bearer)).wire, f.bearer);
  const a = JSON.parse(f.wire),
    b = JSON.parse(wire);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  node.lock();
  web.lock();
});
test("web vault new browser vault records are readable by Node", async (t) => {
  const f = prepared(t),
    web = new BrowserVault(manifest);
  web.add("bearer", f.bearer);
  web.add("recovery", f.snapshot);
  const node = LocalVault.open(
    await web.seal(password),
    password,
    manifest,
    web.id,
  );
  assert.deepEqual(
    node.list().sort((a, b) => a.id.localeCompare(b.id)),
    web.list().sort((a, b) => a.id.localeCompare(b.id)),
  );
  node.lock();
});
test("web vault wrong passwords never expose records", async (t) => {
  const f = prepared(t);
  await assert.rejects(() =>
    BrowserVault.open(
      f.wire,
      "another public wrong password",
      manifest,
      f.v.id,
    ),
  );
});
test("web vault pins complete manifest and vault identity", async (t) => {
  const f = prepared(t);
  await assert.rejects(() =>
    BrowserVault.open(
      f.wire,
      password,
      { ...manifest, realm: "99".repeat(32) },
      f.v.id,
    ),
  );
  await assert.rejects(() =>
    BrowserVault.open(f.wire, password, manifest, "88".repeat(16)),
  );
});
for (const field of ["ciphertext", "tag", "iv", "salt"])
  test("web vault rejects modified " + field, async (t) => {
    const f = prepared(t),
      wire = tamper(f.wire, (v) => {
        v[field] = (v[field][0] === "0" ? "1" : "0") + v[field].slice(1);
      });
    await assert.rejects(() =>
      BrowserVault.open(wire, password, manifest, f.v.id),
    );
  });
test("web vault AAD binds an otherwise consistent outer identity", async (t) => {
  const f = prepared(t),
    id = "aa".repeat(16),
    wire = tamper(f.wire, (v) => {
      v.vault_id = id;
    });
  await assert.rejects(() => BrowserVault.open(wire, password, manifest, id));
});
test("web vault rejects authenticated invalid records after decrypt", async (t) => {
  const f = prepared(t),
    bad = p.canonical({
      format: "zft-ps-local-vault-content-v1",
      vault_id: f.v.id,
      manifest,
      records: {
        [recordId("recovery", f.snapshot)]: {
          kind: "recovery",
          wire: p.canonical({
            ...JSON.parse(f.snapshot),
            secret: "01".repeat(32),
          }),
        },
      },
    });
  await assert.rejects(() =>
    BrowserVault.open(
      authenticated(f.wire, Buffer.from(bad)),
      password,
      manifest,
      f.v.id,
    ),
  );
});
test("web vault rejects malformed authenticated UTF-8 and canonical content", async (t) => {
  const f = prepared(t);
  for (const clear of [
    Buffer.from([0xff]),
    Buffer.from("{} "),
    Buffer.from('{"x":1,"x":2}'),
  ])
    await assert.rejects(() =>
      BrowserVault.open(
        authenticated(f.wire, clear),
        password,
        manifest,
        f.v.id,
      ),
    );
});
test("web vault malformed headers reject before KDF", async (t) => {
  const f = prepared(t);
  for (const wire of [
    f.wire + " ",
    f.wire.replace('"format":', '"format":"bad","format":'),
    tamper(f.wire, (v) => (v.kdf = "scrypt-n1")),
    tamper(f.wire, (v) => (v.tag = "00")),
    "x".repeat(MAX_FILE + 1),
  ])
    await assert.rejects(() =>
      BrowserVault.open(wire, password, manifest, f.v.id),
    );
});
test("web vault password byte and Unicode policy matches Node", async () => {
  for (const password of ["short", "\ud800", "a".repeat(1025)])
    await assert.rejects(() => derive(password, new Uint8Array(16)));
  const web = new BrowserVault(manifest),
    wire = await web.seal("é".repeat(6));
  assert.equal(
    LocalVault.open(wire, "é".repeat(6), manifest, web.id).list().length,
    0,
  );
});
test("web vault explicit lock prevents access and an in-flight seal", async (t) => {
  const f = prepared(t),
    web = await BrowserVault.open(f.wire, password, manifest, f.v.id);
  const attempt = web.seal(password);
  web.lock();
  await assert.rejects(attempt);
  for (const call of [
    () => web.list(),
    () => web.read(recordId("bearer", f.bearer)),
    () => web.add("bearer", f.bearer),
  ])
    assert.throws(call);
  await assert.rejects(() => web.seal(password));
});
test("web vault old exports stay readable after a new password", async (t) => {
  const f = prepared(t),
    web = await BrowserVault.open(f.wire, password, manifest, f.v.id),
    newPassword = "new public browser password";
  const next = await web.seal(newPassword);
  assert.equal(
    (await BrowserVault.open(f.wire, password, manifest, f.v.id)).list().length,
    2,
  );
  await assert.rejects(() =>
    BrowserVault.open(next, password, manifest, f.v.id),
  );
  assert.equal(
    LocalVault.open(next, newPassword, manifest, f.v.id).list().length,
    2,
  );
});
function worker(t) {
  const path = join(directory, "adapter-" + Math.random() + ".mjs");
  writeFileSync(
    path,
    `import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:v=>parentPort.postMessage(v)};await import(${JSON.stringify(moduleUrl("worker.mjs").href)});parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});`,
  );
  const w = new Worker(pathToFileURL(path));
  t.after(() => w.terminate());
  const seen = [],
    waiters = new Map();
  w.on("message", (v) => {
    seen.push(v);
    waiters.get(v.id ?? "ready")?.(v);
    waiters.delete(v.id ?? "ready");
  });
  const wait = (id) =>
    new Promise((resolve) => {
      const old = seen.find((v) => (v.id ?? "ready") === id);
      if (old) resolve(old);
      else waiters.set(id, resolve);
    });
  return { w, seen, wait };
}
test("web vault worker lock invalidates an asynchronous open", async (t) => {
  const f = prepared(t),
    { w, wait } = worker(t);
  await wait("ready");
  w.postMessage({
    id: 1,
    action: "open",
    wire: f.wire,
    password,
    manifest,
    vaultId: f.v.id,
  });
  w.postMessage({ id: 2, action: "lock" });
  assert.equal((await wait(2)).ok, true);
  assert.equal((await wait(1)).ok, false);
  w.postMessage({ id: 3, action: "seal", password });
  assert.equal((await wait(3)).ok, false);
});
test("web vault worker emits identifiers and ciphertext but no decrypted wires", async (t) => {
  const f = prepared(t),
    { w, seen, wait } = worker(t);
  await wait("ready");
  w.postMessage({
    id: 1,
    action: "open",
    wire: f.wire,
    password,
    manifest,
    vaultId: f.v.id,
  });
  assert.equal((await wait(1)).ok, true);
  w.postMessage({ id: 2, action: "seal", password });
  const sealed = await wait(2);
  assert.equal(sealed.ok, true);
  assert.equal(
    LocalVault.open(sealed.result.wire, password, manifest, f.v.id).list()
      .length,
    2,
  );
  const output = JSON.stringify(seen);
  assert(!output.includes(password));
  assert(!output.includes(JSON.parse(f.snapshot).secret));
  assert(!output.includes(f.bearer));
});
