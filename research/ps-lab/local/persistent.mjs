// Local persistence qualification only. Private files are not a production keystore.
import assert from "node:assert/strict";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { hostname } from "node:os";
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import * as p from "./profile.mjs";
import { Issuer } from "./issuer.mjs";
import { stateManifest } from "./state.mjs";
export const PERSISTENT = "zft-ps-persistent-local-v1";
export const LIMITS = Object.freeze({
  operations: 128,
  sessions: 512,
  databaseBytes: 16 * 1024 * 1024,
});
const FILES = ["issuer.db", "presentations.db"];
export function syncDirectory(dir) {
  const fd = openSync(dir, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function privateDirectory(path) {
  const dir = resolve(path),
    s = lstatSync(dir);
  assert(
    s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o077) === 0,
    "private directory required",
  );
  assert.equal(s.uid, process.getuid(), "directory owner");
  assert.equal(realpathSync(dir), dir, "canonical directory required");
  return dir;
}
export function writeExclusive(path, value) {
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, p.canonical(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function readPrivate(path, limit = 16384) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    assert(
      s.isFile() &&
        s.uid === process.getuid() &&
        (s.mode & 0o077) === 0 &&
        s.size <= limit,
      "private bounded file required",
    );
    return p.parse(readFileSync(fd, "utf8"), limit);
  } finally {
    closeSync(fd);
  }
}
export function statusKey(value) {
  const key = createPrivateKey({
    key: Buffer.from(p.bytes(value)),
    type: "pkcs8",
    format: "der",
  });
  assert.equal(key.asymmetricKeyType, "ed25519", "status key type");
  assert.equal(
    key.export({ type: "pkcs8", format: "der" }).toString("hex"),
    value,
    "canonical status key",
  );
  return key;
}
function publicPins(config) {
  p.fields(config, "format realm secrets status_private clients port");
  assert.equal(config.format, PERSISTENT);
  p.bytes(config.realm, 32);
  assert(
    Number.isInteger(config.port) &&
      config.port >= 1024 &&
      config.port <= 65535,
    "fixed loopback port",
  );
  p.fields(config.clients, "alice bob restored");
  for (const id of Object.values(config.clients)) p.bytes(id, 16);
  assert.equal(
    new Set(Object.values(config.clients)).size,
    3,
    "unique browser identities",
  );
  const manifest = p.manifest(config.realm, config.secrets),
    key = statusKey(config.status_private);
  const raw = createPublicKey(key)
    .export({ type: "spki", format: "der" })
    .subarray(-32)
    .toString("hex");
  return {
    format: PERSISTENT,
    manifest,
    status: stateManifest(manifest, raw),
    clients: config.clients,
    port: config.port,
  };
}
export function initializePersistent(path, port) {
  // An existing directory is never adopted or overwritten, even if it is empty.
  assert(
    Number.isInteger(port) && port >= 1024 && port <= 65535,
    "fixed loopback port",
  );
  const dir = resolve(path);
  mkdirSync(dir, { mode: 0o700 });
  privateDirectory(dir);
  const { privateKey } = generateKeyPairSync("ed25519");
  const config = {
    format: PERSISTENT,
    realm: p.randomHex(32),
    secrets: Object.fromEntries(
      ["x", "yh", "ys"].map((k) => [k, p.scalarHex(p.randomScalar())]),
    ),
    status_private: privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("hex"),
    clients: Object.fromEntries(
      ["alice", "bob", "restored"].map((k) => [k, p.randomHex(16)]),
    ),
    port,
  };
  const pins = publicPins(config);
  writeExclusive(join(dir, "private.json"), config);
  writeExclusive(join(dir, "pins.json"), pins);
  // Initialize both databases before the ready marker; later open never recreates missing state.
  const issuer = new Issuer(
    join(dir, "issuer.db"),
    config.realm,
    config.secrets,
  );
  issuer.close();
  initializeObserver(dir, pins);
  writeExclusive(join(dir, "ready.json"), {
    format: PERSISTENT,
    config_hash: p.hash(p.canonical(config)),
    pins_hash: p.hash(p.canonical(pins)),
  });
  syncDirectory(dir);
  return pins;
}
import { StateObserver } from "./state.mjs";
function initializeObserver(dir, pins) {
  const o = new StateObserver(
    join(dir, "presentations.db"),
    pins.manifest,
    pins.status,
  );
  o.close();
}
export function persistentConfig(path) {
  const dir = privateDirectory(path),
    config = readPrivate(join(dir, "private.json")),
    pins = publicPins(config),
    saved = readPrivate(join(dir, "pins.json")),
    ready = readPrivate(join(dir, "ready.json"));
  p.fields(ready, "format config_hash pins_hash");
  assert.equal(ready.format, PERSISTENT);
  assert.equal(
    p.canonical(saved),
    p.canonical(pins),
    "public/private pins mismatch",
  );
  assert.equal(
    ready.config_hash,
    p.hash(p.canonical(config)),
    "configuration changed",
  );
  assert.equal(ready.pins_hash, p.hash(p.canonical(pins)), "pins changed");
  for (const f of FILES) {
    const s = lstatSync(join(dir, f));
    assert(
      s.isFile() &&
        !s.isSymbolicLink() &&
        s.uid === process.getuid() &&
        (s.mode & 0o077) === 0,
      "existing private database required",
    );
  }
  return { dir, config, pins };
}
function acquire(dir) {
  const value = {
    format: PERSISTENT,
    pid: process.pid,
    host: hostname(),
    nonce: p.randomHex(16),
  };
  writeExclusive(join(dir, "run.lock"), value);
  syncDirectory(dir);
  return value;
}
export function recoverPersistentLock(path) {
  const { dir } = persistentConfig(path),
    lock = readPrivate(join(dir, "run.lock"));
  p.fields(lock, "format pid host nonce");
  assert.equal(lock.format, PERSISTENT);
  p.bytes(lock.nonce, 16);
  assert.equal(lock.host, hostname(), "lock belongs to another host");
  assert(Number.isSafeInteger(lock.pid) && lock.pid > 0, "lock PID");
  let dead = false;
  try {
    process.kill(lock.pid, 0);
  } catch (e) {
    if (e.code === "ESRCH") dead = true;
    else throw e;
  }
  assert(dead, "owner is still running; do not steal lock");
  assert.equal(
    p.canonical(readPrivate(join(dir, "run.lock"))),
    p.canonical(lock),
    "lock changed",
  );
  unlinkSync(join(dir, "run.lock"));
  syncDirectory(dir);
}
export function boundDatabase(db) {
  assert.equal(
    db.prepare("PRAGMA quick_check").get().quick_check,
    "ok",
    "database integrity",
  );
  const size = db.prepare("PRAGMA page_size").get().page_size;
  const pages = Math.floor(LIMITS.databaseBytes / size);
  assert(
    db.prepare("PRAGMA page_count").get().page_count <= pages,
    "database exceeds local bound",
  );
  db.exec("PRAGMA max_page_count=" + pages);
}
export class PersistentLab {
  constructor(path) {
    const { dir, config, pins } = persistentConfig(path);
    this.dir = dir;
    this.config = config;
    this.pins = pins;
    this.manifest = pins.manifest;
    this.closed = false;
    this.restoreReviewRequired = false;
    const optional = (name) => {
      try {
        return readPrivate(join(dir, name));
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    };
    this.restored = optional("restore.json");
    if (this.restored) {
      p.fields(this.restored, "format checkpoint sequence");
      assert.equal(this.restored.format, "zft-ps-local-restore-v1");
      p.bytes(this.restored.checkpoint, 32);
      assert(
        Number.isSafeInteger(this.restored.sequence) &&
          this.restored.sequence >= 0,
        "restore sequence",
      );
      const approval = optional("restore-approved.json");
      if (approval) {
        p.fields(approval, "checkpoint");
        assert.equal(
          approval.checkpoint,
          this.restored.checkpoint,
          "restore approval mismatch",
        );
      }
      this.restoreReviewRequired = !approval;
    }
    this.lock = acquire(dir);
    try {
      this.issuer = new Issuer(
        join(dir, "issuer.db"),
        config.realm,
        config.secrets,
      );
      boundDatabase(this.issuer.db);
      this.statusPrivateKey = statusKey(config.status_private);
    } catch (e) {
      this.close();
      throw e;
    }
  }
  closeIssuer() {
    this.issuer?.close();
    this.issuer = undefined;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.closeIssuer();
    const path = join(this.dir, "run.lock");
    assert.equal(
      p.canonical(readPrivate(path)),
      p.canonical(this.lock),
      "lock changed",
    );
    unlinkSync(path);
    syncDirectory(this.dir);
  }
}
