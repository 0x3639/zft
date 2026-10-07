// Test-only bounded SQLite faults; never use on application databases.
import assert from "node:assert/strict";
export function integrity(db) {
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
}
// Real SQLite SQLITE_FULL via a bounded page limit, not a full host filesystem.
// The trigger is reached at the selected write; ordinary earlier writes have room.
export function fullAt(db, target, write) {
  db.exec("CREATE TABLE fault_scratch (payload BLOB)");
  const original = db.prepare("PRAGMA max_page_count").get().max_page_count;
  const pages = db.prepare("PRAGMA page_count").get().page_count;
  const free = db.prepare("PRAGMA freelist_count").get().freelist_count;
  const size = db.prepare("PRAGMA page_size").get().page_size;
  const allocation = (pages + free + 64) * size;
  assert(allocation < 2 * 1024 * 1024, "bounded fault allocation");
  // First prove this exact statement reaches the trigger. Node 22.12 has no
  // user-defined SQLite function API for an out-of-transaction hit counter.
  db.exec(
    `CREATE TEMP TRIGGER fault_write BEFORE ${target} BEGIN SELECT RAISE(ABORT, 'fault target reached'); END`,
  );
  assert.throws(
    write,
    (error) =>
      error.code === "ERR_SQLITE_ERROR" &&
      error.message === "fault target reached",
  );
  db.exec(
    `DROP TRIGGER fault_write; CREATE TEMP TRIGGER fault_write BEFORE ${target} BEGIN INSERT INTO fault_scratch VALUES (zeroblob(${allocation})); END`,
  );
  assert.equal(
    db.prepare(`PRAGMA max_page_count=${pages + 32}`).get().max_page_count,
    pages + 32,
  );
  sqliteError(write, 13);
  return () => {
    db.exec(
      `PRAGMA max_page_count=${original}; DROP TRIGGER fault_write; DROP TABLE fault_scratch;`,
    );
    integrity(db);
  };
}
export function sqliteError(fn, code) {
  assert.throws(
    fn,
    (error) => error.code === "ERR_SQLITE_ERROR" && error.errcode === code,
  );
}
