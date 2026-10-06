// A separate local-only runtime lets the recovery suite kill the entire process
// group without gracefully flushing or resetting the Durable Object's storage.
import { unstable_dev } from "wrangler";

if (!process.send || !process.argv[2])
  throw new Error("This fixture must be launched by the recovery test harness");

const worker = await unstable_dev("tests/fixtures/sponsor-worker.ts", {
  config: "tests/fixtures/wrangler.sponsor.jsonc",
  local: true,
  ip: "127.0.0.1",
  port: 0,
  inspectorPort: 0,
  persist: true,
  persistTo: process.argv[2],
  logLevel: "error",
  experimental: {
    disableExperimentalWarning: true,
    disableDevRegistry: true,
    watch: false,
  },
});
process.send({ port: worker.port });

// Normal teardown uses the same abrupt stop as the fault injection. It cannot
// accidentally make the restart tests pass through graceful persistence.
process.on("disconnect", () => process.kill(-process.pid, "SIGKILL"));
