// Offline comparison of explicitly selected disposable browser exports.
// Reads user-held files locally; never sends witnesses/passwords to an RPC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import {
  canonical,
  createProfile,
  digest,
  exact,
  parseCanonical,
} from "../shielded-lab/core.mjs";
import { importBearer } from "../shielded-lab/file-adapter.mjs";
import { pinDeployment } from "../shielded-lab/chain.mjs";
import { validateOperation, unbase64 } from "../shielded-lab/recovery.mjs";
import { parseConfiguration } from "../../packages/shielded/config.mjs";

async function main() {
  const paths = process.argv.slice(2);
  assert.ok(paths.length === 7, "Expected seven explicitly selected files");
  const [
    configBytes,
    createBytes,
    claimBytes,
    oldBytes,
    newBytes,
    publicBytes,
    passwordBytes,
  ] = paths.map((p) => readFileSync(p));
  const config = parseConfiguration(
      configBytes.toString("utf8"),
      "http://127.0.0.1",
    ),
    deployment = pinDeployment(config.pins),
    profile = await createProfile();
  function decrypt(bytes) {
    const wrapped = parseCanonical(bytes.toString("utf8"), 21 * 1024 * 1024),
      { ciphertext, ...header } = wrapped;
    exact(wrapped, ["format", "kdf", "iterations", "salt", "iv", "ciphertext"]);
    const salt = unbase64(header.salt, 16),
      iv = unbase64(header.iv, 12);
    assert.ok(
      salt.length === 16 && iv.length === 12,
      "Unexpected recovery nonce sizes",
    );
    assert.ok(
      header.format === "zft-shielded-recovery-aes256gcm-v1" &&
        header.kdf === "PBKDF2-SHA256" &&
        header.iterations === 600000,
      "Unexpected recovery header",
    );
    const key = pbkdf2Sync(
        passwordBytes,
        salt,
        header.iterations,
        32,
        "sha256",
      ),
      encrypted = unbase64(ciphertext, 15 * 1024 * 1024 + 16);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(canonical(header)));
      decipher.setAuthTag(encrypted.subarray(-16));
      const plaintext = Buffer.concat([
        decipher.update(encrypted.subarray(0, -16)),
        decipher.final(),
      ]);
      try {
        return validateOperation(
          profile,
          parseCanonical(
            new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
            15 * 1024 * 1024,
          ),
          deployment,
        ).record;
      } finally {
        plaintext.fill(0);
      }
    } finally {
      key.fill(0);
    }
  }
  try {
    const creation = decrypt(createBytes),
      claim = decrypt(claimBytes),
      old = await importBearer(profile, oldBytes, deployment),
      next = await importBearer(profile, newBytes, deployment);
    assert.ok(
      creation.kind === "create" && claim.kind === "spend",
      "Wrong operation kinds",
    );
    assert.ok(
      canonical(creation.pins) === canonical(config.pins) &&
        canonical(claim.pins) === canonical(config.pins),
      "Recovery pin mismatch",
    );
    assert.ok(
      canonical(creation.destination) === canonical(old.note),
      "Creation export changed destination",
    );
    assert.ok(
      canonical(claim.source) === canonical(old.note),
      "Claim source differs from saved bearer",
    );
    assert.ok(
      canonical(claim.destination) === canonical(next.note),
      "Claim export changed destination",
    );
    assert.ok(
      old.note.secret !== next.note.secret &&
        old.note.randomness !== next.note.randomness &&
        old.note.commitment !== next.note.commitment,
      "Fresh authority was not generated",
    );
    assert.ok(
      old.note.assetId === next.note.assetId &&
        canonical(old.note.metadata) === canonical(next.note.metadata),
      "Asset or metadata changed",
    );
    assert.ok(
      Buffer.from(old.image).equals(publicBytes) &&
        Buffer.from(next.image).equals(publicBytes),
      "Public export contains more than canonical artwork",
    );
    console.log(
      JSON.stringify(
        {
          format: "zft-shielded-browser-export-check-v1",
          recoveryDecryption:
            "Node PBKDF2 and AES-GCM APIs, followed by unchanged operation validation",
          creationMatchesOriginalBearer: true,
          claimSourceMatchesOriginalBearer: true,
          claimDestinationMatchesSuccessorBearer: true,
          freshSecretAndRandomness: true,
          assetAndMetadataPreserved: true,
          publicImageExact: true,
          imageSha256: digest(publicBytes),
          scope:
            "Offline equality and authentication for selected exports; no chain freshness, browser execution, independent review or memory-erasure claim",
          fileSha256: {
            configuration: digest(configBytes),
            creationRecovery: digest(createBytes),
            claimRecovery: digest(claimBytes),
            originalBearer: digest(oldBytes),
            successorBearer: digest(newBytes),
            publicImage: digest(publicBytes),
          },
        },
        null,
        2,
      ),
    );
  } finally {
    passwordBytes.fill(0);
  }
}
main().catch(() => {
  // Never print assertion operands, decrypted notes, passwords or filenames.
  console.error("Browser export verification failed");
  process.exitCode = 1;
});
