// Test-only process harness: all inputs are local lab artifacts, never live keys.
import { Issuer } from "./issuer.mjs";
import { Client } from "./client.mjs";
import { StateObserver } from "./state.mjs";
process.once("message", (job) => {
  const boundary = (phase) => {
    if (phase === job.crash) process.kill(process.pid, "SIGKILL");
  };
  const instance = job.observer
    ? new StateObserver(job.path, job.psManifest, job.stateManifest, {
        now: () => job.now,
        boundary,
      })
    : job.client
      ? new Client(job.path, job.manifest, { boundary })
      : new Issuer(job.path, job.realm, job.secrets, { boundary });
  process.send({ ready: true });
  process.once("message", () => {
    try {
      let value;
      if (job.observer) {
        switch (job.action ?? "accept") {
          case "prepare":
            value = instance.prepare(job.wallet, job.h, job.audience);
            break;
          case "request":
            value = instance.request(job.challenge, job.showing);
            break;
          case "accept":
            value = instance.accept(job.challenge, job.receipt);
            break;
          default:
            throw new Error("unknown observer test action");
        }
      } else if (!job.client) value = instance.submit(job.wire, job.capability);
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
