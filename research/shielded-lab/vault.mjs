// Client-owned encrypted operation journal. IndexedDB durability is browser/OS dependent.
import { check, canonical } from "./core.mjs";
import {
  sealRecovery,
  openRecovery,
  validateOperation,
  classifySpend,
  classifyCreation,
} from "./recovery.mjs";
import { observeSpend, observeCreation, pinDeployment } from "./chain.mjs";
const STORE = "operations";
export async function openVault({
  indexedDB = globalThis.indexedDB,
  name = "zft-shielded-v1",
} = {}) {
  check(
    indexedDB &&
      typeof name === "string" &&
      name.length > 0 &&
      name.length < 128,
    "Vault unavailable",
  );
  const db = await new Promise((yes, no) => {
    let abandoned = false;
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE))
        r.result.createObjectStore(STORE, { keyPath: "id" });
    };
    r.onsuccess = () => {
      if (abandoned) r.result.close();
      else yes(r.result);
    };
    r.onerror = () => no(Error("Vault unavailable"));
    r.onblocked = () => {
      abandoned = true;
      no(Error("Vault upgrade blocked"));
    };
  });
  let closed = false;
  db.onversionchange = () => {
    closed = true;
    db.close();
  };
  function transact(mode, action) {
    check(!closed, "Vault closed");
    return new Promise((yes, no) => {
      let tx, value, problem;
      try {
        tx = db.transaction(STORE, mode, { durability: "strict" });
      } catch {
        no(Error("Vault transaction unavailable"));
        return;
      }
      tx.oncomplete = () => yes(value);
      tx.onabort = () => no(problem ?? Error("Vault transaction failed"));
      tx.onerror = () => {};
      const set = (v) => {
          value = v;
        },
        fail = (message) => {
          problem = Error(message);
          tx.abort();
        };
      try {
        action(tx.objectStore(STORE), set, fail);
      } catch {
        fail("Vault operation failed");
      }
    });
  }
  const get = (id) =>
    transact("readonly", (store, set, fail) => {
      const r = store.get(id);
      r.onsuccess = () => {
        if (!r.result) fail("Recovery record missing");
        else set(r.result);
      };
    });
  const modify = (id, change) =>
    transact("readwrite", (store, set, fail) => {
      const r = store.get(id);
      r.onsuccess = () => {
        if (!r.result) {
          fail("Recovery record missing");
          return;
        }
        try {
          const next = { ...change(r.result), revision: r.result.revision + 1 };
          store.put(next);
          set(next);
        } catch {
          fail("Journal transition rejected");
        }
      };
    });
  return {
    async prepare(profile, record, password, deployment) {
      const validated = validateOperation(profile, record, deployment).record,
        sealed = await sealRecovery(validated, password);
      const row = {
        format: "zft-shielded-journal-v1",
        id: validated.id,
        sealed,
        state: "prepared",
        acknowledged: false,
        revision: 0,
        attempts: 0,
        transactionHashes: [],
        observation: null,
      };
      await transact("readwrite", (store, set) => {
        store.add(row);
        set(row.id);
      });
      return row.id;
    },
    async export(id) {
      return (await get(id)).sealed;
    },
    async unlock(id, password, profile, deployment) {
      const row = await get(id);
      return openRecovery(row.sealed, password, profile, deployment);
    },
    async acknowledge(id, reselected, password, profile, deployment) {
      const row = await get(id),
        opened = await openRecovery(reselected, password, profile, deployment);
      check(
        opened.record.id === id && reselected === row.sealed,
        "Select the saved recovery export",
      );
      await modify(id, (current) => {
        check(
          current.sealed === row.sealed &&
            ["prepared", "unobserved"].includes(current.state),
        );
        return { ...current, acknowledged: true };
      });
    },
    async beginSubmission(id) {
      const row = await modify(id, (current) => {
        check(
          current.acknowledged &&
            ["prepared", "unobserved"].includes(current.state) &&
            current.attempts < 32,
          "Recovery acknowledgement required",
        );
        return {
          ...current,
          state: "uncertain",
          attempts: current.attempts + 1,
        };
      });
      return { id: row.id, attempt: row.attempts };
    },
    async noteTransaction(id, hash) {
      check(/^0x[0-9a-f]{64}$/.test(hash));
      await modify(id, (current) => {
        check(current.state === "uncertain");
        return {
          ...current,
          transactionHashes: [
            ...new Set([...current.transactionHashes, hash]),
          ].slice(-32),
        };
      });
    },
    async observe(id, password, profile, client, pins) {
      const row = await get(id),
        { record } = await openRecovery(
          row.sealed,
          password,
          profile,
          pinDeployment(pins),
        );
      const observation =
        record.kind === "create"
          ? await observeCreation(client, pins, profile, record)
          : await observeSpend(client, pins, profile, record);
      const classification =
        record.kind === "create"
          ? classifyCreation(record, observation)
          : classifySpend(profile, record, observation);
      const summary = { ...observation };
      if ("successor" in summary) summary.successor = String(summary.successor);
      await modify(id, (current) => {
        check(
          current.sealed === row.sealed && current.revision === row.revision,
          "Journal changed during observation",
        );
        return {
          ...current,
          state: classification.state,
          observation: summary,
        };
      });
      return classification;
    },
    async list() {
      const rows = await transact("readonly", (store, set) => {
        const r = store.getAll();
        r.onsuccess = () => set(r.result);
      });
      return rows.map(({ sealed, ...publicState }) => publicState);
    },
    close() {
      closed = true;
      db.close();
    },
  };
}
