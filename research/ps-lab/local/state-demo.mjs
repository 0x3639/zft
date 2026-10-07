// Ephemeral local walkthrough. PS issuer keys are public fixtures; no real assets.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Issuer } from "./issuer.mjs";
import { Client } from "./client.mjs";
import {
  StateIssuer,
  StateObserver,
  stateManifest,
  showingChallenge,
} from "./state.mjs";
import * as p from "./profile.mjs";
const vectors = JSON.parse(
  readFileSync(new URL("../vectors.json", import.meta.url), "utf8"),
);
const secrets = Object.fromEntries(
  ["x", "yh", "ys"].map((k) => [k, vectors.test_secrets[k]]),
);
const dir = mkdtempSync(join(tmpdir(), "zft state demo # ")),
  opened = [];
try {
  const issuer = new Issuer(join(dir, "issuer.db"), "71".repeat(32), secrets);
  opened.push(issuer);
  const client = new Client(join(dir, "client.db"), issuer.pinned.manifest);
  opened.push(client);
  const asset = p.utf8("local signed state research"),
    wallet = "42".repeat(20),
    audience = "28".repeat(32);
  const issuance = client.prepareIssue(issuer.session("issue"), asset);
  client.acknowledge(issuance, p.hash(client.backup(issuance)));
  const id = client.submit(issuance, issuer),
    original = client.export(id);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("hex");
  const manifest = stateManifest(issuer.pinned.manifest, raw),
    signer = new StateIssuer(issuer, manifest, privateKey);
  const observer = new StateObserver(
    join(dir, "observer.db"),
    issuer.pinned.manifest,
    manifest,
  );
  opened.push(observer);
  const credential = p.importBearer(original, client.pinned).credential;
  const observe = () => {
    const c = observer.prepare(wallet, credential.h, audience);
    const show = p.showing(
      credential,
      wallet,
      showingChallenge(c),
      client.pinned,
    );
    const wire = observer.request(c.challenge, show),
      receipt = signer.observe(wire);
    const result = observer.accept(c.challenge, receipt);
    assert.throws(() => observer.accept(c.challenge, receipt), /consumed/);
    return result;
  };
  const before = observe();
  const cancel = client.prepareCancel(issuer.session("swap"), id);
  client.acknowledge(cancel, p.hash(client.backup(cancel)));
  client.submit(cancel, issuer);
  const after = observe();
  assert.equal(before.issuerReported, "unspent");
  assert.equal(after.issuerReported, "spent");
  console.log(
    JSON.stringify(
      {
        scope:
          "local public-key-fixture research; no network or wallet authentication",
        before: before.issuerReported,
        after: after.issuerReported,
        sequences: [before.sequence, after.sequence],
        replayRejected: true,
        walletAuthenticated: false,
      },
      null,
      2,
    ),
  );
} finally {
  for (const instance of opened.reverse()) instance.close();
  rmSync(dir, { recursive: true, force: true });
}
