import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fork } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { config, secrets, transport } from "./test-support.mjs";
import { statusConfig } from "./status-test-support.mjs";
import { initializeService, openService, READY } from "./runtime.mjs";
import { backupService, restoreService } from "./backup.mjs";
import { inspectLock, reclaimDeadLock } from "./files.mjs";
import { loadReferenceCustody } from "./reference-custody.mjs";
import * as p from "../local/profile.mjs";
async function killed(job) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = fork(
    fileURLToPath(new URL("./backup-worker.mjs", import.meta.url)),
    [],
    {
      execArgv: ["--experimental-sqlite"],
      env,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let message,
    timedOut = false;
  child.on("message", (m) => (message = m));
  child.stderr.resume();
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 20000);
  child.send(job);
  try {
    assert.deepEqual(await done, { code: null, signal: "SIGKILL" });
    assert.equal(timedOut, false);
    assert.equal(message, undefined);
  } finally {
    clearTimeout(timer);
  }
}
for (const crash of [
  "before-backup-publication",
  "after-file-publication",
  "after-file-commit",
])
  test(
    "backup SIGKILL " +
      crash +
      " preserves inert ciphertext and explicit lock recovery",
    async (t) => {
      const root = fs.realpathSync(
        fs.mkdtempSync(join(tmpdir(), "zft-backup-kill-")),
      );
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const dir = join(root, "state"),
        out = join(root, "out");
      for (const x of [dir, out]) fs.mkdirSync(x, { mode: 0o700 });
      const ready = await initializeService(dir, secrets, {
        ...config,
        transport,
        status: statusConfig,
      });
      await killed({
        action: "backup",
        dir,
        readyDigest: ready.sha256,
        out,
        crash,
      });
      const lock = inspectLock(dir);
      assert(lock.dead);
      reclaimDeadLock(dir, lock.sha256);
      const archive = join(out, "service-backup.enc.json");
      assert.equal(
        fs.existsSync(archive),
        crash !== "before-backup-publication",
      );
      if (fs.existsSync(archive)) {
        const outer = p.parse(
            fs.readFileSync(archive, "utf8"),
            128 * 1024 * 1024 + 16384,
          ),
          target = join(root, "restore");
        fs.mkdirSync(target, { mode: 0o700 });
        await restoreService(
          archive,
          target,
          {
            sha256: p.hash(fs.readFileSync(archive)),
            recordId: outer.scope.record_id,
            readyDigest: ready.sha256,
            sequence: 0,
          },
          { transport },
        );
      }
    },
  );
for (const crash of [
  "before-restore-ready",
  "after-file-publication",
  "after-file-commit",
])
  test(
    "restore SIGKILL " + crash + " never admits an unreviewed restored store",
    async (t) => {
      const root = fs.realpathSync(
        fs.mkdtempSync(join(tmpdir(), "zft-restore-kill-")),
      );
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const dir = join(root, "state"),
        out = join(root, "out"),
        target = join(root, "restore");
      for (const x of [dir, out, target]) fs.mkdirSync(x, { mode: 0o700 });
      const ready = await initializeService(dir, secrets, {
          ...config,
          transport,
          status: statusConfig,
        }),
        b = await backupService(dir, ready.sha256, out, { transport });
      await killed({
        action: "restore",
        archive: join(out, "service-backup.enc.json"),
        target,
        selection: {
          sha256: b.sha256,
          recordId: b.recordId,
          readyDigest: b.readyDigest,
          sequence: 0,
        },
        crash,
      });
      const lock = inspectLock(target);
      assert(lock.dead);
      reclaimDeadLock(target, lock.sha256);
      const options = {
        loadCustody: ({ directory, keySha256 }) =>
          loadReferenceCustody(directory, keySha256, { ...config, transport }),
        statusTransport: statusConfig.transport,
        now: () => 1000,
      };
      if (crash === "before-restore-ready") {
        assert(!fs.existsSync(join(target, READY)));
        await assert.rejects(openService(target, b.readyDigest, options));
      } else {
        const s = await openService(target, b.readyDigest, options);
        try {
          assert.equal(s.issuer.policy().restore_required, 1);
          assert.throws(() => s.issuer.setEnabled(true));
        } finally {
          s.close();
        }
      }
    },
  );
