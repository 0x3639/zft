// Controlled local filesystem only. These path checks are not descriptor-relative race isolation.
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve, join } from "node:path";
import { hostname } from "node:os";
import * as p from "../local/profile.mjs";
export function privateDirectory(path) {
  const dir = resolve(path),
    s = fs.lstatSync(dir);
  assert(
    s.isDirectory() &&
      !s.isSymbolicLink() &&
      s.uid === process.getuid() &&
      (s.mode & 0o077) === 0 &&
      fs.realpathSync(dir) === dir,
    "private canonical directory",
  );
  return { dir, dev: s.dev, ino: s.ino };
}
export function sameDirectory(selected) {
  const actual = privateDirectory(selected.dir);
  assert(
    actual.dev === selected.dev && actual.ino === selected.ino,
    "directory changed",
  );
}
export function syncDirectory(dir) {
  const fd = fs.openSync(
    dir,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export function readPrivate(path, limit) {
  const fd = fs.openSync(
    path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const s = fs.fstatSync(fd);
    assert(
      s.isFile() &&
        s.uid === process.getuid() &&
        (s.mode & 0o077) === 0 &&
        s.size > 0 &&
        s.size <= limit,
      "private bounded file",
    );
    const bytes = Buffer.alloc(s.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      assert(n > 0, "short file");
      offset += n;
    }
    assert.equal(fs.readSync(fd, Buffer.alloc(1), 0, 1, null), 0, "file grew");
    const after = fs.fstatSync(fd);
    assert.equal(after.size, s.size);
    assert.equal(after.mtimeMs, s.mtimeMs, "file changed");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
/** Create-only publication; failures after link preserve final and carry a ciphertext/public digest. */
export function publish(dir, name, bytes, boundary = () => {}) {
  assert(/^[a-z0-9.-]{1,64}$/.test(name), "fixed basename");
  const selected = privateDirectory(dir),
    temp = join(dir, ".publish-" + p.randomHex(16)),
    final = join(dir, name);
  let fd,
    identity,
    published = false;
  const ownTemp = () => {
    const s = fs.lstatSync(temp);
    assert(
      s.dev === identity.dev && s.ino === identity.ino,
      "temporary inode changed",
    );
    fs.unlinkSync(temp);
  };
  try {
    fd = fs.openSync(
      temp,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    identity = fs.fstatSync(fd);
    let n = 0;
    while (n < bytes.length) {
      const w = fs.writeSync(fd, bytes, n, bytes.length - n);
      assert(w > 0, "short write");
      n += w;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    boundary("after-file-sync");
    sameDirectory(selected);
    const s = fs.lstatSync(temp);
    assert(
      s.dev === identity.dev && s.ino === identity.ino,
      "temporary inode changed",
    );
    fs.linkSync(temp, final);
    published = true;
    boundary("after-file-publication");
    syncDirectory(dir);
    ownTemp();
    syncDirectory(dir);
    boundary("after-file-commit");
    return Object.freeze({ sha256: p.hash(bytes), bytes: bytes.length });
  } catch (error) {
    if (fd !== undefined)
      try {
        fs.closeSync(fd);
      } catch {}
    if (!published && identity)
      try {
        sameDirectory(selected);
        ownTemp();
      } catch {}
    const failure = new Error(
      published ? "publication outcome uncertain" : "publication failed",
    );
    failure.code = published ? "ERR_PS_FILE_UNCERTAIN" : "ERR_PS_FILE_FAILED";
    if (published) failure.sha256 = p.hash(bytes);
    throw failure;
  }
}
export const LOCK = "service.lock";
/** Host-local exclusion only. A stale or malformed lock always requires explicit intervention. */
export class ServiceLock {
  #dir;
  #identity;
  #wire;
  #closed = false;
  constructor(dir) {
    this.#dir = privateDirectory(dir);
    this.#wire = p.canonical({
      format: "zft-ps-service-lock-v1",
      host: hostname(),
      pid: process.pid,
      token: p.randomHex(32),
    });
    const fd = fs.openSync(
      join(dir, LOCK),
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      this.#identity = fs.fstatSync(fd);
      fs.writeFileSync(fd, this.#wire);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    syncDirectory(dir);
  }
  close() {
    if (this.#closed) return;
    sameDirectory(this.#dir);
    const path = join(this.#dir.dir, LOCK),
      s = fs.lstatSync(path);
    assert(
      s.dev === this.#identity.dev && s.ino === this.#identity.ino,
      "lock identity changed",
    );
    assert.equal(
      readPrivate(path, 2048).toString(),
      this.#wire,
      "lock contents changed",
    );
    fs.unlinkSync(path);
    syncDirectory(this.#dir.dir);
    this.#closed = true;
  }
}
export function inspectLock(dir) {
  privateDirectory(dir);
  const bytes = readPrivate(join(dir, LOCK), 2048),
    v = p.parse(bytes.toString(), 2048);
  p.fields(v, "format host pid token");
  assert.equal(v.format, "zft-ps-service-lock-v1");
  assert.equal(v.host, hostname(), "different host requires external fencing");
  p.bytes(v.token, 32);
  assert(Number.isSafeInteger(v.pid) && v.pid > 0, "lock pid");
  let dead = false;
  try {
    process.kill(v.pid, 0);
  } catch (e) {
    if (e.code === "ESRCH") dead = true;
    else throw e;
  }
  return Object.freeze({ sha256: p.hash(bytes), dead, pid: v.pid });
}
/** Caller selects the inspected lock hash; PID reuse conservatively blocks reclamation. */
export function reclaimDeadLock(dir, sha256) {
  p.bytes(sha256, 32);
  const selected = privateDirectory(dir),
    state = inspectLock(dir);
  assert(
    state.dead && state.sha256 === sha256,
    "selected owner is not confirmed dead",
  );
  sameDirectory(selected);
  assert.equal(inspectLock(dir).sha256, sha256);
  fs.unlinkSync(join(dir, LOCK));
  syncDirectory(dir);
}
