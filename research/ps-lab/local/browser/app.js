// UI only: all cryptography and working stores remain in the disposable Node lab.
const $ = (id) => document.getElementById(id);
let downloadUrl,
  token = location.hash.slice(1),
  state,
  busy = false;
$("vault-link").href = "/vault/#" + token;
history.replaceState(null, "", "/"); // Keep launch capability out of subsequent URLs.
const message = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
};
const canonical = (input) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((k) => [k, input[k]]),
    ),
  );
function options(id, values, label) {
  const selected = $(id).value;
  $(id).replaceChildren(
    ...values.map((v) => {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = label(v);
      return o;
    }),
  );
  if (values.some((v) => v.id === selected)) $(id).value = selected;
  else if (values.length) $(id).value = values.at(-1).id;
}
function render() {
  if (!state) return;
  const actor = $("actor").value;
  options(
    "operation",
    state.operations
      .filter((o) => o.actor === actor)
      .map((o) => ({ ...o, id: o.digest })),
    (o) =>
      `${o.kind} · ${o.id.slice(0, 10)} · ${o.complete ? "saved" : o.acknowledged ? "ready" : "backup required"}`,
  );
  const op = state.operations.find(
    (o) => o.actor === actor && o.digest === $("operation").value,
  );
  $("operation-state").textContent = op
    ? op.complete
      ? "Verified response saved. Exact retries remain possible."
      : op.acknowledged
        ? "Recovery verified. Ready for submission or retry."
        : "Submission blocked until encrypted recovery is reselected and verified."
    : "Prepare a mint, claim or cancellation first.";
  options(
    "backup-id",
    state.backups.filter(
      (b) =>
        b.kind === "recovery" && b.actor === actor && b.digest === op?.digest,
    ),
    (b) => b.id,
  );
  options(
    "restore-id",
    state.backups.filter((b) => b.kind === "recovery"),
    (b) => `${b.actor} · ${b.id}`,
  );
  options(
    "bearer-id",
    state.backups.filter((b) => b.kind === "bearer"),
    (b) => `${b.actor} · ${b.id}`,
  );
  options(
    "credential",
    state.credentials.filter((c) => c.actor === actor),
    (c) =>
      `${c.id.slice(0, 16)} · ${c.locallySpent ? "locally spent" : "locally active"}`,
  );
  $("realm").textContent = "REALM " + state.realm.slice(0, 12);
  $("counts").textContent =
    `${state.counts.operations} committed · ${state.counts.spent} spent`;
  if (!$("fixture").options.length) {
    options(
      "fixture",
      state.fixtures.map((f) => ({ ...f, id: String(f.index) })),
      (f) => `Artwork ${f.index + 1} · ${f.width} × ${f.height}`,
    );
    $("fixture").value = "0";
    $("artwork").replaceChildren(
      ...state.fixtures.map((f) => {
        const image = document.createElement("img");
        image.alt = `Test artwork ${f.index + 1}`;
        image.src = "data:image/png;base64," + f.base64;
        return image;
      }),
    );
  }
  const auth = /^[a-f0-9]{64}$/.test(token);
  for (const element of document.querySelectorAll("button,input,select"))
    element.disabled = busy || !auth;
  $("disconnect").disabled = busy || !auth;
  $("submit-button").disabled = busy || !auth || !op?.acknowledged;
  $("recover").disabled = busy || !auth || !op?.acknowledged;
}
function clearDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
  $("download").replaceChildren();
}
function save(file) {
  clearDownload();
  const bytes = Uint8Array.from(atob(file.base64), (x) => x.charCodeAt(0));
  downloadUrl = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = file.name;
  anchor.textContent = "Save " + file.name;
  $("download").append(anchor);
}

