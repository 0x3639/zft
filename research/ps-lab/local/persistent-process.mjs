// Test-only process host. Never writes launch capability to stdout.
import { startBrowserLab } from "./browser-server.mjs";
let running;
process.once("message", async ({ dir, root }) => {
  try {
    running = await startBrowserLab({
      product: true,
      persistentDir: dir,
      productRoot: root,
    });
    process.send({ origin: running.origin, token: running.token });
  } catch {
    process.send({ error: "startup failed" });
    process.exitCode = 1;
    process.disconnect();
  }
});
process.on("SIGTERM", async () => {
  await running?.close();
  process.exit(0);
});
