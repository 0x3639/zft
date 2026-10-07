import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import * as p from "./profile.mjs";
import { fixture, pending } from "./test-support.mjs";
import {
  FILE_PROTOCOL,
  exportImage,
  importImage,
  publicImage,
  prepareImageIssue,
  prepareImageClaim,
} from "./image.mjs";
import {
  pngChunks,
  assemble,
  chunk,
  inspectImage,
  BEARER_CHUNK,
  IMAGE_LIMIT,
  PAYLOAD_LIMIT,
  FILE_LIMIT,
  PIXEL_LIMIT,
  CHUNK_LIMIT,
} from "./png.mjs";
const fixtures = JSON.parse(
  readFileSync(new URL("./image-fixtures.json", import.meta.url), "utf8"),
).images;
const image = (n = 0) => Buffer.from(fixtures[n].pngHex, "hex");
const wrap = (type, data) => ({ type, data, raw: chunk(type, data) });
function attach(png, payload, type = BEARER_CHUNK) {
  const c = pngChunks(png);
  return assemble([...c.slice(0, -1), wrap(type, payload), c.at(-1)]);
}
function payload(file) {
  return pngChunks(file).find((c) => c.type === BEARER_CHUNK).data;
}
function body(file) {
  return p.parse(payload(file).toString("utf8"), PAYLOAD_LIMIT);
}
function replace(file, change) {
  const v = body(file);
  change(v);
  return attach(image(), p.utf8(p.canonical(v)));
}
function mint(f, n = 0) {
  const d = prepareImageIssue(f.a, f.issuer.session("issue"), image(n));
  f.acknowledge(f.a, d);
  const id = f.a.submit(d, f.issuer);
  return { id, file: exportImage(f.a.export(id), f.a.pinned.manifest) };
}
function rows(f) {
  return [f.issuer, f.a, f.b].map((c) =>
    Object.fromEntries(
      c.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all()
        .map(({ name }) => [
          name,
          c.db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all(),
        ]),
    ),
  );
}
function rawPng(width, height, raw, headerPatch = {}) {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(width, 0);
  h.writeUInt32BE(height, 4);
  h[8] = 8;
  h[9] = 6;
  for (const [i, v] of Object.entries(headerPatch)) h[Number(i)] = v;
  return assemble([
    wrap("IHDR", h),
    wrap("IDAT", deflateSync(raw)),
    wrap("IEND", Buffer.alloc(0)),
  ]);
}
for (const [i, v] of fixtures.entries())
  test(`PNG fixture ${i} preserves exact bytes and full digest`, () => {
    const source = image(i),
      copy = Buffer.from(source),
      found = inspectImage(source);
    assert.equal(p.hash(found.image), v.sha256);
    assert.equal(found.width, v.width);
    assert.equal(found.height, v.height);
    assert.deepEqual(found.image, source);
    found.image.fill(0);
    assert.deepEqual(source, copy);
  });
