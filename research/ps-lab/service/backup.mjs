// Stopped, bounded, encrypted whole-state archives. Caller-selected digests do not establish freshness.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import * as p from "../local/profile.mjs";
import { KEY_FILE, PsKeyFile } from "../local/key-file.mjs";
import { ProtectedRecord, RECORD_LIMITS } from "./protected-record.mjs";
import { wipe } from "./boundary.mjs";
import { readPins, READY, DATABASE, validatePins } from "./runtime.mjs";
import { openServiceStore, transaction } from "./store.mjs";
import {
  ServiceLock,
  privateDirectory,
  sameDirectory,
  readPrivate,
  publish,
} from "./files.mjs";
const FORMAT = "zft-ps-service-backup-v1";
const sequence = (db) =>
  db.prepare("SELECT coalesce(max(seq),0) AS n FROM operations").get().n;
function recordConfig(pins, transport, recordId) {
  return {
    manifest: pins.manifest,
    configurationId: pins.configuration_id,
    keyId: pins.wrapping_key_id,
    transport,
    purpose: "backup",
    recordId,
  };
}
/** Source must be stopped; archive output uses create-only publication in a private directory. */
export async function backupService(
  dir,
  readyDigest,
  outputDirectory,
  { transport, signal, boundary = () => {} } = {},
) {
  const selected = privateDirectory(dir),
    lock = new ServiceLock(dir);
  let db, record, plain;
  try {
    const pins = readPins(dir, readyDigest);
    db = openServiceStore(
      join(dir, DATABASE),
      pins.manifest,
      pins.configuration_id,
    );
    const seq = sequence(db);
    db.close();
    db = undefined;
    // Do not package a remaining journal or sidecar whose absence would alter recovery.
    for (const suffix of ["-journal", "-wal", "-shm"])
      assert(
        !fs.existsSync(join(dir, DATABASE + suffix)),
        "database sidecar remains",
      );
    const key = readPrivate(join(dir, KEY_FILE), 16384);
    assert.equal(p.hash(key), pins.key_sha256);
    plain = p.utf8(
      p.canonical({
        format: FORMAT,
        ready: p.canonical(pins),
        database: readPrivate(join(dir, DATABASE), 16 * 1024 * 1024).toString(
          "hex",
        ),
        keys: key.toString("hex"),
        sequence: seq,
      }),
    );
    const recordId = p.hash(plain);
    record = new ProtectedRecord(recordConfig(pins, transport, recordId));
    const wire = await record.seal(plain, { signal });
    const checked = await record.open(wire, { signal });
    try {
      assert.equal(p.hash(checked), recordId, "archive roundtrip");
    } finally {
      wipe(checked);
    }
    sameDirectory(selected);
    boundary("before-backup-publication");
    const result = publish(
      outputDirectory,
      "service-backup.enc.json",
      p.utf8(wire),
      boundary,
    );
    return Object.freeze({ ...result, recordId, readyDigest, sequence: seq });
  } finally {
    wipe(plain);
    record?.close();
    db?.close();
    lock.close();
  }
}
/** New empty destination only. A ready marker is published last; failed directories are never adopted. */
export async function restoreService(
  archivePath,
  destination,
  selection,
  { transport, signal, boundary = () => {} } = {},
) {
  p.fields(selection, "sha256 recordId readyDigest sequence");
  for (const k of ["sha256", "recordId", "readyDigest"])
    p.bytes(selection[k], 32);
  assert(Number.isSafeInteger(selection.sequence) && selection.sequence >= 0);
  const selected = privateDirectory(destination);
  assert.equal(
    fs.readdirSync(destination).length,
    0,
    "empty restore directory",
  );
  const bytes = readPrivate(archivePath, 2 * RECORD_LIMITS.backup + 16384);
  assert.equal(p.hash(bytes), selection.sha256, "selected backup digest");
  // Public scope is parsed only to construct the envelope verifier; authenticated inner pins must match selected ready hash.
  const wire = bytes.toString(),
    outer = p.parse(wire, 2 * RECORD_LIMITS.backup + 16384);
  const scope = outer.scope;
  const record = new ProtectedRecord({
    manifest: scope.manifest,
    configurationId: scope.configuration_id,
    keyId: scope.wrapping_key_id,
    purpose: "backup",
    recordId: selection.recordId,
    transport,
  });
  const lock = new ServiceLock(destination);
  let plain, db, keyFile;
  try {
    plain = await record.open(wire, { signal });
    assert.equal(
      p.hash(plain),
      selection.recordId,
      "selected plaintext digest",
    );
    const body = p.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plain),
      RECORD_LIMITS.backup,
    );
    p.fields(body, "format ready database keys sequence");
    assert.equal(body.format, FORMAT);
    assert.equal(body.sequence, selection.sequence, "selected sequence");
    assert.equal(
      p.hash(body.ready),
      selection.readyDigest,
      "selected ready digest",
    );
    const pins = validatePins(p.parse(body.ready, 16384));
    assert.equal(scope.configuration_id, pins.configuration_id);
    assert.equal(scope.wrapping_key_id, pins.wrapping_key_id);
    assert.equal(p.canonical(scope.manifest), p.canonical(pins.manifest));
    const key = p.bytes(body.keys),
      database = p.bytes(body.database);
    assert(key.length <= 16384 && database.length <= 16 * 1024 * 1024);
    assert.equal(p.hash(key), pins.key_sha256);
    sameDirectory(selected);
    publish(destination, KEY_FILE, key);
    publish(destination, DATABASE, database);
    keyFile = new PsKeyFile(destination, {
      manifest: pins.manifest,
      configurationId: pins.configuration_id,
      keyId: pins.wrapping_key_id,
      transport,
    });
    // Unwrap denial leaves an incomplete destination without a ready marker.
    await keyFile.open(pins.key_sha256, { signal });
    sameDirectory(selected);
    db = openServiceStore(
      join(destination, DATABASE),
      pins.manifest,
      pins.configuration_id,
    );
    assert.equal(sequence(db), body.sequence, "archive sequence mismatch");
    transaction(db, () => {
      db.prepare(
        "UPDATE policy SET enabled=0,restore_required=1,generation=generation+1 WHERE id=1",
      ).run();
      db.prepare(
        "INSERT OR REPLACE INTO restore_review VALUES(1,?,?,NULL)",
      ).run(selection.sha256, body.sequence);
      db.prepare("DELETE FROM grants").run();
    });
    db.close();
    db = undefined;
    boundary("before-restore-ready");
    publish(destination, READY, p.utf8(body.ready), boundary);
    return Object.freeze({
      readyDigest: selection.readyDigest,
      sequence: body.sequence,
      restoreReviewRequired: true,
    });
  } finally {
    db?.close();
    keyFile?.close();
    wipe(plain);
    record.close();
    lock.close();
  }
}
