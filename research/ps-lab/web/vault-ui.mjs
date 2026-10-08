import { openStore, readSlot, writeSlot } from "./storage.mjs";
import { storageChecks } from "./checks.mjs";
import { MAX_FILE } from "./schema.mjs";
const $ = (id) => document.getElementById(id);
let token = location.hash.slice(1),
  manifest,
  worker,
  db,
  currentId,
  wire,
  revision = 0,
  busy = false,
  seq = 0,
  generation = 0,
  downloadUrl,
  timer;
const pending = new Map();
history.replaceState(null, "", "/vault/");
const status = (text) => {
  $("status").textContent = text;
};
function controls() {
  for (const el of document.querySelectorAll("form button,input,select"))
    el.disabled = busy || !manifest;
  $("lock").disabled = false;
  for (const id of ["protect-button", "download", "verify-button", "checks"])
    $(id).disabled = busy || !worker || !wire;
}
function resetDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  $("save-link").replaceChildren();
}
function lock() {
  generation++;
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error("locked"));
  pending.clear();
  wire = null;
  currentId = null;
  revision = 0;
  resetDownload();
  for (const e of document.querySelectorAll("input")) e.value = "";
  $("records").textContent = "Locked. No decrypted records are shown.";
  clearTimeout(timer);
  status("Vault locked. Encrypted browser copies remain.");
  controls();
}
function touch() {
  clearTimeout(timer);
  if (worker) timer = setTimeout(lock, 5 * 60 * 1000);
}
function request(action, input) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, ...input });
  });
}
function startWorker() {
  worker = new Worker("/web/worker.mjs", { type: "module" });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.ok
      ? p.resolve(data.result)
      : p.reject(
          new Error(
            "Vault operation rejected. Check identity, file and password.",
          ),
        );
  };
  worker.onerror = () => lock();
}
async function run(work) {
  if (busy) return;
  busy = true;
  const g = generation;
  controls();
  status("Working in this browser…");
  try {
    await work(g);
  } catch (e) {
    if (g === generation)
      status(e.message || "Operation failed; keep your previous backup.");
  } finally {
    for (const e of document.querySelectorAll('input[type="password"]'))
      e.value = "";
    busy = false;
    controls();
    touch();
  }
}
function active(g) {
  if (g !== generation) throw new Error("locked");
}
async function selected(id) {
  const f = $(id).files[0];
  if (!f || f.size > MAX_FILE) throw new Error("Select a bounded vault file.");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    await f.arrayBuffer(),
  );
}
async function open(w, password, id, g, loaded) {
  const old = loaded ?? (await readSlot(db, manifest, id));
  active(g);
  if (old && old.wire !== w)
    throw new Error(
      "A different browser copy exists. Open that copy to avoid overwriting it.",
    );
  worker?.terminate();
  worker = null;
  wire = null;
  currentId = null;
  resetDownload();
  $("records").textContent = "Opening…";
  startWorker();
  let result;
  try {
    result = await request("open", {
      wire: w,
      password,
      manifest,
      vaultId: id,
    });
    active(g);
  } catch (e) {
    worker?.terminate();
    worker = null;
    throw e;
  }
  currentId = id;
  wire = w;
  revision = old?.revision ?? 0;
  $("records").textContent =
    result.records.map((r) => r.kind + " · " + r.id.slice(0, 16)).join("\n") ||
    "Empty vault";
  status("File authenticated and records verified in the browser worker.");
}
function form(id, work) {
  $(id).onsubmit = (e) => {
    e.preventDefault();
    void run(work);
  };
}
form("open", async (g) => {
  const id = $("expected").value,
    w = await selected("file");
  active(g);
  await open(w, $("password").value, id, g);
});
form("reopen", async (g) => {
  const id = $("expected").value,
    row = await readSlot(db, manifest, id);
  active(g);
  if (!row) throw new Error("No browser copy for this expected backup.");
  await open(row.wire, $("saved-password").value, id, g, row);
});
form("protect", async (g) => {
  const result = await request("seal", { password: $("new-password").value });
  active(g);
  const next = await writeSlot(db, manifest, currentId, result.wire, revision);
  active(g);
  revision = next;
  wire = result.wire;
  resetDownload();
  status(
    "Encrypted copy committed to browser storage. Save and verify a separate backup.",
  );
});
$("download").onclick = () =>
  run(async (g) => {
    active(g);
    resetDownload();
    downloadUrl = URL.createObjectURL(
      new Blob([wire], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "ps-browser-" + currentId + ".json";
    a.textContent = "Save " + a.download;
    $("save-link").append(a);
    status("Use the Save link, then reselect the downloaded file.");
  });
form("verify", async (g) => {
  const actual = await selected("verify-file");
  active(g);
  if (actual !== wire)
    throw new Error("File differs from this exact encrypted copy.");
  status(
    "Exact saved-file bytes verified. Issuer acknowledgment is unchanged.",
  );
});
$("checks").onclick = () =>
  run(async (g) => {
    const results = await storageChecks(manifest, currentId, wire);
    active(g);
    $("checks-result").textContent = results.map((x) => "PASS " + x).join("\n");
    status(results.length + " actual IndexedDB checks passed.");
  });
$("expected").onchange = lock;
$("lock").onclick = lock;
for (const event of ["pointerdown", "keydown"])
  document.addEventListener(event, touch);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) lock();
});
addEventListener("pagehide", lock);
void run(async (g) => {
  if (!/^[0-9a-f]{64}$/.test(token))
    throw new Error("Open Browser vault from the authenticated local console.");
  const response = await fetch("/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: '{"action":"state"}',
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  token = "";
  if (!response.ok) throw new Error("Local lab unavailable.");
  const { state } = await response.json();
  active(g);
  manifest = state.manifest;
  $("realm").textContent = "PINNED REALM " + manifest.realm.slice(0, 12);
  for (const b of state.backups) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.kind + " · " + b.actor + " · " + b.id;
    $("expected").append(o);
  }
  db = await openStore();
  active(g);
  status("Ready. Select an expected backup from this running lab.");
});
