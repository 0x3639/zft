// Stopped copy-to-new-directory wrapping-key rotation for this candidate only. Never migrates legacy stores.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import * as p from "../local/profile.mjs";
import { PsKeyFile, KEY_FILE } from "../local/key-file.mjs";
import { ProtectedRecord } from "./protected-record.mjs";
import { wipe } from "./boundary.mjs";
import {
  ServiceLock,
  privateDirectory,
  sameDirectory,
  readPrivate,
  publish,
} from "./files.mjs";
import { readPins, READY, DATABASE } from "./runtime.mjs";
import { openServiceStore, transaction } from "./store.mjs";
/** Preserve PS/status identity and exact history, rewrap every secret, and require explicit fencing review. */
export async function rotateWrappingKey(
  source,
  readyDigest,
  destination,
  { oldTransport, newTransport, newKeyId, signal } = {},
) {
  const sourceDir = privateDirectory(source),
    targetDir = privateDirectory(destination);
  assert.equal(
    fs.readdirSync(destination).length,
    0,
    "empty rotation destination",
  );
  const sourceLock = new ServiceLock(source);
  let targetLock, oldFile, newFile, db;
  try {
    targetLock = new ServiceLock(destination);
    const pins = readPins(source, readyDigest);
    assert.notEqual(
      newKeyId,
      pins.wrapping_key_id,
      "new wrapping identity required",
    );
    const oldConfig = {
        manifest: pins.manifest,
        configurationId: pins.configuration_id,
        keyId: pins.wrapping_key_id,
        transport: oldTransport,
      },
      newConfig = { ...oldConfig, keyId: newKeyId, transport: newTransport };
    oldFile = new PsKeyFile(source, oldConfig);
    const scalars = await oldFile.open(pins.key_sha256, { signal });
    db = openServiceStore(
      join(source, DATABASE),
      pins.manifest,
      pins.configuration_id,
    );
    const sessions = db
        .prepare("SELECT id,wire,protected FROM sessions ORDER BY id")
        .all(),
      seq = db
        .prepare("SELECT coalesce(max(seq),0) AS n FROM operations")
        .get().n;
    assert(sessions.length <= 512, "bounded sessions");
    db.close();
    db = undefined;
    for (const suffix of ["-journal", "-wal", "-shm"])
      assert(
        !fs.existsSync(join(source, DATABASE + suffix)),
        "database sidecar remains",
      );
    const database = readPrivate(join(source, DATABASE), 16 * 1024 * 1024),
      checkpoint = p.hash(
        p.utf8(
          p.canonical({
            ready: readyDigest,
            database: p.hash(database),
            sequence: seq,
          }),
        ),
      );
    newFile = new PsKeyFile(destination, newConfig);
    const key = await newFile.create(scalars, { signal });
    const replacements = [];
    for (const row of sessions) {
      const recordId = p.hash(row.wire),
        oldRecord = new ProtectedRecord({
          ...oldConfig,
          purpose: "session",
          recordId,
        }),
        newRecord = new ProtectedRecord({
          ...newConfig,
          purpose: "session",
          recordId,
        });
      let secret, checked;
      try {
        secret = await oldRecord.open(row.protected, { signal });
        const wire = await newRecord.seal(secret, { signal });
        checked = await newRecord.open(wire, { signal });
        assert.equal(p.hash(secret), p.hash(checked), "rewrap roundtrip");
        replacements.push({ id: row.id, wire });
      } finally {
        wipe(secret);
        wipe(checked);
        oldRecord.close();
        newRecord.close();
      }
    }
    sameDirectory(sourceDir);
    sameDirectory(targetDir);
    assert.equal(
      p.hash(readPrivate(join(source, DATABASE), 16 * 1024 * 1024)),
      p.hash(database),
      "stopped source changed",
    );
    publish(destination, DATABASE, database);
    db = openServiceStore(
      join(destination, DATABASE),
      pins.manifest,
      pins.configuration_id,
    );
    // Scrub replaced ordinary-table cells in the destination database; not storage-media erasure.
    db.exec("PRAGMA secure_delete=ON");
    assert.equal(
      db.prepare("PRAGMA secure_delete").get().secure_delete,
      1,
      "secure deletion enabled",
    );
    transaction(db, () => {
      for (const row of replacements)
        db.prepare("UPDATE sessions SET protected=? WHERE id=?").run(
          row.wire,
          row.id,
        );
      db.prepare("DELETE FROM grants").run();
      db.prepare(
        "UPDATE policy SET enabled=0,restore_required=1,generation=generation+1 WHERE id=1",
      ).run();
      db.prepare(
        "INSERT OR REPLACE INTO restore_review VALUES(1,?,?,NULL)",
      ).run(checkpoint, seq);
    });
    // Rebuild the live destination file to discard source freelist/cell remnants copied before secure_delete was enabled.
    db.exec("VACUUM");
    db.close();
    db = undefined;
    const ready = publish(
      destination,
      READY,
      p.utf8(
        p.canonical({
          ...pins,
          wrapping_key_id: newKeyId,
          key_sha256: key.sha256,
        }),
      ),
    );
    return Object.freeze({
      readyDigest: ready.sha256,
      checkpoint,
      sequence: seq,
      restoreReviewRequired: true,
    });
  } finally {
    db?.close();
    oldFile?.close();
    newFile?.close();
    try {
      targetLock?.close();
    } finally {
      sourceLock.close();
    }
  }
}