test("PS PNG roundtrip preserves bearer authority and leaves original input untouched", (t) => {
  const f = fixture(t),
    { id, file } = mint(f),
    copy = Buffer.from(file),
    manifest = f.a.pinned.manifest;
  const padded = Buffer.concat([Buffer.alloc(5), file, Buffer.alloc(3)]);
  const got = importImage(padded.subarray(5, -3), manifest);
  assert.equal(got.envelope, f.a.export(id));
  assert.deepEqual(got.image, image());
  assert.equal(got.image_sha256, fixtures[0].sha256);
  assert.equal(body(file).file_protocol, FILE_PROTOCOL);
  assert.equal(
    body(file).credential.s,
    p.importBearer(got.envelope, f.a.pinned).credential.s,
  );
  got.image.fill(0);
  assert.deepEqual(file, copy);
});
test("public PNG export removes all envelope authority", (t) => {
  const f = fixture(t),
    { file } = mint(f),
    copy = Buffer.from(file);
  const clean = publicImage(file, f.a.pinned.manifest);
  assert.deepEqual(
    pngChunks(clean).map((c) => c.type),
    ["IHDR", "IDAT", "IEND"],
  );
  assert.deepEqual(clean, image());
  assert.deepEqual(file, copy);
  assert.throws(() => importImage(clean, f.a.pinned.manifest), /exactly one/);
});
test("image claim survives lost response and recovery then cancellation invalidates old copies", (t) => {
  const f = fixture(t),
    { file } = mint(f),
    manifest = f.a.pinned.manifest;
  const d = prepareImageClaim(f.b, f.issuer.session("swap"), file);
  assert.throws(() => f.b.submit(d, f.issuer), /recovery snapshot/);
  const backup = f.b.backup(d);
  f.acknowledge(f.b, d);
  const v = pending(f.b, d);
  const response = f.issuer.submit(v.wire, v.capability); // Deliberately lose client receipt.
  const restored = f.client("restored");
  assert.equal(restored.restore(backup), d);
  const id = restored.recover(d, f.issuer);
  assert.equal(restored.pending(d).response, response);
  const claimed = exportImage(restored.export(id), manifest);
  assert.deepEqual(publicImage(claimed, manifest), image());
  assert.notEqual(body(claimed).credential.s, body(file).credential.s);
  const cancel = restored.prepareCancel(f.issuer.session("swap"), id);
  f.acknowledge(restored, cancel);
  const finalId = restored.submit(cancel, f.issuer);
  assert.deepEqual(
    publicImage(exportImage(restored.export(finalId), manifest), manifest),
    image(),
  );
  for (const stale of [file, claimed]) {
    importImage(stale, manifest); // Offline validity is deliberately not a spent-status claim.
    const loser = prepareImageClaim(f.b, f.issuer.session("swap"), stale);
    f.acknowledge(f.b, loser);
    assert.throws(() => f.b.submit(loser, f.issuer), /already spent/);
  }
  assert.equal(f.issuer.counts().operations, 3);
});
test("two prepared claims from copied images yield exactly one replacement", (t) => {
  const f = fixture(t),
    { file } = mint(f);
  const a = prepareImageClaim(f.a, f.issuer.session("swap"), file),
    b = prepareImageClaim(f.b, f.issuer.session("swap"), file);
  f.acknowledge(f.a, a);
  f.acknowledge(f.b, b);
  f.a.submit(a, f.issuer);
  assert.throws(() => f.b.submit(b, f.issuer), /already spent/);
  assert.equal(f.issuer.counts().operations, 2);
});
test("PS PNG image substitution rejects even with a recomputed full digest", (t) => {
  const f = fixture(t),
    { file } = mint(f),
    v = body(file);
  v.image_sha256 = p.hash(image(1));
  const changed = attach(image(1), p.utf8(p.canonical(v)));
  assert.throws(
    () => importImage(changed, f.a.pinned.manifest),
    /asset binding/,
  );
});
test("PS PNG rejects altered full image digest", (t) => {
  const f = fixture(t),
    { file } = mint(f);
  assert.throws(
    () =>
      importImage(
        replace(file, (v) => (v.image_sha256 = "00".repeat(32))),
        f.a.pinned.manifest,
      ),
    /image digest/,
  );
});
test("invalid PS PNG authority and scope never create pending claims", (t) => {
  const f = fixture(t),
    { file } = mint(f),
    session = f.issuer.session("swap"),
    before = rows(f);
  const changes = [
    (v) => (v.file_protocol = "zft-ps-png-lab-v2"),
    (v) => (v.protocol = "zft"),
    (v) => (v.type = "pending"),
    (v) => (v.realm = "72".repeat(32)),
    (v) => (v.keyset_id = "00".repeat(33)),
    (v) => (v.public_key = "00".repeat(336)),
    (v) => (v.credential.s = "00".repeat(32)),
    (v) =>
      (v.credential.s = p.scalarHex(
        (BigInt("0x" + v.credential.s) % (p.Q - 1n)) + 1n,
      )),
    (v) => (v.credential.v = "c0" + "00".repeat(47)),
    (v) => (v.url = "https://example.invalid/rpc"),
    (v) => (v.credential.extra = true),
  ];
  for (const change of changes) {
    assert.throws(() => prepareImageClaim(f.b, session, replace(file, change)));
    assert.deepEqual(rows(f), before);
  }
  assert.throws(() =>
    importImage(
      file,
      p.manifest("72".repeat(32), {
        x: p.scalarHex(2n),
        yh: p.scalarHex(3n),
        ys: p.scalarHex(4n),
      }),
    ),
  );
});
test("PS PNG rejects noncanonical JSON and malformed UTF-8 payloads", (t) => {
  const f = fixture(t),
    { file } = mint(f),
    text = payload(file).toString("utf8");
  const bad = [
    Buffer.from(" " + text),
    Buffer.from(text + "\n"),
    Buffer.from('{"type":"bearer",' + text.slice(1)),
    Buffer.concat([Buffer.from([239, 187, 191]), payload(file)]),
    Buffer.concat([payload(file), Buffer.from([192, 175])]),
    Buffer.from("[]"),
    Buffer.from("null"),
  ];
  for (const value of bad)
    assert.throws(() =>
      importImage(attach(image(), value), f.a.pinned.manifest),
    );
});
test("PS PNG rejects duplicate envelopes", (t) => {
  const f = fixture(t),
    { file } = mint(f);
  assert.throws(
    () => importImage(attach(file, payload(file)), f.a.pinned.manifest),
    /exactly one/,
  );
});
for (const type of ["zfTA", "tEXt", "iTXt", "acTL", "zqZZ"])
  test(`PS PNG rejects mixed or unknown ${type} chunks`, (t) => {
    const f = fixture(t),
      { file } = mint(f),
      c = pngChunks(file);
    const mixed = assemble([
      ...c.slice(0, -2),
      wrap(type, Buffer.from("private test metadata")),
      ...c.slice(-2),
    ]);
    assert.throws(
      () => importImage(mixed, f.a.pinned.manifest),
      /public chunks/,
    );
    assert.throws(
      () => publicImage(mixed, f.a.pinned.manifest),
      /public chunks/,
    );
  });
