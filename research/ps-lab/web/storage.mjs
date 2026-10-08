// IndexedDB stores canonical encrypted envelopes only; pins come from the caller.
import assert from "./runtime.mjs";
import * as p from "./profile.mjs";
import { header } from "./schema.mjs";
export const DB_NAME = "zft-ps-browser-vault-lab-v1";
export const MAX_SLOTS = 8;
export const slotKey = (manifest, id) =>
  p.hash(p.canonical(manifest)) + ":" + id;
export function openStore(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("vaults", { keyPath: "key" });
    request.onerror = () => reject(new Error("storage unavailable"));
    request.onblocked = () => reject(new Error("storage upgrade blocked"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
export function readSlot(db, manifest, id) {
  const pinned = p.trust(manifest);
  p.bytes(id, 16);
  return new Promise((resolve, reject) => {
    const tx = db.transaction("vaults", "readonly");
    let row;
    const request = tx.objectStore("vaults").get(slotKey(manifest, id));
    request.onsuccess = () => {
      row = request.result;
    };
    tx.oncomplete = () => {
      try {
        if (row) {
          header(row.wire, pinned, id);
          assert(
            Number.isSafeInteger(row.revision) && row.revision > 0,
            "stored revision",
          );
        }
        resolve(row ?? null);
      } catch (e) {
        reject(e);
      }
    };
    tx.onabort = () => reject(new Error("storage read aborted"));
    tx.onerror = () => {};
  });
}
export function writeSlot(
  db,
  manifest,
  id,
  wire,
  expectedRevision,
  { beforeCommit = () => {} } = {},
) {
  header(wire, p.trust(manifest), id);
  assert(
    Number.isSafeInteger(expectedRevision) &&
      expectedRevision >= 0 &&
      expectedRevision < Number.MAX_SAFE_INTEGER,
    "revision",
  );
  return new Promise((resolve, reject) => {
    const tx = db.transaction("vaults", "readwrite");
    const store = tx.objectStore("vaults");
    let revision, error;
    const key = slotKey(manifest, id),
      get = store.get(key);
    const fail = (e) => {
      error = e;
      tx.abort();
    };
    get.onsuccess = () => {
      try {
        assert.equal(
          get.result?.revision ?? 0,
          expectedRevision,
          "stale browser write",
        );
        const count = store.count();
        count.onsuccess = () => {
          try {
            assert(
              get.result || count.result < MAX_SLOTS,
              "browser slot limit",
            );
            revision = expectedRevision + 1;
            const put = store.put({ key, revision, wire });
            put.onsuccess = () => {
              try {
                beforeCommit(tx);
              } catch (e) {
                fail(e);
              }
            };
          } catch (e) {
            fail(e);
          }
        };
      } catch (e) {
        fail(e);
      }
    };
    tx.oncomplete = () => resolve(revision);
    tx.onabort = () => reject(error ?? new Error("storage write aborted"));
    tx.onerror = () => {};
  });
}
