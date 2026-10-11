import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { createProfile, digest } from "../core.mjs";
import { operation, openRecovery } from "../recovery.mjs";
import { openVault } from "../vault.mjs";
import { deployment as d, metadata as m } from "./fixtures.mjs";
const p = await createProfile(),
  image = new Uint8Array([1, 2, 3]),
  old = p.note(d, m, 1n, 2n),
  next = p.note(d, m, 3n, 4n),
  password = "disposable vault acceptance password";
const names = [
  "registry",
  "hasher",
  "creationAdapter",
  "spendAdapter",
  "creationVerifier",
  "spendVerifier",
];
const pins = {
  format: "zft-shielded-local-deployment-v1",
  chainId: d.chainId,
  genesisHash: "0x" + "a".repeat(64),
  deploymentBlock: "1",
  system: "groth16",
  contracts: Object.fromEntries(
    names.map((n, i) => [
      n,
      {
        address: i === 0 ? d.registry : "0x" + String(i + 2).repeat(40),
        codeHash: "0x" + "b".repeat(64),
      },
    ]),
  ),
  artifacts: Object.fromEntries(
    [
      "createWasm",
      "spendWasm",
      "createKey",
      "spendKey",
      "createVerificationKey",
      "spendVerificationKey",
    ].map((n) => [n, "0x" + "c".repeat(64)]),
  ),
};
const record = operation(p, { image, source: old, destination: next, pins });
const remove = (name) =>
  new Promise((yes, no) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = yes;
    r.onerror = no;
  });
test("acknowledged recovery precedes submission; competing tabs cannot begin twice", async () => {
  const name = "shielded-test-" + crypto.randomUUID();
  const a = await openVault({ indexedDB, name }),
    b = await openVault({ indexedDB, name });
  try {
    const id = await a.prepare(p, record, password, d);
    await assert.rejects(a.beginSubmission(id));
    const exported = await a.export(id);
    assert.deepEqual(
      (await openRecovery(exported, password, p, d)).record,
      record,
    );
    await assert.rejects(a.acknowledge(id, exported + " ", password, p, d));
    await a.acknowledge(id, exported, password, p, d);
    const races = await Promise.allSettled([
      a.beginSubmission(id),
      b.beginSubmission(id),
    ]);
    assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
    const [row] = await b.list();
    assert.equal(row.state, "uncertain");
    assert.equal(row.attempts, 1);
    assert.equal(row.acknowledged, true);
    assert.ok(!JSON.stringify(row).includes(record.destination.assetId));
    await a.noteTransaction(id, "0x" + "1".repeat(64));
    await assert.rejects(
      a.prepare(p, record, password, d),
      "Existing operation cannot be overwritten/reset",
    );
    a.close();
    b.close();
    const restarted = await openVault({ indexedDB, name });
    try {
      assert.equal((await restarted.list())[0].state, "uncertain");
      assert.deepEqual(
        (await restarted.unlock(id, password, p, d)).record.destination,
        next,
      );
      await assert.rejects(restarted.beginSubmission(id));
    } finally {
      restarted.close();
    }
  } finally {
    a.close();
    b.close();
    await remove(name);
  }
});
test("browser storage loss is recoverable only from a user-held encrypted export", async () => {
  const name = "shielded-loss-" + crypto.randomUUID(),
    a = await openVault({ indexedDB, name });
  const id = await a.prepare(p, record, password, d),
    exported = await a.export(id);
  a.close();
  await remove(name);
  const b = await openVault({ indexedDB, name });
  try {
    await assert.rejects(b.unlock(id, password, p, d));
    const recovered = await openRecovery(exported, password, p, d);
    assert.equal(await b.prepare(p, recovered.record, password, d), id);
    assert.deepEqual(
      (await b.unlock(id, password, p, d)).record.destination,
      next,
    );
    assert.equal((await b.list())[0].acknowledged, false);
  } finally {
    b.close();
    await remove(name);
  }
});

test("abandoned blocked vault open closes a late successful connection", async () => {
  let request,
    closed = 0;
  const pending = openVault({
    indexedDB: {
      open() {
        request = {};
        return request;
      },
    },
    name: "blocked-fixture",
  });
  request.onblocked();
  await assert.rejects(pending, /blocked/);
  request.result = {
    close() {
      closed++;
    },
  };
  request.onsuccess();
  assert.equal(closed, 1, "Late success cannot leak an abandoned connection");
});
