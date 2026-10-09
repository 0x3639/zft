import assert from "node:assert/strict";
import {
  initializePersistent,
  PersistentLab,
  recoverPersistentLock,
} from "./persistent.mjs";
import { startBrowserLab } from "./browser-server.mjs";
const [command, path, arg, ...extra] = process.argv.slice(2);
assert(
  path && extra.length === 0,
  "Usage: init DIR PORT | serve DIR | status DIR | suspend DIR | resume DIR | recover-lock DIR",
);
if (command === "init") {
  assert(/^\d{4,5}$/.test(arg ?? ""), "explicit loopback port required");
  const pins = initializePersistent(path, Number(arg));
  console.log(
    JSON.stringify({
      realm: pins.manifest.realm,
      port: pins.port,
      notice:
        "Local research only. Back up private files offline; not production key custody.",
    }),
  );
} else {
  assert(arg === undefined, "unexpected argument");
  if (command === "serve") {
    const r = await startBrowserLab({ product: true, persistentDir: path });
    console.log(
      "Persistent local PS research issuer. Test artwork only; state is retained on exit.",
    );
    console.log(r.url);
    let closing = false;
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, async () => {
        if (closing) return;
        closing = true;
        await r.close();
        process.exit(0);
      });
  } else if (command === "recover-lock") {
    recoverPersistentLock(path);
    console.log(
      "Removed lock of a confirmed dead local process. Inspect state before serving.",
    );
  } else {
    assert(
      ["status", "suspend", "resume"].includes(command),
      "unknown command",
    );
    const lab = new PersistentLab(path);
    try {
      if (command !== "status") lab.issuer.setEnabled(command === "resume");
      console.log(
        JSON.stringify({
          realm: lab.manifest.realm,
          counts: lab.issuer.counts(),
          enabled:
            lab.issuer.db.prepare("SELECT enabled FROM policy WHERE id=1").get()
              .enabled === 1,
        }),
      );
    } finally {
      lab.close();
    }
  }
}
