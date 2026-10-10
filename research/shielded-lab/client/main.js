import "./style.css";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  keccak256,
  stringToHex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { foundry } from "viem/chains";
import { createProfile, canonical, digest, check, domain } from "../core.mjs";
import {
  normalizeImage,
  importBearer,
  exportBearer,
} from "../file-adapter.mjs";
import { operation, openRecovery, unbase64 } from "../recovery.mjs";
import { openVault } from "../vault.mjs";
import {
  pinDeployment,
  validatePins,
  verifyDeployment,
  verifyAsset,
  rebuildTree,
} from "../chain.mjs";
const $ = (id) => document.getElementById(id),
  status = (text) => {
    $("status").textContent = text;
  };
let p,
  config,
  pins,
  deployment,
  client,
  vault,
  record,
  image,
  proof,
  worker,
  account,
  wallet,
  busy = false,
  preview;
const exportUrls = new Map();
const creationTypes = {
  Create: [
    { name: "imageHash", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" },
    { name: "commitment", type: "uint256" },
    { name: "creator", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
const args = (a) => ({
  ...a,
  commitment: BigInt(a.commitment),
  nonce: BigInt(a.nonce),
  deadline: BigInt(a.deadline),
});
function password() {
  check(
    $("password").value.length >= 12,
    "Use a recovery password with at least 12 characters",
  );
  return $("password").value;
}
async function fileBytes(input, max) {
  const f = input.files?.[0];
  check(
    f && f.size > 0 && f.size <= max,
    "Select a file within the size limit",
  );
  return new Uint8Array(await f.arrayBuffer());
}
async function fileText(input) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await fileBytes(input, 21 * 1024 * 1024),
  );
}
function download(bytes, type, name) {
  const previous = exportUrls.get(name);
  if (previous) {
    URL.revokeObjectURL(previous.url);
    previous.link.remove();
  }
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.textContent = `Save ${name}`;
  exportUrls.set(name, { url, link: a });
  $("exports").append(a);
  status(
    "Your export is ready. Use the save link below; recovery acknowledgement still requires selecting the saved file.",
  );
}
async function refresh() {
  const rows = await vault.list(),
    row = record && rows.find((x) => x.id === record.id);
  for (const id of ["create", "claim"]) $(id).disabled = busy || !p;
  for (const id of ["save", "observe", "public"])
    $(id).disabled = busy || !record;
  $("prove").disabled =
    busy ||
    !row?.acknowledged ||
    !["prepared", "unobserved"].includes(row.state);
  $("submit").disabled =
    busy ||
    !proof ||
    !row?.acknowledged ||
    !["prepared", "unobserved"].includes(row.state);
  $("bearer").disabled = busy || !record || row?.state !== "observed";
  $("ack").disabled = busy || !record;
  $("recover").disabled = busy;
  $("inventory").replaceChildren();
  for (const r of rows) {
    const b = document.createElement("button");
    b.textContent = `${r.id.slice(2, 10)} · ${r.state}`;
    b.disabled = busy;
    b.onclick = () =>
      run(async () => {
        const opened = await vault.unlock(r.id, password(), p, deployment);
        await select(opened.record, opened.image);
        status(
          "Saved operation unlocked. Observe the chain to check its outcome.",
        );
      });
    $("inventory").append(b);
  }
  if (record)
    $("details").textContent =
      `${record.kind === "create" ? "Creation" : "Claim"} · ${row?.state ?? "prepared"}\n${record.destination.metadata.name}\nAsset ${record.destination.assetId}\nImage SHA-256 ${record.destination.imageHash}\nRecovery ${row?.acknowledged ? "reselected and verified" : "acknowledgement required"}`;
}
async function run(action) {
  if (busy) return;
  busy = true;
  await refresh();
  try {
    await action();
  } catch {
    status(
      "The operation did not complete. Your saved recovery remains available. Check the file, password and selected chain; observe before retrying a submission.",
    );
  } finally {
    busy = false;
    await refresh();
  }
}
async function feeWallet() {
  if (!wallet) {
    account = privateKeyToAccount(generatePrivateKey());
    const response = await fetch("/fund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: account.address.toLowerCase() }),
    });
    check(response.ok);
    wallet = createWalletClient({
      chain: foundry,
      transport: http(config.rpc, { retryCount: 0, timeout: 15000 }),
      account,
    });
  }
  return wallet;
}
async function select(next, bytes) {
  for (const { url } of exportUrls.values()) URL.revokeObjectURL(url);
  exportUrls.clear();
  $("exports").replaceChildren();
  record = next;
  image = bytes;
  proof = null;
  if (preview) URL.revokeObjectURL(preview);
  preview = URL.createObjectURL(new Blob([image], { type: "image/png" }));
  $("preview").src = preview;
  $("preview").hidden = false;
}
async function saveOperation(next, bytes) {
  await vault.prepare(p, next, password(), deployment);
  await select(next, bytes);
  status(
    "Fresh authority is encrypted in the journal. Download recovery and select the saved file again before proving or submitting.",
  );
}
$("create").onclick = () =>
  run(async () => {
    status("Normalizing the image and preparing a fresh note…");
    const normalized = await normalizeImage(
      await fileBytes($("picture"), 10 * 1024 * 1024),
    );
    await feeWallet();
    await verifyDeployment(client, pins);
    const metadata = {
        format: "zft-shielded-metadata-v1",
        name: $("name").value,
        description: $("description").value,
        imageHash: digest(normalized.bytes),
        canonicalizer: "zft-png/1",
        mediaType: "image/png",
        width: normalized.width,
        height: normalized.height,
        creator: account.address.toLowerCase(),
        createdAt: new Date().toISOString(),
      },
      destination = p.note(deployment, metadata);
    const authorization = {
      imageHash: destination.imageHash,
      metadataHash: destination.metadataHash,
      commitment: destination.commitment,
      creator: metadata.creator,
      nonce: String(
        await client.readContract({
          address: deployment.registry,
          abi: config.abi,
          functionName: "creatorNonces",
          args: [metadata.creator],
        }),
      ),
      deadline: String((await client.getBlock()).timestamp + 3600n),
    };
    const signature = await account.signTypedData({
        domain: {
          name: "ZFT Shielded Registry",
          version: "1",
          chainId: Number(deployment.chainId),
          verifyingContract: deployment.registry,
        },
        types: creationTypes,
        primaryType: "Create",
        message: args(authorization),
      }),
      salt =
        "0x" +
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
    await saveOperation(
      operation(p, {
        image: normalized.bytes,
        destination,
        pins,
        creation: { authorization, salt, signature },
      }),
      normalized.bytes,
    );
  });
$("claim").onclick = () =>
  run(async () => {
    status("Checking the picture, provenance and chain membership…");
    const imported = await importBearer(
      p,
      await fileBytes($("picture"), 11 * 1024 * 1024),
      deployment,
    );
    await verifyAsset(client, pins, p, imported.note);
    const { tree } = await rebuildTree(client, pins, p);
    check(tree.leaves.includes(BigInt(imported.note.commitment)));
    const spent = await client.readContract({
      address: deployment.registry,
      abi: config.abi,
      functionName: "nullifiers",
      args: [p.nullifier(imported.note)],
    });
    check(!spent);
    const destination = p.note(deployment, imported.note.metadata);
    await saveOperation(
      operation(p, {
        image: imported.image,
        source: imported.note,
        destination,
        pins,
      }),
      imported.image,
    );
  });
$("save").onclick = () =>
  run(async () =>
    download(
      await vault.export(record.id),
      "application/json",
      `zft-recovery-${record.id.slice(2, 10)}.json`,
    ),
  );
$("ack").onchange = () =>
  run(async () => {
    await vault.acknowledge(
      record.id,
      await fileText($("ack")),
      password(),
      p,
      deployment,
    );
    status("Recovery file matches. You can now generate the proof locally.");
    $("ack").value = "";
  });
function proveInWorker(name, input) {
  return new Promise((yes, no) => {
    const selected = { library: config.artifacts.library };
    for (const [kind, pin] of [
      ["wasm", "Wasm"],
      ["key", "Key"],
      ["verificationKey", "VerificationKey"],
    ]) {
      const a = config.artifacts[`${name}-${kind}`];
      check(
        a.sha256 === pins.artifacts[name + pin],
        "Artifact does not match selected deployment",
      );
      selected[kind] = a;
    }
    const id = crypto.randomUUID();
    worker = new Worker("/prover-worker.js");
    $("cancel").disabled = false;
    const finish = (err, result) => {
      clearTimeout(timer);
      worker?.terminate();
      worker = null;
      $("cancel").disabled = true;
      err ? no(err) : yes(result);
    };
    const timer = setTimeout(() => finish(Error("Proof deadline")), 60000);
    $("cancel").onclick = () => finish(Error("Proof cancelled"));
    worker.onerror = () => finish(Error("Proof worker failed"));
    worker.onmessage = ({ data }) => {
      if (data.id !== id) return;
      if (data.status === "proving") status("Generating the proof locally…");
      else if (data.status === "failed") finish(Error("Proof failed"));
      else if (data.status === "complete") finish(null, data);
    };
    worker.postMessage({ id, name, input, artifacts: selected });
  });
}
$("prove").onclick = () =>
  run(async () => {
    status("Verifying deployment and reconstructing a witness…");
    await verifyDeployment(client, pins);
    let input, name;
    if (record.kind === "create") {
      name = "create";
      input = p.creationInput(record.destination);
    } else {
      name = "spend";
      await verifyAsset(client, pins, p, record.source);
      const { tree } = await rebuildTree(client, pins, p),
        index = tree.leaves.indexOf(BigInt(record.source.commitment));
      check(index >= 0);
      input = p.spendInput(record.source, record.destination, tree.path(index));
    }
    const result = await proveInWorker(name, input),
      signals = result.publicSignals.map(BigInt);
    const expected =
      name === "create"
        ? [input.domain, input.assetHi, input.assetLo, input.commitment]
        : [input.domain, input.root, input.nullifier, input.outputCommitment];
    check(
      canonical(signals.map(String)) === canonical(expected.map(String)),
      "Proof statement mismatch",
    );
    const q = result.proof;
    proof = {
      signals,
      data: encodeAbiParameters(
        [
          { type: "uint256[2]" },
          { type: "uint256[2][2]" },
          { type: "uint256[2]" },
        ],
        [
          q.pi_a.slice(0, 2),
          q.pi_b.slice(0, 2).map((x) => [x[1], x[0]]),
          q.pi_c.slice(0, 2),
        ],
      ),
    };
    status(
      `Proof verified locally in ${(result.milliseconds / 1000).toFixed(2)} seconds. Ready for explicit submission.`,
    );
  });
$("submit").onclick = () =>
  run(async () => {
    await verifyDeployment(client, pins);
    await feeWallet();
    const savedProof = proof;
    check(savedProof);
    await vault.beginSubmission(record.id);
    status(
      "Submission journaled as uncertain. Sending the authorized transaction…",
    );
    const send = async (functionName, callArgs) => {
      const hash = await wallet.writeContract({
        address: deployment.registry,
        abi: config.abi,
        functionName,
        args: callArgs,
      });
      await vault.noteTransaction(record.id, hash);
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 20000,
      });
      check(receipt.status === "success");
    };
    if (record.kind === "create") {
      const c = record.creation,
        a = args(c.authorization),
        commitment = await client.readContract({
          address: deployment.registry,
          abi: config.abi,
          functionName: "commitmentDigest",
          args: [a, c.salt],
        });
      await send("commitCreate", [commitment]);
      check((await fetch("/mine", { method: "POST" })).ok);
      await send("create", [a, c.salt, c.signature, savedProof.data]);
    } else
      await send("spend", [
        savedProof.signals[1],
        savedProof.signals[2],
        savedProof.signals[3],
        savedProof.data,
      ]);
    proof = null;
    const outcome = await vault.observe(record.id, password(), p, client, pins);
    status(
      `Chain outcome: ${outcome.state}. This observation is not a finality guarantee.`,
    );
  });
