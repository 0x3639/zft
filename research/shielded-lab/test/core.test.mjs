import test from "node:test";
import assert from "node:assert/strict";
import {
  canonical,
  parseCanonical,
  exact,
  metadata,
  asset,
  domain,
  limbs,
  uint,
  Q,
  MAX_SECRET,
  createProfile,
} from "../core.mjs";
import { deployment as d, metadata as m } from "./fixtures.mjs";
const p = await createProfile();
test("canonical schema rejects ambiguity and unbounded nesting", () => {
  assert.equal(canonical({ z: 1, a: "é" }), '{"a":"é","z":1}');
  for (const text of [
    '{"a":1,"a":1}',
    '{"z":1,"a":2}',
    '{"n":1.0}',
    '{"n":-0}',
    '{"s":"\\ud800"}',
  ])
    assert.throws(() => parseCanonical(text));
  let deep = {};
  for (let i = 0; i < 18; i++) deep = { a: deep };
  assert.throws(() => canonical(deep));
  assert.throws(() => exact({ "a,b": 1 }, ["a", "b"]));
  assert.throws(() => parseCanonical(" ".repeat(16385)));
  assert.throws(() => canonical({ n: 1.5 }));
});
test("metadata is exact, bounded and binds full image digest", () => {
  assert.deepEqual(metadata(m), m);
  for (const patch of [
    { extra: true },
    { format: "zft-v1" },
    { imageHash: "0x" + "a".repeat(63) },
    { width: 0 },
    { height: 24000001 },
    { name: "a".repeat(257) },
    { createdAt: "2026-02-30T00:00:00.000Z" },
    { createdAt: "2026-99-99T00:00:00.000Z" },
    { creator: "0x" + "0".repeat(40) },
  ])
    assert.throws(() => metadata({ ...m, ...patch }));
  const original = asset(d, m);
  for (const patch of [
    { imageHash: "0x" + "f".repeat(64) },
    { description: "changed" },
    { creator: "0x" + "3".repeat(40) },
  ])
    assert.notEqual(asset(d, { ...m, ...patch }).assetId, original.assetId);
  assert.notEqual(
    asset({ ...d, chainId: "31338" }, m).assetId,
    original.assetId,
  );
  assert.notEqual(domain({ ...d, registry: "0x" + "3".repeat(40) }), domain(d));
});
test("digest limbs preserve 256 bits rather than reducing the asset identity", () => {
  const high = (1n << 256n) - 1n,
    low = high - Q;
  const fmt = (x) => "0x" + x.toString(16).padStart(64, "0");
  const a = limbs(fmt(high)),
    b = limbs(fmt(low));
  assert.equal(high % Q, low % Q);
  assert.notDeepEqual(a, b);
  assert.equal((a[0] << 128n) | a[1], high);
  for (const x of ["-1", "01", "1e2", String(Q)]) assert.throws(() => uint(x));
});
test("note binds every field, domain and nonzero bounded authority", () => {
  const note = p.note(d, m, 1n, 2n);
  assert.deepEqual(p.validate(note, d), note);
  for (const patch of [
    { secret: "3" },
    { randomness: "4" },
    { commitment: "1" },
    { metadataHash: "0x" + "f".repeat(64) },
    { imageHash: "0x" + "f".repeat(64) },
    { assetId: "0x" + "f".repeat(64) },
    { metadata: { ...m, name: "changed" } },
    { format: "zft-v1" },
  ])
    assert.throws(() => p.validate({ ...note, ...patch }, d));
  assert.throws(() => p.validate(note, { ...d, chainId: "31338" }));
  for (const [sk, rho] of [
    [0n, 2n],
    [1n, 0n],
    [MAX_SECRET, 2n],
    [1n, MAX_SECRET],
  ])
    assert.throws(() => p.note(d, m, sk, rho));
  assert.equal(p.nullifier(note), p.nullifier(structuredClone(note)));
  assert.notEqual(p.nullifier(note), p.nullifier(p.note(d, m, 3n, 4n)));
});
test("tree reconstructs membership for all leaves and rejects mismatched paths", () => {
  const tree = new p.Tree(),
    empty = tree.root,
    notes = [];
  for (let i = 0; i < 5; i++) {
    const n = p.note(d, m, BigInt(i + 1), BigInt(i + 10));
    notes.push(n);
    tree.append(BigInt(n.commitment));
  }
  assert.notEqual(tree.root, empty);
  for (let i = 0; i < notes.length; i++) {
    const next = p.note(d, m, 100n + BigInt(i), 200n);
    const path = tree.path(i),
      input = p.spendInput(notes[i], next, path);
    assert.equal(input.root, String(tree.root));
    assert.throws(() => p.spendInput(notes[i], next, { ...path, root: empty }));
    assert.throws(() =>
      p.spendInput(notes[i], next, {
        ...path,
        bits: path.bits.map((b, j) => (j === 0 ? 2 : b)),
      }),
    );
  }
  assert.throws(() => tree.append(BigInt(notes[0].commitment)));
  assert.throws(() => p.spendInput(notes[0], notes[0], tree.path(0)));
  assert.throws(() =>
    p.spendInput(
      notes[0],
      p.note(d, { ...m, name: "different" }, 100n, 200n),
      tree.path(0),
    ),
  );
});
