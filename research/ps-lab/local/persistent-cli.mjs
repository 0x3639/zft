import assert from "node:assert/strict";
import {
  initializePersistent,
  PersistentLab,
  recoverPersistentLock,
} from "./persistent.mjs";
import {
  backupPersistent,
  restorePersistent,
  approveRestore,
  resumePersistent,
} from "./persistent-ops.mjs";
import { startBrowserLab } from "./browser-server.mjs";
const [command, ...args] = process.argv.slice(2);
const arity = {
  init: 2,
  serve: 1,
  status: 1,
  suspend: 1,
  resume: 1,
  "recover-lock": 1,
  backup: 2,
  restore: 3,
  "approve-restore": 2,
};
assert(
  Object.hasOwn(arity, command) && args.length === arity[command],
  "Usage: init DIR PORT | serve DIR | status DIR | suspend DIR | resume DIR | recover-lock DIR | backup DIR NEW_BACKUP | restore BACKUP NEW_DIR EXPECTED_CHECKPOINT | approve-restore DIR EXPECTED_CHECKPOINT",
);
const [path, arg, checkpoint] = args;
if (command === "init") {
  assert(/^\d{4,5}$/.test(arg), "explicit loopback port required");
  const pins = initializePersistent(path, Number(arg));
  console.log(
    JSON.stringify({
      realm: pins.manifest.realm,
      port: pins.port,
      notice:
        "Local research only; private files require separate backup and production review.",
    }),
  );
} else if (command === "serve") {
  const r = await startBrowserLab({ product: true, persistentDir: path });
  console.log(
    "Persistent local PS research issuer. Test artwork only; state retained on exit.",
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
} else if (command === "backup")
  console.log(JSON.stringify(await backupPersistent(path, arg)));
else if (command === "restore")
  console.log(JSON.stringify(await restorePersistent(path, arg, checkpoint)));
else if (command === "approve-restore") {
  approveRestore(path, arg);
  console.log(
    "Restore review acknowledged; issuer remains suspended until explicit resume.",
  );
} else if (command === "resume") {
  resumePersistent(path);
  console.log("Local admission resumed.");
} else if (command === "recover-lock") {
  recoverPersistentLock(path);
  console.log(
    "Dead-owner lock removed. Inspect retained state before serving.",
  );
} else {
  const lab = new PersistentLab(path);
  try {
    if (command === "suspend") lab.issuer.setEnabled(false);
    console.log(
      JSON.stringify({
        realm: lab.manifest.realm,
        counts: lab.issuer.counts(),
        enabled:
          lab.issuer.db.prepare("SELECT enabled FROM policy WHERE id=1").get()
            .enabled === 1,
        restoreReviewRequired: lab.restoreReviewRequired,
        restoredCheckpoint: lab.restored?.checkpoint ?? null,
      }),
    );
  } finally {
    lab.close();
  }
}
