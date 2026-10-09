// Opaque service admission grants. They authenticate access, not an Ethereum wallet or legal identity.
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import * as p from "../local/profile.mjs";
import { transaction } from "./store.mjs";
export const GRANT_LIMIT = 128;
const roles = ["participant", "operator", "monitor"];
const time = (n) => {
  assert(Number.isSafeInteger(n) && n >= 0);
  return n;
};
export function grant(db, role, ttl, now) {
  assert(roles.includes(role));
  time(now);
  assert(Number.isSafeInteger(ttl) && ttl >= 1 && ttl <= 3600);
  const token = p.randomHex(32),
    hash = p.hash(p.bytes(token, 32));
  transaction(db, () => {
    assert(
      db.prepare("SELECT count(*) AS n FROM grants").get().n < GRANT_LIMIT,
      "grant limit",
    );
    db.prepare("INSERT INTO grants VALUES(?,?,?,0)").run(hash, role, now + ttl);
  });
  return Object.freeze({ token, hash, role, expires: now + ttl });
}
export function revoke(db, hash) {
  p.bytes(hash, 32);
  const { changes } = db
    .prepare("UPDATE grants SET revoked=1 WHERE hash=?")
    .run(hash);
  assert.equal(changes, 1, "unknown grant");
}
export function authorize(db, token, role, now) {
  assert(roles.includes(role));
  time(now);
  const hash = p.hash(p.bytes(token, 32)),
    r = db
      .prepare("SELECT hash,role,expires,revoked FROM grants WHERE hash=?")
      .get(hash);
  assert(
    r &&
      timingSafeEqual(p.bytes(hash, 32), p.bytes(r.hash, 32)) &&
      r.role === role &&
      r.revoked === 0 &&
      now < r.expires,
    "admission denied",
  );
  return Object.freeze({ hash, role, expires: r.expires });
}
/** Explicitly removes only expired/revoked access grants; never recovery/receipt/spend/session history. */
export function pruneGrants(db, now, { apply = false } = {}) {
  time(now);
  assert.equal(typeof apply, "boolean");
  return transaction(db, () => {
    const n = db
      .prepare("SELECT count(*) AS n FROM grants WHERE revoked=1 OR expires<=?")
      .get(now).n;
    if (apply)
      db.prepare("DELETE FROM grants WHERE revoked=1 OR expires<=?").run(now);
    return { eligible: n, removed: apply ? n : 0 };
  });
}
