import assert from "node:assert/strict";
import { test, after } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { browserModules } from "../web/modules.mjs";
import { StrictTestDecoder } from "./web-image-test-support.mjs";
import { fixture } from "./test-support.mjs";
import * as p from "./profile.mjs";
import * as local from "./image.mjs";
import * as png from "./png.mjs";
const dir = mkdtempSync(join(tmpdir(), "zft-artwork-esm-"));
for (const [url, source] of browserModules()) {
  const path = join(dir, url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}
after(() => rmSync(dir, { recursive: true, force: true }));
const load = (name) => import(pathToFileURL(join(dir, "web", name)));
const portable = await load("png.mjs");
const web = await load("image.mjs");
const { BrowserClient } = await load("client.mjs");
globalThis.DecompressionStream = StrictTestDecoder;
const fixtures = JSON.parse(
  readFileSync(new URL("./image-fixtures.json", import.meta.url), "utf8"),
).images;
const image = (n = 0) => new Uint8Array(Buffer.from(fixtures[n].pngHex, "hex"));
const wrap = (type, data) => ({ type, data, raw: png.chunk(type, data) });
const same = (a, b) => assert.deepEqual(Buffer.from(a), Buffer.from(b));
function mint(f) {
  const d = local.prepareImageIssue(f.a, f.issuer.session("issue"), image());
  f.acknowledge(f.a, d);
  const id = f.a.submit(d, f.issuer);
  return {
    id,
    envelope: f.a.export(id),
    file: local.exportImage(f.a.export(id), f.a.pinned.manifest),
  };
}
function attach(source, payload, type = png.BEARER_CHUNK) {
  const c = png.pngChunks(source);
  return png.assemble([...c.slice(0, -1), wrap(type, payload), c.at(-1)]);
}
function payload(file) {
  return png.pngChunks(file).find((c) => c.type === png.BEARER_CHUNK).data;
}
function changed(file, change, source = image()) {
  const body = p.parse(payload(file).toString("utf8"));
  change(body);
  return attach(source, p.utf8(p.canonical(body)));
}
function compressed(data, width = 1, height = 1) {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(width, 0);
  h.writeUInt32BE(height, 4);
  h[8] = 8;
  h[9] = 6;
  return png.assemble([
    wrap("IHDR", h),
    wrap("IDAT", data),
    wrap("IEND", Buffer.alloc(0)),
  ]);
}
const password = "public artwork test password";
async function client(f) {
  const store = { wire: null, revision: 0 };
  const id = p.randomHex(16);
  store.persist = async (wire, expected) => {
    assert.equal(expected, store.revision);
    store.wire = wire;
    return ++store.revision;
  };
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
async function submit(f, a, d) {
  assert.throws(() => a.c.submission(d), /recovery file required/);
  const backup = await a.c.backup(d, password);
  await a.c.acknowledge(d, backup.wire, password);
  const req = a.c.submission(d);
  return a.c.accept(d, f.issuer.submit(req.wire, req.capability));
}
for (const [i, v] of fixtures.entries())
  test(`browser PNG fixture ${i} matches unchanged codec and owns its input`, async () => {
    const original = image(i),
      padded = new Uint8Array(original.length + 12);
    padded.set(original, 7);
    const pending = portable.inspectImage(
      padded.subarray(7, 7 + original.length),
    );
    padded.fill(0);
    const got = await pending;
    same(got.image, original);
    assert.equal(p.hash(got.image), v.sha256);
    assert.equal(got.width, v.width);
    assert.equal(got.height, v.height);
    same(png.inspectImage(original).image, got.image);
    got.image.fill(0);
    same(image(i), original);
  });
test("browser PNG decoder refuses permissive runtime before accepting images", async () => {
  const path = join(dir, "web", "probe.mjs");
  writeFileSync(path, browserModules().get("/web/png.mjs"));
  const { requireStrictDecoder } = await import(pathToFileURL(path));
  class Permissive extends TransformStream {
    constructor() {
      super({
        transform(_v, c) {
          c.enqueue(new TextEncoder().encode("hello"));
        },
      });
    }
  }
  globalThis.DecompressionStream = Permissive;
  try {
    await assert.rejects(() => requireStrictDecoder(), /decoder must reject/);
  } finally {
    globalThis.DecompressionStream = StrictTestDecoder;
  }
});
test("browser PNG rejects CRC corruption before inflation", async () => {
  const value = image();
  value[29] ^= 1;
  await assert.rejects(() => portable.inspectImage(value), /CRC/);
});
test("browser PNG rejects incomplete trailing concatenated and excessive deflate output", async () => {
  const valid = deflateSync(Buffer.alloc(5));
  const invalid = [
    Buffer.concat([valid, Buffer.from([0])]),
    Buffer.concat([valid, valid]),
    valid.subarray(0, -1),
    deflateSync(Buffer.alloc(6)),
    deflateSync(Buffer.alloc(4)),
    deflateSync(Buffer.alloc(2 * 1024 * 1024)),
    Buffer.from(valid),
  ];
  invalid.at(-1)[valid.length - 1] ^= 1;
  for (const bytes of invalid)
    await assert.rejects(() => portable.inspectImage(compressed(bytes)));
  await assert.rejects(
    () =>
      portable.inspectImage(
        compressed(deflateSync(Buffer.from([5, 0, 0, 0, 0]))),
      ),
    /row filter/,
  );
  same(
    (await portable.inspectImage(compressed(valid))).image,
    compressed(valid),
  );
});
test("browser PNG enforces file pixels shape and reserved chunk boundaries", async () => {
  await assert.rejects(
    () => portable.inspectImage(new Uint8Array(png.IMAGE_LIMIT + 1)),
    /image size/,
  );
  await assert.rejects(
    () => portable.inspectImage(compressed(deflateSync(Buffer.alloc(5)), 0, 1)),
    /pixel limit/,
  );
  await assert.rejects(
    () =>
      portable.inspectImage(
        compressed(deflateSync(Buffer.alloc(5)), png.PIXEL_LIMIT + 1, 1),
      ),
    /pixel limit/,
  );
  const c = png.pngChunks(image());
  const many = (n) =>
    png.assemble([
      c[0],
      ...Array.from({ length: n - 3 }, () => wrap("IDAT", Buffer.alloc(0))),
      ...c.slice(1),
    ]);
  assert.equal(png.pngChunks(many(127)).length, 127);
  await portable.inspectImage(many(127));
  await assert.rejects(
    () => portable.inspectImage(many(128)),
    /image chunk count/,
  );
  const h = Buffer.from(c[0].data);
  h[9] = 2;
  await assert.rejects(
    () => portable.inspectImage(png.assemble([wrap("IHDR", h), ...c.slice(1)])),
    /RGBA8/,
  );
  await assert.rejects(
    () => portable.inspectImage(attach(image(), Buffer.alloc(0), "tEXt")),
    /public chunks/,
  );
});
test("browser PNG envelope matches Node bytes and validates canonical payload and pinned trust", async (t) => {
  const f = fixture(t),
    m = mint(f),
    manifest = f.a.pinned.manifest;
  same(await web.exportImage(m.envelope, manifest), m.file);
  const got = await web.importImage(m.file, manifest);
  assert.equal(got.envelope, m.envelope);
  same(got.image, image());
  const bad = [
    attach(image(), Buffer.from([255])),
    attach(image(), Buffer.concat([payload(m.file), Buffer.from(" ")])),
    attach(m.file, payload(m.file)),
    attach(image(), payload(m.file), "zfTx"),
    changed(m.file, (v) => (v.extra = true)),
  ];
  for (const value of bad)
    await assert.rejects(() => web.importImage(value, manifest));
  await assert.rejects(() =>
    web.importImage(m.file, { ...manifest, realm: p.randomHex(16) }),
  );
  same(await web.publicImage(m.file, manifest), image());
});
test("browser PNG checks full digest and signed asset after image substitution", async (t) => {
  const f = fixture(t),
    m = mint(f),
    manifest = f.a.pinned.manifest;
  await assert.rejects(
    () =>
      web.importImage(
        changed(m.file, (v) => {
          v.image_sha256 = "00".repeat(32);
        }),
        manifest,
      ),
    /digest/,
  );
  await assert.rejects(
    () =>
      web.importImage(
        changed(
          m.file,
          (v) => {
            v.image_sha256 = p.hash(image(1));
          },
          image(1),
        ),
        manifest,
      ),
    /asset|binding/,
  );
});
test("browser artwork preview is exact public bytes and private export is explicit", async (t) => {
  const f = fixture(t),
    a = await client(f);
  const d = (await a.c.prepareImageIssue(f.issuer.session("issue"), image()))
    .digest;
  const { id } = await submit(f, a, d);
  const view = await a.c.artwork(id);
  same(view.bytes, image());
  assert.equal(view.digest, p.hash(image()));
  assert.equal(
    png.pngChunks(view.bytes).some((c) => c.type === png.BEARER_CHUNK),
    false,
  );
  const privateFile = await a.c.artwork(id, true);
  const got = local.importImage(privateFile.bytes, f.issuer.pinned.manifest);
  same(got.image, view.bytes);
  assert.equal(
    png.pngChunks(privateFile.bytes).filter((c) => c.type === png.BEARER_CHUNK)
      .length,
    1,
  );
});
test("browser malformed artwork never writes pending state", async (t) => {
  const f = fixture(t),
    a = await client(f),
    before = a.store.wire,
    revision = a.store.revision;
  const corrupt = image();
  corrupt[29] ^= 1;
  for (const value of [new Uint8Array([1, 2, 3]), corrupt])
    await assert.rejects(() =>
      a.c.prepareImageIssue(f.issuer.session("issue"), value),
    );
  const m = mint(f);
  const bad = changed(m.file, (v) => {
    v.image_sha256 = "00".repeat(32);
  });
  await assert.rejects(() =>
    a.c.prepareImageClaim(f.issuer.session("swap"), bad),
  );
  assert.equal(a.store.wire, before);
  assert.equal(a.store.revision, revision);
  assert.equal(a.c.summary().operations.length, 0);
});
test("browser artwork lock during decode cannot prepare a journal", async (t) => {
  const f = fixture(t),
    a = await client(f),
    before = a.store.wire;
  const pending = a.c.prepareImageIssue(f.issuer.session("issue"), image());
  a.c.lock();
  await assert.rejects(() => pending, /locked/);
  assert.equal(a.store.wire, before);
});
test("browser PNG claim cancel reopen and stale issuer rejection retain recovery gates", async (t) => {
  const f = fixture(t),
    a = await client(f),
    b = await client(f);
  const issue = (
    await a.c.prepareImageIssue(f.issuer.session("issue"), image())
  ).digest;
  const source = await submit(f, a, issue),
    file = (await a.c.artwork(source.id, true)).bytes;
  const claim = (await b.c.prepareImageClaim(f.issuer.session("swap"), file))
    .digest;
  const owned = await submit(f, b, claim);
  same((await b.c.artwork(owned.id)).bytes, image());
  b.c.lock();
  b.c = await BrowserClient.open(
    b.store.wire,
    password,
    f.issuer.pinned.manifest,
    b.id,
    b.store.revision,
    b.store.persist,
  );
  const cancel = (await b.c.prepareCancel(f.issuer.session("swap"), owned.id))
    .digest;
  await submit(f, b, cancel);
  await assert.rejects(() => b.c.artwork(owned.id, true), /spent/);
  // The earlier holder retains a stale valid file; offline import cannot decide spentness.
  await web.importImage(file, f.issuer.pinned.manifest);
  const stale = (await a.c.prepareImageClaim(f.issuer.session("swap"), file))
    .digest;
  const back = await a.c.backup(stale, password);
  await a.c.acknowledge(stale, back.wire, password);
  const request = a.c.submission(stale);
  assert.throws(
    () => f.issuer.submit(request.wire, request.capability),
    /already spent/,
  );
  assert.equal(f.issuer.counts().operations, 3);
});
