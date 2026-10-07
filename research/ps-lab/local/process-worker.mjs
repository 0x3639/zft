// Test-only process harness: all inputs are local lab artifacts, never live keys.
import { Issuer } from "./issuer.mjs";
import { Client } from "./client.mjs";
process.once("message", (job) => {
  const boundary = (phase) => {
    if (phase === job.crash) process.kill(process.pid, "SIGKILL");
  };
  const instance = job.client
    ? new Client(job.path, job.manifest, { boundary })
    : new Issuer(job.path, job.realm, job.secrets, { boundary });
  process.send({ ready: true });
  process.once("message", () => {
    try {
      let value;
      if (!job.client) value = instance.submit(job.wire, job.capability);
      else
        switch (job.action ?? "accept") {
          case "prepare":
            value = instance.prepareIssue(
              job.session,
              new Uint8Array(job.asset),
            );
            break;
          case "acknowledge":
            value = instance.acknowledge(job.digest, job.snapshotHash);
            break;
          case "restore":
            value = instance.restore(job.snapshot);
            break;
          case "accept":
            value = instance.accept(job.digest, job.response);
            break;
          default:
            throw new Error("unknown test action");
        }
      instance.close();
      process.send({ ok: true, value });
    } catch (error) {
      instance.close();
      process.send({ ok: false, error: error.message });
    }
    process.disconnect();
  });
});
