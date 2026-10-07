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
      const value = job.client
        ? instance.accept(job.digest, job.response)
        : instance.submit(job.wire, job.capability);
      instance.close();
      process.send({ ok: true, value });
    } catch (error) {
      instance.close();
      process.send({ ok: false, error: error.message });
    }
    process.disconnect();
  });
});