$("observe").onclick = () =>
  run(async () => {
    const r = await vault.observe(record.id, password(), p, client, pins);
    proof = null;
    status(
      `Chain outcome: ${r.state}. Unobserved operations retain their original destination for an explicit retry.`,
    );
  });
$("bearer").onclick = () =>
  run(async () => {
    const r = await vault.observe(record.id, password(), p, client, pins);
    check(r.state === "observed");
    download(
      await exportBearer(p, image, record.destination),
      "image/png",
      `zft-bearer-${record.destination.assetId.slice(2, 10)}.png`,
    );
    status(
      "Bearer picture is ready at the save link. Anyone with this file can attempt to claim it.",
    );
  });
$("public").onclick = () =>
  run(async () =>
    download(
      image,
      "image/png",
      `zft-public-${record.destination.imageHash.slice(2, 10)}.png`,
    ),
  );
$("recover").onchange = () =>
  run(async () => {
    const opened = await openRecovery(
      await fileText($("recover")),
      password(),
      p,
      deployment,
    );
    check(canonical(opened.record.pins) === canonical(pins));
    const existing = (await vault.list()).find(
      (x) => x.id === opened.record.id,
    );
    if (!existing)
      await vault.prepare(p, opened.record, password(), deployment);
    await select(opened.record, opened.image);
    status(
      existing
        ? "Saved operation unlocked. Observe its chain outcome."
        : "Recovery restored. Download and reselect the new journal export, then observe before any retry.",
    );
    $("recover").value = "";
  });
