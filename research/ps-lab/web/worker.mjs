import { BrowserVault } from "./vault.mjs";
let vault = null,
  busy = false,
  epoch = 0;
self.onmessage = async ({ data }) => {
  const { id, action } = data;
  if (action === "lock") {
    epoch++;
    vault?.lock();
    vault = null;
    self.postMessage({ id, ok: true, result: { locked: true } });
    return;
  }
  if (busy) {
    self.postMessage({ id, ok: false });
    return;
  }
  busy = true;
  const started = epoch;
  let opened;
  try {
    let result;
    if (action === "open") {
      vault?.lock();
      vault = null;
      opened = await BrowserVault.open(
        data.wire,
        data.password,
        data.manifest,
        data.vaultId,
      );
      if (started !== epoch) throw new Error("locked during open");
      vault = opened;
      opened = null;
      result = { id: vault.id, records: vault.list() };
    } else if (action === "seal") {
      if (!vault) throw new Error("locked");
      result = { wire: await vault.seal(data.password) };
    } else throw new Error("unknown action");
    if (started !== epoch) throw new Error("locked during operation");
    self.postMessage({ id, ok: true, result });
  } catch {
    opened?.lock();
    self.postMessage({ id, ok: false });
  } finally {
    busy = false;
  }
};
