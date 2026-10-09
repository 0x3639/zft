import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { SERVICE_LIMITS } from "./issuer.mjs";
import { GRANT_LIMIT } from "./admission.mjs";
import { AsyncBoundary } from "./boundary.mjs";
export function health(issuer, started = performance.now()) {
  const db = issuer.database,
    counts = issuer.counts(),
    policy = issuer.policy();
  counts.grants = db.prepare("SELECT count(*) AS n FROM grants").get().n;
  const pageCount = db.prepare("PRAGMA page_count").get().page_count,
    pageSize = db.prepare("PRAGMA page_size").get().page_size;
  const warnings = [];
  if (!policy.enabled) warnings.push("suspended");
  if (policy.restore_required) warnings.push("restore-review");
  for (const [key, limit] of Object.entries({
    sessions: SERVICE_LIMITS.sessions,
    operations: SERVICE_LIMITS.operations,
    observations: SERVICE_LIMITS.observations,
    grants: GRANT_LIMIT,
  }))
    if (counts[key] >= Math.ceil(limit * 0.8)) warnings.push(key + "-capacity");
  if (pageCount * pageSize >= Math.ceil(16 * 1024 * 1024 * 0.8))
    warnings.push("allocated-pages-capacity");
  return Object.freeze({
    format: "zft-ps-service-health-v1",
    status: warnings.length ? "attention" : "ok",
    enabled: !!policy.enabled,
    restoreReviewRequired: !!policy.restore_required,
    counts,
    sequence: db
      .prepare("SELECT coalesce(max(seq),0) AS n FROM operations")
      .get().n,
    uptimeSeconds: Math.max(
      0,
      Math.floor((performance.now() - started) / 1000),
    ),
    pageCount,
    pageSize,
    warnings,
  });
}
/** Caller-triggered, injected alert delivery only. No scheduler, destination or automatic retry. */
export class HealthAlert {
  #send;
  #gate;
  #last = null;
  constructor(send, timeoutMs = 5000) {
    assert.equal(typeof send, "function");
    this.#send = send;
    this.#gate = new AsyncBoundary("ALERT", timeoutMs);
  }
  async sample(issuer, { signal } = {}) {
    this.#gate.check(signal);
    const report = health(issuer),
      state = report.status + ":" + report.warnings.join(",");
    if (this.#last === state) return { changed: false };
    // Allowlisted fixed codes and aggregates only. Never forward caller-provided error text or paths.
    const event = Object.freeze({
      format: "zft-ps-service-alert-v1",
      status: report.status,
      warnings: Object.freeze([...report.warnings]),
      sequence: report.sequence,
    });
    await this.#gate.run(
      (s) => this.#send(event, Object.freeze({ signal: s })),
      (v) => {
        assert.equal(v, true);
        return true;
      },
      signal,
    );
    this.#last = state;
    return { changed: true };
  }
  close() {
    this.#gate.close();
  }
}
