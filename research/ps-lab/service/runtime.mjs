// Explicit initialization/opening of the separate service candidate; no listener or default provider.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import * as p from "../local/profile.mjs";
import { stateManifest } from "../local/state.mjs";
import { PsKeyFile, KEY_FILE } from "../local/key-file.mjs";
import { StatusSigner } from "../local/status-signer.mjs";
import {
  initializeServiceStore,
  openServiceStore,
  transaction,
} from "./store.mjs";
import { ServiceIssuer } from "./issuer.mjs";
import { ServiceStatus } from "./status.mjs";
import {
  privateDirectory,
  sameDirectory,
  publish,
  readPrivate,
  ServiceLock,
} from "./files.mjs";
export const READY = "service-ready.json",
  DATABASE = "service.db";
export function validatePins(value) {
  p.fields(
    value,
    "format manifest configuration_id wrapping_key_id key_sha256 status_manifest status_key_id",
  );
  assert.equal(value.format, "zft-ps-service-ready-v1");
  p.trust(value.manifest);
  p.bytes(value.configuration_id, 32);
  p.bytes(value.key_sha256, 32);
  for (const k of ["wrapping_key_id", "status_key_id"])
    assert(
      typeof value[k] === "string" &&
        /^[A-Za-z0-9:/._-]{1,2048}$/.test(value[k]),
    );
  assert.equal(
    p.canonical(value.status_manifest),
    p.canonical(
      stateManifest(value.manifest, value.status_manifest.public_key),
    ),
  );
  return value;
}
export function readPins(dir, digest) {
  privateDirectory(dir);
  p.bytes(digest, 32);
  const bytes = readPrivate(join(dir, READY), 16384);
  assert.equal(p.hash(bytes), digest, "selected ready digest");
  return validatePins(p.parse(bytes.toString(), 16384));
}
export async function initializeService(dir, secrets, config, { signal } = {}) {
  const selected = privateDirectory(dir);
  assert.equal(
    fs.readdirSync(dir).length,
    0,
    "empty private directory required",
  );
  const lock = new ServiceLock(dir);
  let file;
  try {
    const check = new StatusSigner({
      psManifest: config.manifest,
      ...config.status,
    });
    check.close();
    file = new PsKeyFile(dir, config);
    const key = await file.create(secrets, { signal });
    sameDirectory(selected);
    initializeServiceStore(
      join(dir, DATABASE),
      config.manifest,
      config.configurationId,
    );
    const pins = validatePins({
      format: "zft-ps-service-ready-v1",
      manifest: p.trust(config.manifest).manifest,
      configuration_id: config.configurationId,
      wrapping_key_id: config.keyId,
      key_sha256: key.sha256,
      status_manifest: config.status.manifest,
      status_key_id: config.status.keyId,
    });
    return publish(dir, READY, p.utf8(p.canonical(pins)));
  } finally {
    file?.close();
    lock.close();
  }
}
/** Drivers must be supplied explicitly. Initialization and serving never synthesize identities. */
export async function openService(
  dir,
  readyDigest,
  { loadCustody, statusTransport, now, timeoutMs = 5000 } = {},
) {
  assert.equal(typeof loadCustody, "function");
  assert.equal(typeof statusTransport, "function");
  const selected = privateDirectory(dir),
    lock = new ServiceLock(dir);
  let custody, issuer, status;
  try {
    const pins = readPins(dir, readyDigest);
    assert.equal(
      p.hash(readPrivate(join(dir, KEY_FILE), 16384)),
      pins.key_sha256,
      "selected key file",
    );
    custody = await loadCustody(
      Object.freeze({ directory: dir, keySha256: pins.key_sha256, pins }),
    );
    sameDirectory(selected);
    assert.equal(p.canonical(readPins(dir, readyDigest)), p.canonical(pins));
    assert.equal(typeof custody?.transport, "function");
    assert.equal(typeof custody.close, "function");
    issuer = new ServiceIssuer(join(dir, DATABASE), {
      manifest: pins.manifest,
      configurationId: pins.configuration_id,
      transport: custody.transport,
      timeoutMs,
      now,
    });
    status = new ServiceStatus(issuer, {
      manifest: pins.status_manifest,
      keyId: pins.status_key_id,
      transport: statusTransport,
      timeoutMs,
      now,
    });
    let closed = false;
    return Object.freeze({
      pins,
      issuer,
      status,
      close() {
        if (closed) return;
        closed = true;
        try {
          status.close();
          issuer.close();
          custody.close();
        } finally {
          lock.close();
        }
      },
    });
  } catch (e) {
    try {
      status?.close();
      issuer?.close();
      custody?.close();
    } finally {
      lock.close();
    }
    throw e;
  }
}
/** Offline, explicit evidence acknowledgement. It records an operator assertion, not a freshness proof. */
export function acknowledgeRestore(
  dir,
  readyDigest,
  { backupSha256, minimumSequence, fencingEvidence },
) {
  p.bytes(backupSha256, 32);
  assert(Number.isSafeInteger(minimumSequence) && minimumSequence >= 0);
  assert(
    typeof fencingEvidence === "string" &&
      fencingEvidence.length >= 1 &&
      fencingEvidence.length <= 2048,
    "external fencing evidence reference",
  );
  const lock = new ServiceLock(dir);
  let db;
  try {
    const pins = readPins(dir, readyDigest);
    db = openServiceStore(
      join(dir, DATABASE),
      pins.manifest,
      pins.configuration_id,
    );
    transaction(db, () => {
      const r = db
        .prepare("SELECT backup_sha256,sequence FROM restore_review WHERE id=1")
        .get();
      assert(
        r && r.backup_sha256 === backupSha256 && r.sequence >= minimumSequence,
        "selected restore checkpoint",
      );
      db.prepare("UPDATE restore_review SET evidence=? WHERE id=1").run(
        fencingEvidence,
      );
      db.prepare(
        "UPDATE policy SET restore_required=0,enabled=0,generation=generation+1 WHERE id=1",
      ).run();
    });
  } finally {
    db?.close();
    lock.close();
  }
}
