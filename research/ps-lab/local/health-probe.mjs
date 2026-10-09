// One local read-only probe; no issuer key reads, redirects, retries or mutation.
import assert from "node:assert/strict";
import { request } from "node:http";
import { join } from "node:path";
import {
  HEALTH_BYTES,
  MONITOR_FILE,
  monitorDescriptor,
  validateHealth,
} from "./health.mjs";
import { privateDirectory, readPrivate } from "./persistent.mjs";
import * as p from "./profile.mjs";
export async function probeHealth(dir, { timeoutMs = 5000 } = {}) {
  assert(
    Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 5000,
    "bounded monitor timeout",
  );
  const descriptor = monitorDescriptor(
    readPrivate(join(privateDirectory(dir), MONITOR_FILE)),
  );
  const challenge = p.randomHex(16);
  const value = await new Promise((resolve, reject) => {
    const req = request(descriptor.origin + "/ops/health", {
      method: "GET",
      agent: false,
      maxHeaderSize: 8192,
      headers: {
        Authorization: "Bearer " + descriptor.token,
        "X-PS-Health-Challenge": challenge,
      },
    });
    // Absolute deadline, not an inactivity timeout that trickled bytes can extend.
    const timer = setTimeout(
      () => req.destroy(Error("Local monitor timeout")),
      timeoutMs,
    );
    const fail = () => {
      req.destroy();
      reject(Error("Local health probe failed"));
    };
    req.once("error", fail);
    req.once("close", () => clearTimeout(timer));
    req.once("response", (res) => {
      if (
        res.statusCode !== 200 ||
        res.headersDistinct["content-type"]?.length !== 1 ||
        res.headers["content-type"] !== "application/json" ||
        res.headers["content-encoding"] !== undefined
      ) {
        res.destroy();
        fail();
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > HEALTH_BYTES) {
          res.destroy();
          fail();
        } else chunks.push(chunk);
      });
      res.once("error", fail);
      res.once("aborted", fail);
      res.once("end", () => {
        try {
          const text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(Buffer.concat(chunks));
          resolve(
            validateHealth(p.parse(text, HEALTH_BYTES), descriptor, challenge),
          );
        } catch {
          fail();
        }
      });
    });
    req.end();
  });
  // A rotated descriptor means this is no longer the serving instance we pinned.
  assert.equal(
    p.canonical(readPrivate(join(dir, MONITOR_FILE))),
    p.canonical(descriptor),
    "monitor instance changed during probe",
  );
  return value;
}
