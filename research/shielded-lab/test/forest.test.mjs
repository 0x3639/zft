import test, { after } from "node:test";
import { prove, closeProver } from "../prover.mjs";
after(closeProver);
import assert from "node:assert/strict";
import { createProfile, DEPTH } from "../core.mjs";
import { deployment, metadata } from "./fixtures.mjs";
const p = await createProfile();
test("a full-depth forest rolls over while preserving old paths and global uniqueness", async () => {
  const old = p.note(deployment, metadata, 1n, 2n),
    next = p.note(deployment, metadata, 3n, 4n),
    leaves = Array.from({ length: 2 ** DEPTH }, (_, i) =>
      i === 0 ? BigInt(old.commitment) : BigInt(i),
    );
  const forest = p.Forest.fromLeaves(leaves),
    closed = forest.root,
    path = forest.path(0),
    n = p.nullifier(old);
  assert.equal(forest.trees.length, 1);
  assert.equal(path.root, closed);
  forest.append(BigInt(next.commitment));
  assert.equal(forest.trees.length, 2);
  assert.notEqual(forest.root, closed);
  assert.equal(forest.path(0).root, closed);
  assert.equal(p.spendInput(old, next, forest.path(0)).nullifier, String(n));
  assert.equal(forest.path(2 ** DEPTH).root, forest.root);
  const proof = await prove("spend", p.spendInput(old, next, forest.path(0)));
  assert.equal(
    proof.signals[1],
    closed,
    "Real proof binds old closed-tree root",
  );
  assert.equal(
    proof.signals[2],
    n,
    "Tree rollover does not change the nullifier",
  );
  assert.throws(
    () => forest.append(BigInt(old.commitment)),
    "Closed-tree commitments remain globally unique",
  );
  assert.throws(() => p.Forest.fromLeaves([1n, 2n, 1n]));
});
test("bulk reconstruction agrees with incremental roots and witnesses", () => {
  const leaves = Array.from({ length: 17 }, (_, i) => BigInt(i + 1)),
    a = p.Tree.fromLeaves(leaves),
    b = new p.Tree();
  for (const c of leaves) b.append(c);
  assert.equal(a.root, b.root);
  for (let i = 0; i < leaves.length; i++)
    assert.deepEqual(a.path(i), b.path(i));
  a.append(18n);
  b.append(18n);
  assert.equal(a.root, b.root);
  assert.throws(() => p.Tree.fromLeaves(Array(2)));
  assert.throws(() => p.Tree.fromLeaves([0n]));
});
