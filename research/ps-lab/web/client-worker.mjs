import { storageChecks } from "./client-checks.mjs";
import { BrowserClient } from "./client.mjs";
import { openStore, readSlot, writeSlot } from "./client-storage.mjs";
import * as p from "./profile.mjs";
let config,
  client = null,
  db = null,
  busy = false,
  epoch = 0,
  token = null;
const active = (e) => {
  if (e !== epoch) throw new Error("locked");
};
async function api(body, e) {
  active(e);
  const r = await fetch("/issuer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: p.canonical(body),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  active(e);
  if (!r.ok) throw new Error("issuer rejected");
  const value = await r.json();
  active(e);
  return value;
}
self.onmessage = async ({ data }) => {
  const { id, action } = data;
  if (action === "lock") {
    epoch++;
    client?.lock();
    client = null;
    token = null;
    db?.close();
    db = null;
    self.postMessage({ id, ok: true, result: { locked: true } });
    return;
  }
  if (busy) {
    self.postMessage({ id, ok: false });
    return;
  }
  busy = true;
  const e = epoch;
  let opened;
  try {
    let result = {};
    if (action === "open" || action === "create") {
      client?.lock();
      client = null;
      token = data.token;
      if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("launch capability");
      config = { manifest: data.manifest, id: data.clientId };
      p.trust(data.manifest);
      p.bytes(data.clientId, 16);
      db?.close();
      const connected = await openStore();
      try {
        active(e);
      } catch (err) {
        connected.close();
        throw err;
      }
      db = connected;
      const old = await readSlot(db, data.manifest, data.clientId);
      active(e);
      const persist = (wire, revision) => {
        active(e);
        return writeSlot(db, data.manifest, data.clientId, wire, revision);
      };
      if (action === "create") {
        if (old) throw new Error("browser copy exists");
        opened = await BrowserClient.create(
          data.manifest,
          data.clientId,
          data.password,
          persist,
        );
      } else {
        if (!old) throw new Error("no browser copy");
        opened = await BrowserClient.open(
          old.wire,
          data.password,
          data.manifest,
          data.clientId,
          old.revision,
          persist,
        );
      }
      active(e);
      client = opened;
      opened = null;
    } else {
      if (!client) throw new Error("locked");
      if (action === "checks") {
        const row = await readSlot(db, config.manifest, config.id);
        active(e);
        result = {
          checks: await storageChecks(config.manifest, config.id, row.wire),
        };
      } else if (action === "mint") {
        const { session } = await api({ action: "session", kind: "issue" }, e);
        result = await client.prepareIssue(session, p.bytes(data.asset));
      } else if (action === "claim") {
        const { session } = await api({ action: "session", kind: "swap" }, e);
        result = await client.prepareClaim(
          session,
          data.wire,
          data.password,
          data.expectedId,
        );
      } else if (action === "cancel") {
        const { session } = await api({ action: "session", kind: "swap" }, e);
        result = await client.prepareCancel(session, data.credential);
      } else if (action === "backup")
        result = await client.backup(data.digest, data.password);
      else if (action === "acknowledge")
        await client.acknowledge(data.digest, data.wire, data.password);
      else if (action === "restore")
        result = await client.restore(
          data.wire,
          data.password,
          data.expectedId,
        );
      else if (action === "export")
        result = await client.export(data.credential, data.password);
      else if (action === "submit" || action === "recover") {
        const { response } = await api(
          client.submission(data.digest, action === "recover"),
          e,
        );
        if (response === null)
          throw new Error("unknown operation; retain pending");
        if (action === "submit" && data.loseResponse === true)
          result = { lost: true };
        else result = await client.accept(data.digest, response);
      } else throw new Error("unknown action");
    }
    active(e);
    self.postMessage({
      id,
      ok: true,
      result: { ...result, state: client.summary() },
    });
  } catch {
    opened?.lock();
    self.postMessage({ id, ok: false });
  } finally {
    busy = false;
  }
};
