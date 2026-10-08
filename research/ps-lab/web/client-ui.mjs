import { MAX_FILE } from "./client-cipher.mjs";
import { FILE_LIMIT } from "./png.mjs";
import * as p from "./profile.mjs";
const $ = (id) => document.getElementById(id);
let token = location.hash.slice(1),
  bootstrap,
  worker,
  busy = false,
  generation = 0,
  seq = 0,
  timer,
  downloadUrl,
  previewUrl,
  unlocked = false;
const pending = new Map();
history.replaceState(null, "", "/client/");
function status(s) {
  $("status").textContent = s;
}
function controls() {
  for (const el of document.querySelectorAll("form button,input,select"))
    el.disabled = busy || !bootstrap;
  for (const el of document.querySelectorAll(
    "[data-open] button,[data-open] input,[data-open] select",
  ))
    el.disabled = busy || !unlocked;
  $("lock").disabled = false;
}
function clearDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  $("save-link").replaceChildren();
}
function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $("preview").removeAttribute("src");
  $("preview").hidden = true;
  $("preview-caption").textContent =
    "Choose View artwork for the selected credential.";
}
function showImage(artwork) {
  clearPreview();
  previewUrl = URL.createObjectURL(
    new Blob([artwork.bytes], { type: "image/png" }),
  );
  $("preview").src = previewUrl;
  $("preview").hidden = false;
  $("preview-caption").textContent =
    artwork.width + " × " + artwork.height + " · SHA-256 " + artwork.digest;
}
function imageDownload(result) {
  clearDownload();
  const privateFile = result.imageKind === "private-image";
  downloadUrl = URL.createObjectURL(
    new Blob([result.artwork.bytes], { type: "image/png" }),
  );
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download =
    "ps-" +
    (privateFile ? "private-bearer" : "public-artwork") +
    "-" +
    result.artwork.digest.slice(0, 16) +
    ".png";
  a.textContent = "Save " + a.download;
  $("save-link").append(
    a,
    document.createElement("br"),
    document.createTextNode(
      privateFile
        ? "Private bearer PNG: anyone with this file can attempt a claim. Keep it off public uploads."
        : "Public artwork: original image bytes only; no credential envelope.",
    ),
  );
}
function lock() {
  generation++;
  worker?.terminate();
  worker = null;
  unlocked = false;
  for (const v of pending.values())
    v.reject(new Error("Locked. Reopen the saved browser copy."));
  pending.clear();
  clearDownload();
  clearPreview();
  clearTimeout(timer);
  for (const el of document.querySelectorAll("input")) el.value = "";
  $("operations").replaceChildren();
  $("credentials").replaceChildren();
  $("state").textContent = "Locked. Encrypted browser copies remain.";
  status("Locked. Open the saved browser copy to continue.");
  controls();
}
function touch() {
  clearTimeout(timer);
  if (unlocked) timer = setTimeout(lock, 300000);
}
function active(g) {
  if (g !== generation) throw new Error("locked");
}
function start() {
  worker = new Worker("/web/client-worker.mjs", { type: "module" });
  worker.onmessage = ({ data }) => {
    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    data.ok
      ? waiter.resolve(data.result)
      : waiter.reject(
          new Error(
            "Action rejected. Keep recovery files; check password, file, expected ID and pending state. Reopen after a storage conflict.",
          ),
        );
  };
  worker.onerror = lock;
}
function call(action, data = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, ...data });
  });
}
function render(state) {
  if (!state) return;
  clearPreview();
  unlocked = true;
  const select = (id, rows, label) => {
    const old = $(id).value;
    $(id).replaceChildren();
    for (const row of rows) {
      const option = document.createElement("option");
      option.value = row.digest ?? row.id;
      option.textContent = label(row);
      $(id).append(option);
    }
    if (rows.some((r) => (r.digest ?? r.id) === old)) $(id).value = old;
  };
  select(
    "operations",
    state.operations,
    (r) =>
      r.digest.slice(0, 16) +
      " · " +
      (r.complete
        ? "complete"
        : r.acknowledged
          ? "ready to submit"
          : "save recovery"),
  );
  select(
    "credentials",
    state.credentials.filter((r) => !r.locallySpent),
    (r) => r.id.slice(0, 24),
  );
  $("state").textContent =
    "Browser revision " +
    state.revision +
    " · " +
    state.credentials.filter((r) => !r.locallySpent).length +
    " locally active credential(s). The issuer decides whether a copy is spent.";
}
function download(result, kind) {
  clearDownload();
  downloadUrl = URL.createObjectURL(
    new Blob([result.wire], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = "ps-" + kind + "-" + result.id + ".json";
  a.textContent = "Save " + a.download;
  $("save-link").append(
    a,
    document.createElement("br"),
    document.createTextNode("Expected file ID: " + result.id),
  );
}
async function selected() {
  const file = $("file").files[0];
  if (!file || file.size > MAX_FILE)
    throw new Error("Select a bounded encrypted file.");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    await file.arrayBuffer(),
  );
}
async function run(work) {
  if (busy) return;
  busy = true;
  const g = generation;
  controls();
  status("Working in this browser…");
  try {
    const result = await work(g);
    active(g);
    if (result) {
      render(result.state);
      if (result.artwork) {
        if (result.imageKind === "view-image") showImage(result.artwork);
        else imageDownload(result);
      }
      if (result.checks)
        $("checks-result").textContent = result.checks
          .map((x) => "PASS " + x)
          .join("\n");
      if (result.digest) $("operations").value = result.digest;
    }
    status(
      result?.lost
        ? "Issuer committed; response deliberately discarded. Recover the same pending operation."
        : "Done. Keep the saved recovery file until the result is verified.",
    );
  } catch (e) {
    if (g === generation) status(e.message);
  } finally {
    for (const el of document.querySelectorAll("input[type=password]"))
      el.value = "";
    busy = false;
    controls();
    touch();
  }
}
function form(id, work) {
  $(id).onsubmit = (e) => {
    e.preventDefault();
    void run(work);
  };
}
form("unlock", async (g) => {
  worker?.terminate();
  worker = null;
  unlocked = false;
  start();
  const result = await call($("mode").value, {
    token,
    manifest: bootstrap.manifest,
    clientId: bootstrap.clients[$("actor").value],
    password: $("password").value,
  });
  active(g);
  return result;
});
form("mint", () =>
  call("mint", { asset: bootstrap.fixtures[Number($("art").value)].asset }),
);
form("png-import", async (g) => {
  const file = $("png-file").files[0];
  if (!file || file.size > FILE_LIMIT)
    throw new Error("Select a PNG no larger than 69,644 bytes.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  active(g);
  return call($("png-action").value, { bytes });
});
form("operation", async (g) => {
  const action = $("operation-action").value,
    digest = $("operations").value;
  if (!digest) throw new Error("Prepare or restore an operation first.");
  if (action === "backup") {
    const result = await call(action, {
      digest,
      password: $("file-password").value,
    });
    active(g);
    download(result, "recovery");
    return result;
  }
  if (action === "acknowledge") {
    const wire = await selected();
    active(g);
    return call(action, { digest, wire, password: $("file-password").value });
  }
  return call(action, { digest, loseResponse: $("lose").checked });
});
form("import", async (g) => {
  const wire = await selected();
  active(g);
  return call($("import-action").value, {
    wire,
    password: $("file-password").value,
    expectedId: $("expected").value,
  });
});
form("credential", async (g) => {
  const action = $("credential-action").value,
    result = await call(action, {
      credential: $("credentials").value,
      password: $("file-password").value,
    });
  active(g);
  if (action === "export") download(result, "transfer");
  return result;
});
$("checks").onclick = () => run(() => call("checks"));
$("credentials").onchange = clearPreview;
$("actor").onchange = lock;
$("lock").onclick = lock;
for (const event of ["pointerdown", "keydown"])
  document.addEventListener(event, touch);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) lock();
});
addEventListener("pagehide", lock);
void run(async (g) => {
  if (!/^[0-9a-f]{64}$/.test(token))
    throw new Error(
      "Use the Browser client launch link from the local console.",
    );
  const r = await fetch("/issuer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: '{"action":"bootstrap"}',
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!r.ok) throw new Error("Local issuer unavailable.");
  const b = await r.json();
  active(g);
  p.trust(b.manifest);
  bootstrap = b;
  $("realm").textContent = "PINNED REALM " + b.manifest.realm.slice(0, 16);
  for (const [i, f] of b.fixtures.entries()) {
    const o = document.createElement("option");
    o.value = i;
    o.textContent =
      "Test artwork " + (i + 1) + " · " + f.width + " × " + f.height;
    $("art").append(o);
  }
});