async function call(input) {
  const response = await fetch("/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: canonical(input),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  state = result.state;
  if (result.focus) {
    $("actor").value = result.focus.actor;
    render();
    $("operation").value = result.focus.digest;
  }
  if (result.download) save(result.download);
  message(
    result.message || "Local lab ready. Start with a test artwork and Alice.",
  );
}
async function run(work) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  render();
  message("Working locally…");
  try {
    await work();
  } catch (error) {
    message(
      error.message ||
        "Connection interrupted. Keep recovery and retry the original request.",
      true,
    );
  } finally {
    for (const field of document.querySelectorAll('input[type="password"]'))
      field.value = "";
    busy = false;
    document.body.classList.remove("busy");
    render();
  }
}
function file(id, limit) {
  const f = $(id).files[0];
  if (!f || f.size > limit)
    throw new Error("Select a file within the lab size limit.");
  return f;
}
async function textFile(id) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    await file(id, 2101248).arrayBuffer(),
  );
}
async function pngFile(id) {
  const bytes = new Uint8Array(await file(id, 69644).arrayBuffer());
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
const actor = () => $("actor").value;
const digest = () => $("operation").value;
const credential = () => $("credential").value;
function form(id, work) {
  $(id).addEventListener("submit", (event) => {
    event.preventDefault();
    void run(work);
  });
}
form("mint", () =>
  call({ action: "mint", actor: actor(), fixture: Number($("fixture").value) }),
);
form("claim", async () =>
  call({ action: "claim", actor: actor(), file: await pngFile("claim-file") }),
);
form("backup", () =>
  call({
    action: "backup",
    actor: actor(),
    digest: digest(),
    password: $("backup-password").value,
  }),
);
form("acknowledge", async () =>
  call({
    action: "acknowledge",
    actor: actor(),
    digest: digest(),
    backup: $("backup-id").value,
    file: await textFile("recovery-file"),
    password: $("recovery-password").value,
  }),
);
form("submit", () =>
  call({
    action: "submit",
    actor: actor(),
    digest: digest(),
    loseResponse: $("lose-response").checked,
  }),
);
$("recover").onclick = () =>
  run(() => call({ action: "recover", actor: actor(), digest: digest() }));
for (const id of ["export", "public"])
  $(id).onclick = () =>
    run(() =>
      call({
        action: "export",
        actor: actor(),
        credential: credential(),
        public: id === "public",
      }),
    );
$("cancel").onclick = () =>
  run(() =>
    call({ action: "cancel", actor: actor(), credential: credential() }),
  );
form("save-bearer", () =>
  call({
    action: "saveBearer",
    actor: actor(),
    credential: credential(),
    password: $("bearer-password").value,
  }),
);
form("restore", async () => {
  await call({
    action: "restore",
    backup: $("restore-id").value,
    file: await textFile("restore-file"),
    password: $("restore-password").value,
  });
  $("actor").value = "restored";
});
form("claim-vault", async () =>
  call({
    action: "claimVault",
    actor: actor(),
    backup: $("bearer-id").value,
    file: await textFile("bearer-file"),
    password: $("claim-password").value,
  }),
);
$("actor").onchange = render;
$("operation").onchange = render;
$("disconnect").onclick = () => {
  token = "";
  $("vault-link").href = "/vault/";
  clearDownload();
  state = null;
  for (const el of document.querySelectorAll("button,input,select"))
    el.disabled = true;
  for (const el of document.querySelectorAll("input")) el.value = "";
  for (const id of [
    "operation",
    "backup-id",
    "restore-id",
    "credential",
    "bearer-id",
    "artwork",
  ])
    $(id).replaceChildren();
  message(
    "Console disconnected. The local process and plaintext stores still exist until stopped. Open its launch link in a new tab to reconnect.",
  );
};
if (/^[a-f0-9]{64}$/.test(token)) void run(() => call({ action: "state" }));
else {
  for (const el of document.querySelectorAll("button,input,select"))
    el.disabled = true;
  message(
    "Open the complete launch link printed by pnpm browser:local. A reload requires that link again.",
    true,
  );
}
