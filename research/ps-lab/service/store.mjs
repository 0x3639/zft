// Separate service schema: encrypted session scalars, public protocol data and exact responses.
import assert from "node:assert/strict";
import {
  constants,
  openSync,
  closeSync,
  lstatSync,
  realpathSync,
  fsyncSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as p from "../local/profile.mjs";
import { transaction } from "../local/store.mjs";
export { transaction };
export const SERVICE_STORE = "zft-ps-service-store-v1";
const schema = `
CREATE TABLE identity(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
CREATE TABLE policy(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),generation INTEGER NOT NULL,restore_required INTEGER NOT NULL CHECK(restore_required IN (0,1)));
INSERT INTO policy VALUES(1,0,0,0);
CREATE TABLE restore_review(id INTEGER PRIMARY KEY CHECK(id=1),backup_sha256 TEXT NOT NULL,sequence INTEGER NOT NULL,evidence TEXT);
CREATE TABLE sessions(id TEXT PRIMARY KEY,wire TEXT NOT NULL,protected TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE operations(seq INTEGER PRIMARY KEY AUTOINCREMENT,digest TEXT UNIQUE NOT NULL,session TEXT UNIQUE NOT NULL REFERENCES sessions(id),recovery_hash TEXT NOT NULL,response TEXT NOT NULL);
CREATE TABLE assets(tag TEXT PRIMARY KEY,digest TEXT UNIQUE NOT NULL);
CREATE TABLE spent(keyset TEXT NOT NULL,nullifier TEXT NOT NULL,digest TEXT UNIQUE NOT NULL,PRIMARY KEY(keyset,nullifier));
CREATE TABLE grants(hash TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN ('participant','operator','monitor')),expires INTEGER NOT NULL,revoked INTEGER NOT NULL CHECK(revoked IN (0,1)));
CREATE TABLE observations(request_hash TEXT PRIMARY KEY,challenge TEXT UNIQUE NOT NULL,body TEXT NOT NULL,receipt TEXT);
`;
function location(path) {
  const file = resolve(path),
    dir = dirname(file),
    s = lstatSync(dir);
  assert(
    s.isDirectory() &&
      !s.isSymbolicLink() &&
      s.uid === process.getuid() &&
      (s.mode & 0o077) === 0 &&
      realpathSync(dir) === dir,
    "private canonical parent required",
  );
  return file;
}
function connect(path) {
  const s = lstatSync(path);
  assert(
    s.isFile() &&
      !s.isSymbolicLink() &&
      s.uid === process.getuid() &&
      (s.mode & 0o077) === 0 &&
      s.size <= 16 * 1024 * 1024,
    "private existing bounded database required",
  );
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
    );
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    const size = db.prepare("PRAGMA page_size").get().page_size;
    db.exec("PRAGMA max_page_count=" + Math.floor((16 * 1024 * 1024) / size));
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
function identity(manifest, configurationId) {
  p.bytes(configurationId, 32);
  return p.canonical({
    format: SERVICE_STORE,
    manifest: p.trust(manifest).manifest,
    configuration_id: configurationId,
  });
}
/** Explicit creation only; a failed or existing file is never adopted as new state. */
export function initializeServiceStore(path, manifest, configurationId) {
  const file = location(path),
    value = identity(manifest, configurationId);
  closeSync(
    openSync(
      file,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    ),
  );
  const db = connect(file);
  try {
    transaction(db, () => {
      db.exec(schema);
      db.prepare("INSERT INTO identity VALUES(1,?)").run(value);
    });
  } finally {
    db.close();
  }
  // Persist the new database name after SQLite has synchronized its committed schema.
  const fd = openSync(
    dirname(file),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/** Existing state only; opening a missing/partial/foreign database fails without schema repair. */
export function openServiceStore(path, manifest, configurationId) {
  const file = location(path),
    value = identity(manifest, configurationId),
    db = connect(file);
  try {
    assert.equal(
      db.prepare("SELECT value FROM identity WHERE id=1").get()?.value,
      value,
      "store identity mismatch",
    );
    for (const table of [
      "policy",
      "sessions",
      "operations",
      "assets",
      "spent",
      "observations",
      "restore_review",
      "grants",
    ])
      db.prepare("SELECT 1 FROM " + table + " LIMIT 1").all();
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
