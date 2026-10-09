// Offline local research snapshots. A valid checkpoint is not proof it is the latest.
import assert from "node:assert/strict";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  mkdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { sign, verify, createPublicKey } from "node:crypto";
import * as p from "./profile.mjs";
import {
  PersistentLab,
  persistentConfig,
  privateDirectory,
  readPrivate,
  writeExclusive,
  syncDirectory,
  statusKey,
  LIMITS,
} from "./persistent.mjs";
import { Issuer } from "./issuer.mjs";
import { PresentationApi } from "./presentation-api.mjs";
export const BACKUP = "zft-ps-local-backup-v1";
const FILES = [
  "private.json",
  "pins.json",
  "ready.json",
  "issuer.db",
  "presentations.db",
];
const frame = (b) => p.utf8(BACKUP + "/checkpoint\0" + p.canonical(b));
function readBytes(path, limit) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    assert(
      s.isFile() &&
        s.uid === process.getuid() &&
        (s.mode & 0o077) === 0 &&
        s.size <= limit,
      "private bounded snapshot file",
    );
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
function writeBytes(path, bytes) {
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function metadata(issuer) {
  return {
    sequence: issuer.db
      .prepare("SELECT COALESCE(MAX(seq),0) AS n FROM operations")
      .get().n,
    counts: issuer.counts(),
    enabled:
      issuer.db.prepare("SELECT enabled FROM policy WHERE id=1").get()
        .enabled === 1,
  };
}
export async function backupPersistent(path, destination) {
  const lab = new PersistentLab(path);
  let publicApi;
  try {
    assert(!lab.restoreReviewRequired, "restore review required before backup");
    publicApi = new PresentationApi(
      lab.issuer,
      join(lab.dir, "presentations.db"),
      "http://127.0.0.1:" + lab.config.port,
      { privateKey: lab.statusPrivateKey, durable: true },
    );
    await publicApi.validateRecords();
    const state = metadata(lab.issuer);
    publicApi.close();
    publicApi = null;
    lab.closeIssuer();
    const target = resolve(destination);
    mkdirSync(target, { mode: 0o700 });
    privateDirectory(target);
    const files = {};
    for (const name of FILES) {
      const bytes = readBytes(
        join(lab.dir, name),
        name.endsWith(".db") ? LIMITS.databaseBytes : 16384,
      );
      writeBytes(join(target, name), bytes);
      files[name] = { bytes: bytes.length, sha256: p.hash(bytes) };
    }
    const body = {
      format: BACKUP,
      realm: lab.manifest.realm,
      keyset_id: lab.manifest.keyset_id,
      created_at: Math.floor(Date.now() / 1000),
      state,
      files,
    };
    const wire = {
      body,
      signature: sign(null, frame(body), lab.statusPrivateKey).toString("hex"),
    };
    writeExclusive(join(target, "snapshot.json"), wire);
    syncDirectory(target);
    return {
      checkpoint: p.hash(p.canonical(wire)),
      realm: body.realm,
      ...state,
    };
  } finally {
    publicApi?.close();
    lab.close();
  }
}
function checkedSnapshot(path, checkpoint) {
  p.bytes(checkpoint, 32);
  const dir = privateDirectory(path),
    value = readPrivate(join(dir, "snapshot.json"), 32768);
  p.fields(value, "body signature");
  assert.equal(
    p.hash(p.canonical(value)),
    checkpoint,
    "snapshot checkpoint mismatch",
  );
  const b = value.body;
  p.fields(b, "format realm keyset_id created_at state files");
  assert.equal(b.format, BACKUP);
  assert(
    Number.isSafeInteger(b.created_at) && b.created_at >= 0,
    "snapshot time",
  );
  p.fields(b.files, FILES.join(" "));
  p.fields(b.state, "sequence counts enabled");
  p.fields(b.state.counts, "sessions operations assets spent");
  for (const n of [b.state.sequence, ...Object.values(b.state.counts)])
    assert(Number.isSafeInteger(n) && n >= 0, "snapshot counts");
  assert.equal(typeof b.state.enabled, "boolean");
  const content = new Map();
  for (const name of FILES) {
    p.fields(b.files[name], "bytes sha256");
    const data = readBytes(
      join(dir, name),
      name.endsWith(".db") ? LIMITS.databaseBytes : 16384,
    );
    assert.equal(data.length, b.files[name].bytes, "snapshot length");
    assert.equal(p.hash(data), b.files[name].sha256, "snapshot file digest");
    content.set(name, data);
  }
  const config = persistentConfig(dir);
  assert.equal(b.realm, config.pins.manifest.realm, "snapshot realm");
  assert.equal(b.keyset_id, config.pins.manifest.keyset_id, "snapshot keyset");
  p.bytes(value.signature, 64);
  assert(
    verify(
      null,
      frame(b),
      createPublicKey(statusKey(config.config.status_private)),
      p.bytes(value.signature),
    ),
    "snapshot signature",
  );
  return { value, content, config };
}
export async function restorePersistent(
  backup,
  destination,
  checkpoint,
  { boundary = () => {} } = {},
) {
  const { value, content, config } = checkedSnapshot(backup, checkpoint);
  const dir = resolve(destination);
  mkdirSync(dir, { mode: 0o700 });
  privateDirectory(dir);
  // The ready marker is withheld until verification and suspended state commit.
  for (const [name, bytes] of content)
    if (name !== "ready.json") writeBytes(join(dir, name), bytes);
  let issuer, publicApi;
  try {
    issuer = new Issuer(
      join(dir, "issuer.db"),
      config.config.realm,
      config.config.secrets,
    );
    assert.deepEqual(
      metadata(issuer),
      value.body.state,
      "snapshot registry metadata",
    );
    publicApi = new PresentationApi(
      issuer,
      join(dir, "presentations.db"),
      "http://127.0.0.1:" + config.config.port,
      { privateKey: statusKey(config.config.status_private), durable: true },
    );
    await publicApi.validateRecords();
    issuer.setEnabled(false);
    publicApi.close();
    publicApi = null;
    issuer.close();
    issuer = null;
    writeExclusive(join(dir, "restore.json"), {
      format: "zft-ps-local-restore-v1",
      checkpoint,
      sequence: value.body.state.sequence,
    });
    boundary("before-restore-ready");
    writeBytes(join(dir, "ready.json"), content.get("ready.json"));
    syncDirectory(dir);
    return {
      checkpoint,
      sequence: value.body.state.sequence,
      enabled: false,
      reviewRequired: true,
    };
  } finally {
    publicApi?.close();
    issuer?.close();
  }
}
export function approveRestore(path, checkpoint) {
  p.bytes(checkpoint, 32);
  const lab = new PersistentLab(path);
  try {
    assert(lab.restored, "not a restored issuer");
    assert.equal(checkpoint, lab.restored.checkpoint, "restore checkpoint");
    if (lab.restoreReviewRequired) {
      writeExclusive(join(lab.dir, "restore-approved.json"), { checkpoint });
      syncDirectory(lab.dir);
    }
  } finally {
    lab.close();
  }
}
export function resumePersistent(path) {
  const lab = new PersistentLab(path);
  try {
    assert(!lab.restoreReviewRequired, "restore review required");
    lab.issuer.setEnabled(true);
  } finally {
    lab.close();
  }
}
