// Isolated create-only ciphertext storage. No serving-issuer or migration integration.
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  realpathSync,
  writeSync,
  readSync,
  fsyncSync,
  linkSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import * as p from "./profile.mjs";
import { PsKeyEnvelope, ENVELOPE_BYTES } from "./key-envelope.mjs";

export const KEY_FILE = "ps-keys.enc.json";
const fail = (code, sha256) =>
  Object.assign(new Error("PS key file " + code.toLowerCase()), {
    code: "ERR_PS_KEY_FILE_" + code,
    ...(sha256 ? { sha256 } : {}),
  });
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const privateOwner = (s) =>
  s.uid === process.getuid() && (s.mode & 0o077) === 0;
function withFd(fd, use) {
  let result, error;
  try {
    result = use(fd);
  } catch (e) {
    error = e;
  }
  try {
    closeSync(fd);
  } catch (e) {
    error ??= e;
  }
  if (error) throw error;
  return result;
}

/** Publish once without replacement; open only a caller-selected ciphertext digest. */
export class PsKeyFile {
  #dir;
  #identity;
  #envelope;
  #busy = false;
  #closed = false;

  constructor(directory, envelopeConfig) {
    try {
      if (typeof process.getuid !== "function") throw fail("CONFIG");
      this.#dir = resolve(directory);
      this.#identity = this.#directory();
      this.#envelope = new PsKeyEnvelope(envelopeConfig);
    } catch {
      throw fail("CONFIG");
    }
  }

  #directory() {
    const s = lstatSync(this.#dir);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      !privateOwner(s) ||
      realpathSync(this.#dir) !== this.#dir ||
      (this.#identity && !same(s, this.#identity))
    )
      throw fail("IO");
    return s;
  }

  #absent() {
    try {
      lstatSync(join(this.#dir, KEY_FILE));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    throw fail("EXISTS");
  }

  #start(options) {
    if (this.#closed) throw fail("CLOSED");
    if (this.#busy) throw fail("BUSY");
    if (
      !options ||
      (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    )
      throw fail("INPUT");
    if (options.signal?.aborted) throw fail("CANCELLED");
    this.#busy = true;
    return options.signal;
  }

  #syncDirectory() {
    this.#directory();
    withFd(
      openSync(
        this.#dir,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      ),
      (fd) => {
        if (!same(fstatSync(fd), this.#identity)) throw fail("IO");
        fsyncSync(fd);
      },
    );
  }

  #removeTemporary(path, identity) {
    this.#directory();
    if (!identity || !same(lstatSync(path), identity)) throw fail("IO");
    unlinkSync(path);
  }

  #publish(wire) {
    let temporary,
      identity,
      published = false;
    const bytes = Buffer.from(wire),
      sha256 = p.hash(bytes);
    try {
      this.#directory();
      this.#absent();
      temporary = join(
        this.#dir,
        ".ps-key-" + randomBytes(16).toString("hex") + ".tmp",
      );
      withFd(
        openSync(
          temporary,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        ),
        (fd) => {
          identity = fstatSync(fd);
          if (!identity.isFile() || !privateOwner(identity)) throw fail("IO");
          let offset = 0;
          while (offset < bytes.length) {
            const count = writeSync(
              fd,
              bytes,
              offset,
              bytes.length - offset,
              offset,
            );
            if (
              !Number.isInteger(count) ||
              count <= 0 ||
              count > bytes.length - offset
            )
              throw fail("IO");
            offset += count;
          }
          fsyncSync(fd);
        },
      );
      this.#directory();
      if (!same(lstatSync(temporary), identity)) throw fail("IO");
      // link is atomic and fails if the final name exists; rename would overwrite a winner.
      linkSync(temporary, join(this.#dir, KEY_FILE));
      published = true;
      this.#syncDirectory();
      this.#removeTemporary(temporary, identity);
      temporary = null;
      this.#syncDirectory();
      return Object.freeze({ sha256, bytes: bytes.length });
    } catch (error) {
      if (temporary) {
        try {
          this.#removeTemporary(temporary, identity);
        } catch {
          /* Leave orphan ciphertext if safe cleanup fails. */
        }
      }
      // Once visible, retain the final file. A later sync/cleanup failure is not rollback.
      throw fail(
        published
          ? "UNCERTAIN"
          : error.code === "EEXIST" || error.code === "ERR_PS_KEY_FILE_EXISTS"
            ? "EXISTS"
            : "IO",
        published ? sha256 : undefined,
      );
    }
  }

  /** Wrap, unwrap-check, and publish a new immutable record; never overwrite an existing path. */
  async create(secrets, options = {}) {
    const signal = this.#start(options);
    try {
      try {
        this.#directory();
        this.#absent();
      } catch (error) {
        throw fail(error.code === "ERR_PS_KEY_FILE_EXISTS" ? "EXISTS" : "IO");
      }
      const wire = await this.#envelope.seal(secrets, { signal });
      // Verify the returned wrapping blob is usable before putting any bytes on disk.
      await this.#envelope.open(wire, { signal });
      if (this.#closed) throw fail("CLOSED");
      if (signal?.aborted) {
        this.close();
        throw fail("CANCELLED");
      }
      return this.#publish(wire);
    } finally {
      this.#busy = false;
    }
  }

  /** Read a bounded private regular file, pin its digest, then authenticate its envelope. */
  async open(expectedSha256, options = {}) {
    const signal = this.#start(options);
    try {
      try {
        p.bytes(expectedSha256, 32);
      } catch {
        throw fail("INPUT");
      }
      let wire;
      try {
        this.#directory();
        wire = withFd(
          openSync(
            join(this.#dir, KEY_FILE),
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          ),
          (fd) => {
            const s = fstatSync(fd);
            if (
              !s.isFile() ||
              !privateOwner(s) ||
              s.size < 1 ||
              s.size > ENVELOPE_BYTES
            )
              throw fail("IO");
            const bytes = Buffer.alloc(ENVELOPE_BYTES + 1);
            let size = 0;
            while (size < bytes.length) {
              const count = readSync(
                fd,
                bytes,
                size,
                bytes.length - size,
                size,
              );
              if (count === 0) break;
              size += count;
            }
            if (size !== s.size || size > ENVELOPE_BYTES) throw fail("IO");
            const selected = bytes.subarray(0, size);
            if (p.hash(selected) !== expectedSha256) throw fail("DIGEST");
            return new TextDecoder("utf-8", { fatal: true }).decode(selected);
          },
        );
      } catch (error) {
        throw fail(
          error.code === "ERR_PS_KEY_FILE_DIGEST"
            ? "DIGEST"
            : error.code === "ENOENT"
              ? "MISSING"
              : "IO",
        );
      }
      return await this.#envelope.open(wire, { signal });
    } finally {
      this.#busy = false;
    }
  }

  /** Close the async envelope boundary; synchronous filesystem work cannot be preempted. */
  close() {
    this.#closed = true;
    this.#envelope.close();
  }
}
