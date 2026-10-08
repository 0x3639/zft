// Actual IndexedDB checks, invoked explicitly from the local research UI.
import assert from "./runtime.mjs";
import * as p from "./profile.mjs";
import { openStore, readSlot, writeSlot, MAX_SLOTS } from "./storage.mjs";
export async function storageChecks(manifest, id, wire) {
  const name = "zft-ps-storage-check-" + p.randomHex(8),
    db = await openStore(name),
    passed = [];
  const reject = async (fn, label) => {
    let failed = false;
    try {
      await fn();
    } catch {
      failed = true;
    }
    assert(failed, label);
  };
  try {
    assert.equal(await readSlot(db, manifest, id), null);
    assert.equal(await writeSlot(db, manifest, id, wire, 0), 1);
    passed.push("new encrypted slot commits");
    const row = await readSlot(db, manifest, id);
    assert.equal(row.wire, wire);
    assert.equal(Object.keys(row).sort().join(","), "key,revision,wire");
    passed.push("only encrypted wire and revision persist");
    await reject(() => writeSlot(db, manifest, id, wire, 0), "stale write");
    assert.equal((await readSlot(db, manifest, id)).revision, 1);
    passed.push("stale revision rejected without change");
    await reject(
      () =>
        writeSlot(db, manifest, id, wire, 1, {
          beforeCommit: (tx) => tx.abort(),
        }),
      "abort",
    );
    assert.equal((await readSlot(db, manifest, id)).revision, 1);
    passed.push("abort after put preserves prior ciphertext");
    const peer = await openStore(name);
    try {
      const race = await Promise.allSettled([
        writeSlot(db, manifest, id, wire, 1),
        writeSlot(peer, manifest, id, wire, 1),
      ]);
      assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal((await readSlot(db, manifest, id)).revision, 2);
    } finally {
      peer.close();
    }
    passed.push("two connections cannot overwrite from the same revision");
    await reject(
      () => writeSlot(db, manifest, "ff".repeat(16), wire, 0),
      "wrong pin",
    );
    passed.push("wrong pinned identity rejected");
    // Storage accepts only envelope schema, not authority. Synthetic ciphertext is
    // deliberate here; BrowserVault.open independently authenticates all reads.
    const parsed = JSON.parse(wire);
    for (let i = 1; i < MAX_SLOTS; i++) {
      const next = i.toString(16).padStart(32, "0");
      await writeSlot(
        db,
        manifest,
        next,
        p.canonical({ ...parsed, vault_id: next }),
        0,
      );
    }
    const extra = "ef".repeat(16);
    await reject(
      () =>
        writeSlot(
          db,
          manifest,
          extra,
          p.canonical({ ...parsed, vault_id: extra }),
          0,
        ),
      "slot limit",
    );
    passed.push("slot count bounded");
    return passed;
  } finally {
    db.close();
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = resolve;
      r.onerror = reject;
      r.onblocked = () => reject(new Error("test cleanup blocked"));
    });
  }
}
