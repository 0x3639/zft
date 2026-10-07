// Dedicated plaintext local lab stores. Never open application or production data.
import assert from "node:assert/strict";
import { closeSync, lstatSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { canonical } from "./profile.mjs";
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* SQLite may already have rolled back. */
    }
    throw error;
  }
}
export function store(path, pinned, role) {
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const info = lstatSync(path);
  assert(
    info.isFile() && (info.mode & 0o077) === 0,
    "private regular lab database required",
  );
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
    );
    transaction(db, () => {
      db.exec(
        "CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);",
      );
      const identity = canonical({ role, manifest: pinned.manifest });
      db.prepare("INSERT OR IGNORE INTO identity VALUES (1,?)").run(identity);
      assert.equal(
        db.prepare("SELECT value FROM identity WHERE id=1").get().value,
        identity,
        "database identity mismatch",
      );
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
