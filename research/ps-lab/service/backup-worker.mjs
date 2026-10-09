// Disposable process-kill backup/restore fixtures only.
import { backupService, restoreService } from "./backup.mjs";
import { transport } from "./test-support.mjs";
process.once("message", async (job) => {
  const boundary = (stage) => {
    if (stage === job.crash) process.kill(process.pid, "SIGKILL");
  };
  try {
    if (job.action === "backup")
      await backupService(job.dir, job.readyDigest, job.out, {
        transport,
        boundary,
      });
    else
      await restoreService(job.archive, job.target, job.selection, {
        transport,
        boundary,
      });
    process.send({ unexpectedCompletion: true });
  } catch (e) {
    process.send({ error: e.code || "fixture-failure" });
  } finally {
    process.disconnect();
  }
});
