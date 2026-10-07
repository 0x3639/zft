// Test-only stores and IPC workers shared by the local research suites.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { Issuer } from "./issuer.mjs";
import { Client } from "./client.mjs";
import * as p from "./profile.mjs";
const vectors = JSON.parse(
  readFileSync(new URL("../vectors.json", import.meta.url), "utf8"),
);
export const secrets = Object.fromEntries(
  ["x", "yh", "ys"].map((k) => [k, vectors.test_secrets[k]]),
);
export const realm = "71".repeat(32),
  wallet = "42".repeat(20),
  nonce = "31".repeat(32);
export const asset = p.utf8("local PS lab artwork; no real assets");
export function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zft PS engine # ")),
    opened = [];
  const openIssuer = (extra = {}) => {
    const i = new Issuer(join(dir, "issuer.db"), realm, secrets, {
      ...options,
      ...extra,
    });
    opened.push(i);
    return i;
  };
  const issuer = openIssuer();
  const client = (name, extra = {}) => {
    const c = new Client(
      join(dir, name + ".db"),
      issuer.pinned.manifest,
      extra,
    );
    opened.push(c);
    return c;
  };
  const a = client("a"),
    b = client("b");
  t.after(() => {
    for (const c of opened)
      try {
        c.close();
      } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  const acknowledge = (c, d) => c.acknowledge(d, p.hash(c.backup(d)));
  const mint = () => {
    const d = a.prepareIssue(issuer.session("issue"), asset);
    acknowledge(a, d);
    return a.submit(d, issuer);
  };
  return { dir, issuer, a, b, client, openIssuer, acknowledge, mint };
}
export function pending(c, d) {
  return p.parse(c.backup(d), 300000);
}
export function child(job) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const c = fork(
    fileURLToPath(new URL("./process-worker.mjs", import.meta.url)),
    [],
    {
      env,
      execArgv: ["--experimental-sqlite"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let stderr = "",
    message;
  c.stderr.on("data", (x) => {
    stderr += x;
  });
  const ready = new Promise((resolve, reject) => {
    c.once("error", reject);
    c.once("message", (m) => {
      assert(m.ready);
      resolve();
    });
    c.once("exit", (code, signal) => {
      if (code || signal) reject(new Error("child startup: " + stderr));
    });
  });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      c.kill("SIGKILL");
      reject(new Error("worker timeout " + stderr));
    }, 30000);
    c.on("message", (m) => {
      if (!m.ready) message = m;
    });
    c.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    c.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, message, stderr });
    });
  });
  c.send(job);
  return { ready, run: () => c.send({ go: true }), done };
}
export function job(f, c, d, crash) {
  const v = pending(c, d);
  return {
    path: join(f.dir, "issuer.db"),
    realm,
    secrets,
    wire: v.wire,
    capability: v.capability,
    crash,
  };
}
