const byId = (id) => document.getElementById(id),
  buttons = ["create", "spend"].map(byId),
  cancel = byId("cancel"),
  status = byId("status"),
  results = byId("results");
let fixture,
  active = null;
const history = [];
function settle(message) {
  if (active) {
    clearTimeout(active.timer);
    active.worker.terminate();
    active = null;
  }
  status.textContent = message;
  buttons.forEach((b) => (b.disabled = !fixture));
  cancel.disabled = true;
}
async function run(name) {
  if (active || !fixture) return;
  const id = crypto.randomUUID(),
    worker = new Worker("/prover-worker.js");
  buttons.forEach((b) => (b.disabled = true));
  cancel.disabled = false;
  status.textContent = "Verifying and loading artifacts…";
  active = {
    id,
    worker,
    timer: setTimeout(
      () => settle("Proof timed out. The worker was terminated."),
      60000,
    ),
  };
  worker.onerror = () => settle("The proof worker failed. You can retry.");
  worker.onmessage = ({ data }) => {
    if (active?.id !== id || data.id !== id) return;
    if (data.status === "proving") {
      status.textContent = "Proving locally…";
      return;
    }
    if (data.status === "complete") {
      history.push({
        circuit: name,
        milliseconds: Math.round(data.milliseconds),
        publicInputs: data.publicSignals.length,
        verified: true,
      });
      results.textContent = JSON.stringify(history, null, 2);
      settle("Proof generated and verified locally.");
    } else settle("Proof or artifact validation failed.");
  };
  worker.postMessage({
    id,
    name,
    input: fixture.fixtures[name],
    artifacts: {
      library: fixture.artifacts.library,
      wasm: fixture.artifacts[name + "-wasm"],
      key: fixture.artifacts[name + "-key"],
      verificationKey: fixture.artifacts[name + "-verificationKey"],
    },
  });
}
buttons.forEach((button) => {
  button.disabled = true;
  button.onclick = () => run(button.id);
});
cancel.onclick = () => settle("Cancelled. The worker was terminated.");
try {
  const response = await fetch("/fixture.json", { cache: "no-store" });
  if (!response.ok) throw Error();
  fixture = await response.json();
  if (fixture.format !== "zft-shielded-public-browser-fixture-v1")
    throw Error();
  settle("Ready. All test authority is public and disposable.");
} catch {
  fixture = null;
  settle("Test configuration unavailable.");
}
addEventListener("pagehide", () => {
  if (active) active.worker.terminate();
});