test("PS PNG rejects legacy-only images and misplaced envelopes", (t) => {
  const f = fixture(t),
    { file } = mint(f),
    c = pngChunks(file);
  assert.throws(
    () =>
      importImage(
        attach(image(), Buffer.from("{}"), "zfTA"),
        f.a.pinned.manifest,
      ),
    /exactly one/,
  );
  assert.throws(
    () =>
      importImage(
        assemble([c[0], c.at(-2), c[1], c.at(-1)]),
        f.a.pinned.manifest,
      ),
    /follow IDAT/,
  );
});
test("PNG CRC errors and truncated or trailing containers reject", () => {
  const bad = image();
  bad[29] ^= 1;
  assert.throws(() => inspectImage(bad), /PNG CRC/);
  for (let end = 0; end < image().length; end++)
    assert.throws(() => inspectImage(image().subarray(0, end)));
  assert.throws(
    () => inspectImage(Buffer.concat([image(), Buffer.from([0])])),
    /trailing/,
  );
  const length = image();
  length.writeUInt32BE(0xffffffff, 8);
  assert.throws(() => inspectImage(length), /chunk length/);
});
test("PNG rejects duplicate headers nonempty IEND and nonconsecutive IDAT", () => {
  const c = pngChunks(image());
  assert.throws(
    () => inspectImage(assemble([c[0], c[0], ...c.slice(1)])),
    /header count/,
  );
  assert.throws(
    () =>
      inspectImage(
        assemble([...c.slice(0, -1), wrap("IEND", Buffer.from([0]))]),
      ),
    /structure/,
  );
  assert.throws(
    () =>
      inspectImage(
        assemble([c[0], c[1], wrap("IEND", Buffer.alloc(0)), c[1], c[2]]),
      ),
    /trailing/,
  );
});
test("PNG bounded inflater rejects excess short or invalid filtered pixels", () => {
  assert.throws(
    () => inspectImage(rawPng(1, 1, Buffer.alloc(100))),
    /larger than|size|length/i,
  );
  assert.throws(
    () => inspectImage(rawPng(1, 1, Buffer.alloc(4))),
    /scanline length/,
  );
  assert.throws(
    () => inspectImage(rawPng(1, 1, Buffer.from([5, 1, 2, 3, 4]))),
    /row filter/,
  );
  for (let filter = 0; filter <= 4; filter++)
    inspectImage(rawPng(1, 1, Buffer.from([filter, 1, 2, 3, 4])));
});
test("PNG rejects trailing deflate bytes and concatenated streams", () => {
  const c = pngChunks(image());
  for (const extra of [Buffer.from([1]), c[1].data])
    assert.throws(
      () =>
        inspectImage(
          assemble([
            c[0],
            wrap("IDAT", Buffer.concat([c[1].data, extra])),
            c[2],
          ]),
        ),
      /zlib trailing/,
    );
});
test("PNG enforces pixel color interlace file payload and chunk budgets", (t) => {
  inspectImage(rawPng(512, 512, Buffer.alloc((512 * 4 + 1) * 512)));
  assert.equal(512 * 512, PIXEL_LIMIT);
  assert.throws(
    () => inspectImage(rawPng(513, 512, Buffer.alloc(5))),
    /pixel limit/,
  );
  for (const patch of [{ 8: 16 }, { 9: 2 }, { 10: 1 }, { 11: 1 }, { 12: 1 }])
    assert.throws(
      () => inspectImage(rawPng(1, 1, Buffer.alloc(5), patch)),
      /RGBA8/,
    );
  assert.throws(
    () => inspectImage(rawPng(0, 1, Buffer.alloc(5))),
    /pixel limit/,
  );
  assert.throws(
    () => inspectImage(Buffer.alloc(IMAGE_LIMIT + 1)),
    /image size/,
  );
  assert.throws(() => pngChunks(Buffer.alloc(FILE_LIMIT + 1)), /file size/);
  const f = fixture(t);
  assert.throws(
    () =>
      importImage(
        attach(image(), Buffer.alloc(PAYLOAD_LIMIT + 1)),
        f.a.pinned.manifest,
      ),
    /payload size/,
  );
  const c = pngChunks(image()),
    many = assemble([
      c[0],
      ...Array.from({ length: CHUNK_LIMIT }, () =>
        wrap("IDAT", Buffer.alloc(0)),
      ),
      c[1],
      c[2],
    ]);
  assert.throws(() => inspectImage(many), /chunk count/);
});
test("invalid image issuance rejects before local or issuer writes", (t) => {
  const f = fixture(t),
    session = f.issuer.session("issue"),
    before = rows(f);
  for (const bad of [
    Buffer.from("not PNG"),
    attach(image(), Buffer.from("{}"), "zfTA"),
    Buffer.alloc(IMAGE_LIMIT + 1),
  ]) {
    assert.throws(() => prepareImageIssue(f.a, session, bad));
    assert.deepEqual(rows(f), before);
  }
});

test("maximum PNG chunk budget remains exportable before issuance", (t) => {
  const f = fixture(t),
    c = pngChunks(image());
  const allowed = assemble([
    c[0],
    ...Array.from({ length: CHUNK_LIMIT - 4 }, () =>
      wrap("IDAT", Buffer.alloc(0)),
    ),
    c[1],
    c[2],
  ]);
  assert.equal(pngChunks(allowed).length, CHUNK_LIMIT - 1);
  const session = f.issuer.session("issue"),
    before = rows(f);
  const tooMany = assemble([
    c[0],
    wrap("IDAT", Buffer.alloc(0)),
    ...pngChunks(allowed).slice(1),
  ]);
  assert.throws(
    () => prepareImageIssue(f.a, session, tooMany),
    /image chunk count/,
  );
  assert.deepEqual(rows(f), before);
  const d = prepareImageIssue(f.a, session, allowed);
  f.acknowledge(f.a, d);
  const file = exportImage(
    f.a.export(f.a.submit(d, f.issuer)),
    f.a.pinned.manifest,
  );
  assert.equal(pngChunks(file).length, CHUNK_LIMIT);
  assert.deepEqual(importImage(file, f.a.pinned.manifest).image, allowed);
});
