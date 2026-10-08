// Public test password and PS fixture keys. Disposable offline research only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Issuer } from "./issuer.mjs";
import { Client } from "./client.mjs";
import * as p from "./profile.mjs";
import {
  LocalVault,
  writeVaultFile,
  readVaultFile,
  acknowledgeRecoveryFile,
  restoreRecoveryFile,
} from "./vault.mjs";
import {
  exportImage,
  publicImage,
  prepareImageIssue,
  prepareImageClaim,
} from "./image.mjs";
const v = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url))),
  secrets = Object.fromEntries(
    ["x", "yh", "ys"].map((k) => [k, v.test_secrets[k]]),
  );
const image = Buffer.from(
  JSON.parse(readFileSync(new URL("./image-fixtures.json", import.meta.url)))
    .images[0].pngHex,
  "hex",
);
const password = "public demonstration password only",
  dir = mkdtempSync(join(tmpdir(), "PS encrypted vault ü # ")),
  opened = [];
try {
  const issuer = new Issuer(join(dir, "issuer.db"), "71".repeat(32), secrets);
  opened.push(issuer);
  const manifest = issuer.pinned.manifest,
    client = (name) => {
      const c = new Client(join(dir, name + ".db"), manifest);
      opened.push(c);
      return c;
    };
  const alice = client("alice"),
    bob = client("bob"),
    restored = client("restored"),
    vault = new LocalVault(manifest);
  const mint = prepareImageIssue(alice, issuer.session("issue"), image);
  vault.add("recovery", alice.backup(mint));
  const initial = join(dir, "mint.vault");
  writeVaultFile(initial, vault, password);
  acknowledgeRecoveryFile(alice, mint, initial, password, vault.id);
  const id = alice.submit(mint, issuer),
    file = exportImage(alice.export(id), manifest),
    claim = prepareImageClaim(bob, issuer.session("swap"), file);
  const recoveryId = vault.add("recovery", bob.backup(claim)),
    backup = join(dir, "claim.vault");
  writeVaultFile(backup, vault, password);
  acknowledgeRecoveryFile(bob, claim, backup, password, vault.id);
  const pending = p.parse(bob.backup(claim), 300000);
  issuer.submit(pending.wire, pending.capability); // Lost return.
  const vaultId = vault.id;
  vault.lock();
  assert(vault.locked);
  restoreRecoveryFile(restored, backup, password, vaultId, recoveryId);
  const claimed = restored.recover(claim, issuer);
  const next = LocalVault.open(
      readVaultFile(backup),
      password,
      manifest,
      vaultId,
    ),
    bearerId = next.add("bearer", restored.export(claimed));
  const completed = join(dir, "completed.vault");
  writeVaultFile(completed, next, password);
  next.lock();
  const recovered = LocalVault.open(
    readVaultFile(completed),
    password,
    manifest,
    vaultId,
  );
  const clean = publicImage(
    exportImage(recovered.read(bearerId).wire, manifest),
    manifest,
  );
  assert.deepEqual(clean, image);
  recovered.lock();
  const stale = prepareImageClaim(alice, issuer.session("swap"), file);
  alice.acknowledge(stale, p.hash(alice.backup(stale)));
  assert.throws(() => alice.submit(stale, issuer), /already spent/);
  console.log(
    JSON.stringify(
      {
        scope:
          "offline research; public test keys/password; working SQLite stores remain plaintext",
        encryptedReadbackBeforeAcknowledgment: true,
        lockedAccessBlocked: true,
        lostResponseRecovered: true,
        exactPublicImage: true,
        staleFileRejected: true,
        operations: issuer.counts().operations,
      },
      null,
      2,
    ),
  );
} finally {
  for (const c of opened) c.close();
  rmSync(dir, { recursive: true, force: true });
}
