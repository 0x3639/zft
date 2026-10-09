// Disposable test process only. Deliberate stops are filesystem-call boundaries.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { PsKeyFile, KEY_FILE } from "./key-file.mjs";
import { config, transport, secrets } from "./key-file-test-support.mjs";
import * as p from "./profile.mjs";
const [dir, mode, gate] = process.argv.slice(2);
const original = Object.fromEntries(
  ["openSync", "writeSync", "fsyncSync", "linkSync", "unlinkSync"].map((k) => [
    k,
    fs[k],
  ]),
);
const emit = (value) => original.writeSync(1, JSON.stringify(value) + "\n");
const park = (stage) => {
  emit({ stage });
  for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
};
let dirSyncs = 0;
fs.openSync = (...args) => {
  const fd = original.openSync(...args);
  if (mode === "temp-open" && String(args[0]).endsWith(".tmp")) park(mode);
  return fd;
};
fs.writeSync = (...args) => {
  const count = original.writeSync(...args);
  if (mode === "temp-write" && args[0] !== 1) park(mode);
  return count;
};
fs.fsyncSync = (fd) => {
  original.fsyncSync(fd);
  if (fs.fstatSync(fd).isDirectory()) {
    dirSyncs++;
    if (
      (mode === "published-sync" && dirSyncs === 1) ||
      (mode === "cleanup-sync" && dirSyncs === 2)
    )
      park(mode);
  } else if (mode === "file-sync") park(mode);
};
fs.linkSync = (...args) => {
  if (mode === "race") {
    emit({ stage: "ready" });
    while (!fs.existsSync(gate))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  original.linkSync(...args);
  if (mode === "publish") park(mode);
};
fs.unlinkSync = (...args) => {
  original.unlinkSync(...args);
  if (mode === "cleanup") park(mode);
};
syncBuiltinESMExports();
const store = new PsKeyFile(dir, { ...config, transport });
try {
  if (mode === "open") {
    const opened = await store.open(gate);
    emit({ opened: p.canonical(opened) === p.canonical(secrets) });
  } else {
    const result = await store.create(secrets);
    emit({ result });
  }
} catch (error) {
  emit({ error: error.code });
  process.exitCode = 2;
} finally {
  store.close();
}
