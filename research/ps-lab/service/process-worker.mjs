// Actual process-kill fixtures only. No user state or production entry point.
import { ServiceIssuer } from "./issuer.mjs";
import { ServiceStatus } from "./status.mjs";
import { loadReferenceCustody } from "./reference-custody.mjs";
import { config, transport } from "./test-support.mjs";
import { statusConfig } from "./status-test-support.mjs";
process.once("message", async (job) => {
  let issuer, custody, status;
  const boundary = (name) => {
    if (name === job.crash) process.kill(process.pid, "SIGKILL");
  };
  try {
    custody = await loadReferenceCustody(job.keys, job.digest, {
      ...config,
      transport,
    });
    issuer = new ServiceIssuer(job.path, {
      ...config,
      transport: custody.transport,
      now: () => 1000,
      boundary,
    });
    if (job.action === "session") await issuer.session("issue");
    else if (job.action === "submit")
      await issuer.submit(job.wire, job.capability);
    else {
      status = new ServiceStatus(issuer, {
        ...statusConfig,
        now: () => 1000,
        boundary,
      });
      await status.observe(job.wire);
    }
    process.send({ unexpectedCompletion: true });
  } catch (error) {
    process.send({ error: error.code ?? "test-failed" });
    process.exitCode = 1;
  } finally {
    status?.close();
    issuer?.close();
    custody?.close();
    process.disconnect();
  }
});
