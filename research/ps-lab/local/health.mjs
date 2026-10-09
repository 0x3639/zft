// Read-only local monitoring. No credential material, write probes or release claims.
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  LIMITS,
  readPrivate,
  writeExclusive,
  syncDirectory,
} from "./persistent.mjs";
import * as p from "./profile.mjs";
export const HEALTH = "zft-ps-local-health-v1";
export const MONITOR = "zft-ps-local-monitor-v1";
export const MONITOR_FILE = "monitor.json";
export const HEALTH_BYTES = 8192;
const number = (value) =>
  assert(Number.isSafeInteger(value) && value >= 0, "health integer");
const COUNTS =
  "sessions activeSessions operations assets spent observationRequests publications";
const DATABASE = "pageBytes allocatedPages freePages maximumPages";
export function monitorDescriptor(value) {
  p.fields(value, "format origin instance token");
  assert.equal(value.format, MONITOR);
  assert(
    /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(value.origin),
    "loopback monitor origin",
  );
  const port = Number(value.origin.split(":").at(-1));
  assert(port >= 1024 && port <= 65535, "monitor port");
  p.bytes(value.instance, 32);
  p.bytes(value.token, 32);
  return value;
}
function warnings(value) {
  const out = [];
  if (!value.enabled) out.push("admission_suspended");
  if (value.restoreReviewRequired) out.push("restore_review_required");
  for (const [key, limit] of Object.entries({
    sessions: LIMITS.sessions,
    activeSessions: 100,
    operations: LIMITS.operations,
    observationRequests: 64,
    publications: 64,
  })) {
    if (value.counts[key] >= limit) out.push(key + "_limit");
    else if (value.counts[key] * 5 >= limit * 4) out.push(key + "_pressure");
  }
  for (const [key, db] of Object.entries(value.databases)) {
    if (db.allocatedPages >= db.maximumPages) out.push(key + "_page_limit");
    else if (db.allocatedPages * 5 >= db.maximumPages * 4)
      out.push(key + "_page_pressure");
  }
  return Object.fromEntries(out.map((name) => [name, true]));
}
export function validateHealth(value, descriptor, challenge) {
  p.fields(
    value,
    "format instance challenge sampledAt uptimeMs enabled restoreReviewRequired sequence counts databases status warnings",
  );
  assert.equal(value.format, HEALTH);
  assert.equal(value.instance, descriptor.instance, "monitor instance");
  assert.equal(value.challenge, challenge, "monitor challenge");
  for (const key of ["sampledAt", "uptimeMs", "sequence"]) number(value[key]);
  assert.equal(typeof value.enabled, "boolean");
  assert.equal(typeof value.restoreReviewRequired, "boolean");
  p.fields(value.counts, COUNTS);
  for (const n of Object.values(value.counts)) number(n);
  assert(
    value.counts.activeSessions <= value.counts.sessions,
    "active session count",
  );
  p.fields(value.databases, "issuer presentations");
  for (const db of Object.values(value.databases)) {
    p.fields(db, DATABASE);
    for (const n of Object.values(db)) number(n);
    assert(
      db.pageBytes >= 512 &&
        db.pageBytes <= 65536 &&
        (db.pageBytes & (db.pageBytes - 1)) === 0,
      "database page size",
    );
    assert(
      db.freePages <= db.allocatedPages && db.maximumPages > 0,
      "database pages",
    );
  }
  assert.deepEqual(value.warnings, warnings(value), "health warnings");
  assert.equal(
    value.status,
    Object.keys(value.warnings).length ? "attention" : "ok",
    "health status",
  );
  return value;
}
function database(db) {
  return {
    pageBytes: db.prepare("PRAGMA page_size").get().page_size,
    allocatedPages: db.prepare("PRAGMA page_count").get().page_count,
    freePages: db.prepare("PRAGMA freelist_count").get().freelist_count,
    maximumPages: db.prepare("PRAGMA max_page_count").get().max_page_count,
  };
}
export class HealthMonitor {
  constructor(lab, presentation, origin) {
    this.lab = lab;
    this.presentation = presentation;
    this.started = performance.now();
    this.descriptor = monitorDescriptor({
      format: MONITOR,
      origin,
      instance: p.randomHex(32),
      token: p.randomHex(32),
    });
    this.path = join(lab.dir, MONITOR_FILE);
    // The caller already holds the exclusive issuer lock. Reject unsafe stale files.
    try {
      monitorDescriptor(readPrivate(this.path));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const temporary = join(lab.dir, ".monitor-" + p.randomHex(16) + ".json");
    try {
      writeExclusive(temporary, this.descriptor);
      renameSync(temporary, this.path);
      syncDirectory(lab.dir);
    } finally {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  authorized(req) {
    const authorization = req.headers.authorization;
    return (
      req.headersDistinct.authorization?.length === 1 &&
      typeof authorization === "string" &&
      /^Bearer [0-9a-f]{64}$/.test(authorization) &&
      timingSafeEqual(
        Buffer.from(authorization.slice(7)),
        Buffer.from(this.descriptor.token),
      )
    );
  }
  reply(req) {
    if (req.url !== "/ops/health" || req.method !== "GET")
      return [404, { error: "Not found." }];
    if (
      !this.authorized(req) ||
      req.headers.origin !== undefined ||
      Object.keys(req.headers).some((name) => name.startsWith("sec-fetch-"))
    )
      return [403, { error: "Local monitor authorization required." }];
    const challenge = req.headers["x-ps-health-challenge"];
    if (
      req.headersDistinct["x-ps-health-challenge"]?.length !== 1 ||
      typeof challenge !== "string" ||
      !/^[0-9a-f]{32}$/.test(challenge) ||
      req.headers["transfer-encoding"] !== undefined ||
      (req.headers["content-length"] !== undefined &&
        req.headers["content-length"] !== "0")
    )
      return [
        400,
        { error: "Empty monitor request with fresh challenge required." },
      ];
    try {
      return [200, this.sample(challenge)];
    } catch {
      return [503, { error: "Local health snapshot unavailable." }];
    }
  }
  sample(challenge) {
    const issuer = this.lab.issuer,
      db = issuer.db,
      now = issuer.now();
    const enabled = db
      .prepare("SELECT enabled FROM policy WHERE id=1")
      .get().enabled;
    assert(enabled === 0 || enabled === 1, "policy value");
    const value = {
      format: HEALTH,
      instance: this.descriptor.instance,
      challenge,
      sampledAt: now,
      uptimeMs: Math.floor(performance.now() - this.started),
      enabled: enabled === 1,
      restoreReviewRequired: this.lab.restoreReviewRequired,
      sequence: db
        .prepare("SELECT COALESCE(MAX(seq),0) AS n FROM operations")
        .get().n,
      counts: {
        ...issuer.counts(),
        activeSessions: db
          .prepare(
            "SELECT count(*) AS n FROM sessions s WHERE expires>? AND NOT EXISTS (SELECT 1 FROM operations o WHERE o.session=s.id)",
          )
          .get(now).n,
        observationRequests: this.presentation.requests.size,
        publications: this.presentation.records.size,
      },
      databases: {
        issuer: database(db),
        presentations: database(this.presentation.observer.db),
      },
    };
    value.warnings = warnings(value);
    value.status = Object.keys(value.warnings).length ? "attention" : "ok";
    validateHealth(value, this.descriptor, challenge);
    assert(
      Buffer.byteLength(p.canonical(value)) <= HEALTH_BYTES,
      "health output bound",
    );
    return value;
  }
  close() {
    assert.equal(
      p.canonical(readPrivate(this.path)),
      p.canonical(this.descriptor),
      "monitor descriptor changed",
    );
    unlinkSync(this.path);
    syncDirectory(this.lab.dir);
  }
}