$("pins").onclick = () =>
  download(canonical(pins), "application/json", "zft-local-deployment.json");
try {
  config = await (await fetch("/config.json", { cache: "no-store" })).json();
  pins = validatePins(config.pins);
  check(
    pins.chainId === "31337" && /^http:\/\/127\.0\.0\.1:\d+$/.test(config.rpc),
  );
  deployment = pinDeployment(pins);
  p = await createProfile();
  client = createPublicClient({
    chain: foundry,
    transport: http(config.rpc, { retryCount: 0, timeout: 15000 }),
    pollingInterval: 300,
  });
  await verifyDeployment(client, pins);
  vault = await openVault({
    name: "zft-shielded-local-" + deployment.registry,
  });
  $("connection").textContent =
    `Local chain 31337 · ${deployment.registry.slice(0, 10)}… · pins verified`;
  $("pins").disabled = false;
  await refresh();
} catch {
  $("connection").textContent =
    "Local deployment unavailable or pins did not match";
  status(
    "Start the isolated client fixture and reload. No transaction was submitted.",
  );
}
addEventListener("pagehide", () => {
  worker?.terminate();
  for (const { url } of exportUrls.values()) URL.revokeObjectURL(url);
  vault?.close();
  if (preview) URL.revokeObjectURL(preview);
});
