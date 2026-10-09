import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PsKeyFile, KEY_FILE } from "./key-file.mjs";
import { ENVELOPE_BYTES } from "./key-envelope.mjs";
import { config, transport, secrets } from "./key-file-test-support.mjs";
import * as p from "./profile.mjs";
const worker = fileURLToPath(new URL("./key-file-worker.mjs", import.meta.url));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const error = (code) => (e) => {
  assert.equal(e.code, "ERR_PS_KEY_FILE_" + code);
  assert.equal(e.message, "PS key file " + code.toLowerCase());
  assert.equal(e.cause, undefined);
  return true;
};
function fixture(t) {
  const parent = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "zft-key-file-")),
  );
  const dir = join(parent, "keys");
  fs.mkdirSync(dir, { mode: 0o700 });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, dir, path: join(dir, KEY_FILE) };
}
function store(t, dir, provider = transport) {
  const s = new PsKeyFile(dir, { ...config, transport: provider });
  t.after(() => s.close());
  return s;
}
async function patched(replacements, run) {
  const originals = Object.fromEntries(
    Object.keys(replacements).map((k) => [k, fs[k]]),
  );
  for (const [key, replace] of Object.entries(replacements))
    fs[key] = replace(originals[key]);
  syncBuiltinESMExports();
  try {
    return await run();
  } finally {
    Object.assign(fs, originals);
    syncBuiltinESMExports();
  }
}
function child(t, dir, mode, gate) {
  const process = spawn(
    globalThis.process.execPath,
    ["--experimental-sqlite", worker, dir, mode, ...(gate ? [gate] : [])],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    stderr = "",
    exit,
    waiters = [];
  process.stdout.on("data", (b) => {
    output += b;
    for (const f of waiters.splice(0)) f();
  });
  process.stderr.on("data", (b) => {
    stderr += b;
  });
  const done = new Promise((resolve) =>
    process.once("exit", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
      for (const f of waiters.splice(0)) f();
    }),
  );
  t.after(async () => {
    if (!exit) process.kill("SIGKILL");
    await done;
  });
  return {
    process,
    done,
    async line() {
      const end = Date.now() + 15000;
      while (!output.includes("\n")) {
        assert(!exit, "worker exited early: " + stderr + output);
        assert(Date.now() < end, "worker timed out: " + stderr);
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 100);
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      const pos = output.indexOf("\n"),
        line = output.slice(0, pos);
      output = output.slice(pos + 1);
      return JSON.parse(line);
    },
  };
}

test("key file requires an existing canonical private directory", (t) => {
  const { parent, dir } = fixture(t);
  assert.throws(
    () => new PsKeyFile(join(parent, "missing"), { ...config, transport }),
    error("CONFIG"),
  );
  fs.chmodSync(dir, 0o755);
  assert.throws(
    () => new PsKeyFile(dir, { ...config, transport }),
    error("CONFIG"),
  );
  fs.chmodSync(dir, 0o700);
  const alias = join(parent, "alias");
  fs.symlinkSync(dir, alias);
  assert.throws(
    () => new PsKeyFile(alias, { ...config, transport }),
    error("CONFIG"),
  );
  assert.throws(
    () => new PsKeyFile(dir, { ...config, manifest: {}, transport }),
    error("CONFIG"),
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("key file publishes private ciphertext and reopens in a fresh process", async (t) => {
  const { dir, path } = fixture(t),
    s = store(t, dir),
    receipt = await s.create(secrets);
  const bytes = fs.readFileSync(path);
  assert.deepEqual(receipt, { sha256: p.hash(bytes), bytes: bytes.length });
  assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path).nlink, 1);
  assert.deepEqual(fs.readdirSync(dir), [KEY_FILE]);
  for (const scalar of Object.values(secrets))
    assert(!bytes.toString().includes(scalar), "no plaintext scalar on disk");
  assert.deepEqual(await s.open(receipt.sha256), secrets);
  const c = child(t, dir, "open", receipt.sha256);
  assert.deepEqual(await c.line(), { opened: true });
  assert.deepEqual(await c.done, { code: 0, signal: null });
});

test("key file refuses every existing final path before provider dispatch", async (t) => {
  for (const kind of ["file", "symlink", "directory"]) {
    const { dir, path } = fixture(t);
    let calls = 0;
    const s = store(t, dir, (r) => {
      calls++;
      return transport(r);
    });
    if (kind === "file") fs.writeFileSync(path, "existing", { mode: 0o600 });
    if (kind === "symlink") fs.symlinkSync("missing", path);
    if (kind === "directory") fs.mkdirSync(path);
    const before = fs.lstatSync(path);
    await assert.rejects(s.create(secrets), error("EXISTS"));
    assert.equal(calls, 0);
    assert.equal(fs.lstatSync(path).ino, before.ino);
    if (kind === "file")
      assert.equal(fs.readFileSync(path, "utf8"), "existing");
  }
});

test("key file pins ciphertext digest before unwrap", async (t) => {
  const { dir, path } = fixture(t);
  let calls = 0;
  const s = store(t, dir, (r) => {
    calls++;
    return transport(r);
  });
  await s.create(secrets);
  calls = 0;
  await assert.rejects(s.open("00".repeat(32)), error("DIGEST"));
  assert.equal(calls, 0, "wrong digest never dispatches");
  await assert.rejects(s.open("bad"), error("INPUT"));
  const v = JSON.parse(fs.readFileSync(path, "utf8"));
  v.tag = (v.tag.startsWith("00") ? "01" : "00") + v.tag.slice(2);
  fs.writeFileSync(path, p.canonical(v));
  await assert.rejects(s.open(p.hash(fs.readFileSync(path))), {
    code: "ERR_PS_KEY_ENVELOPE_RESPONSE",
  });
});

test("key file rejects unsafe bounded reads before unwrap", async (t) => {
  for (const kind of [
    "missing",
    "empty",
    "oversize",
    "public",
    "symlink",
    "directory",
    "fifo",
  ]) {
    const { parent, dir, path } = fixture(t);
    let calls = 0;
    const s = store(t, dir, (r) => {
      calls++;
      return transport(r);
    });
    if (kind === "empty") fs.writeFileSync(path, "", { mode: 0o600 });
    if (kind === "oversize")
      fs.writeFileSync(path, Buffer.alloc(ENVELOPE_BYTES + 1), { mode: 0o600 });
    if (kind === "public") {
      const r = await s.create(secrets);
      fs.chmodSync(path, 0o644);
      calls = 0;
      await assert.rejects(s.open(r.sha256), error("IO"));
      continue;
    }
    if (kind === "symlink") {
      fs.writeFileSync(join(parent, "target"), "{}", { mode: 0o600 });
      fs.symlinkSync(join(parent, "target"), path);
    }
    if (kind === "directory") fs.mkdirSync(path, { mode: 0o700 });
    if (kind === "fifo") execFileSync("mkfifo", ["-m", "600", path]);
    await assert.rejects(
      s.open("00".repeat(32)),
      error(kind === "missing" ? "MISSING" : "IO"),
    );
    assert.equal(calls, 0);
  }
});

test("key file validates unwrap before any disk publication", async (t) => {
  const { dir } = fixture(t);
  let ops = [];
  const s = store(t, dir, (r) => {
    ops.push(r.operation);
    if (r.operation === "unwrap") throw new Error("private provider detail");
    return transport(r);
  });
  await assert.rejects(s.create(secrets), {
    code: "ERR_PS_KEY_ENVELOPE_UNAVAILABLE",
  });
  assert.deepEqual(ops, ["wrap", "unwrap"]);
  assert.deepEqual(
    fs.readdirSync(dir),
    [],
    "denied unwrap cannot persist unusable record",
  );
  const denied = store(t, dir, () => {
    throw new Error("denied");
  });
  await assert.rejects(denied.create(secrets), {
    code: "ERR_PS_KEY_ENVELOPE_UNAVAILABLE",
  });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("key file detects directory replacement during provider work", async (t) => {
  const { parent, dir } = fixture(t);
  let changed = false;
  const s = store(t, dir, (r) => {
    if (!changed) {
      changed = true;
      fs.renameSync(dir, join(parent, "old"));
      fs.mkdirSync(dir, { mode: 0o700 });
    }
    return transport(r);
  });
  await assert.rejects(s.create(secrets), error("IO"));
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(fs.readdirSync(join(parent, "old")), []);
});

test("key file cancellation close and busy never publish pending work", async (t) => {
  const { dir } = fixture(t);
  let release, started;
  const ready = new Promise((r) => {
    started = r;
  });
  const s = store(
    t,
    dir,
    (r, { signal }) =>
      new Promise((resolve) => {
        release = () => resolve(transport(r));
        started(signal);
      }),
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    s.create(secrets, { signal: aborted.signal }),
    error("CANCELLED"),
  );
  const controller = new AbortController(),
    pending = s.create(secrets, { signal: controller.signal });
  const transportSignal = await ready;
  await assert.rejects(s.create(secrets), error("BUSY"));
  await assert.rejects(s.open("00".repeat(32)), error("BUSY"));
  controller.abort();
  await assert.rejects(pending, { code: "ERR_PS_KEY_ENVELOPE_CANCELLED" });
  assert.equal(transportSignal.aborted, true);
  release();
  await tick();
  assert.deepEqual(fs.readdirSync(dir), []);
  s.close();
  await assert.rejects(s.create(secrets), error("CLOSED"));
  const other = store(t, dir, async (r) => {
    other.close();
    return transport(r);
  });
  await assert.rejects(other.create(secrets), {
    code: "ERR_PS_KEY_ENVELOPE_CLOSED",
  });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("key file handles partial reads and writes", async (t) => {
  const { dir } = fixture(t),
    s = store(t, dir);
  await patched(
    {
      writeSync: (real) => (fd, b, o, n, pos) =>
        real(fd, b, o, Math.min(n, 13), pos),
      readSync: (real) => (fd, b, o, n, pos) =>
        real(fd, b, o, Math.min(n, 11), pos),
    },
    async () => {
      const r = await s.create(secrets);
      assert.deepEqual(await s.open(r.sha256), secrets);
    },
  );
});

test("key file syncs file and both directory transitions before success", async (t) => {
  const { dir } = fixture(t),
    s = store(t, dir),
    trace = [];
  await patched(
    {
      fsyncSync: (real) => (fd) => {
        trace.push(fs.fstatSync(fd).isDirectory() ? "dir-sync" : "file-sync");
        return real(fd);
      },
      linkSync:
        (real) =>
        (...a) => {
          trace.push("publish");
          return real(...a);
        },
      unlinkSync:
        (real) =>
        (...a) => {
          trace.push("cleanup");
          return real(...a);
        },
    },
    async () => {
      await s.create(secrets);
      trace.push("ack");
    },
  );
  assert.deepEqual(trace, [
    "file-sync",
    "publish",
    "dir-sync",
    "cleanup",
    "dir-sync",
    "ack",
  ]);
});

test("key file prepublication errors clean only owned temporary data", async (t) => {
  for (const failure of [
    "zero-write",
    "partial-write",
    "file-sync",
    "close",
    "link",
  ]) {
    const { dir, path } = fixture(t),
      s = store(t, dir);
    let first = true;
    const replacements = {};
    const injected = () => {
      throw Object.assign(new Error("private path and provider detail"), {
        code: "EIO",
      });
    };
    if (failure === "zero-write") replacements.writeSync = () => () => 0;
    if (failure === "partial-write")
      replacements.writeSync = (real) => (fd, b, o, n, pos) => {
        if (!first) injected();
        first = false;
        return real(fd, b, o, 3, pos);
      };
    if (failure === "file-sync") replacements.fsyncSync = () => injected;
    if (failure === "close")
      replacements.closeSync = (real) => (fd) => {
        real(fd);
        if (first) {
          first = false;
          injected();
        }
      };
    if (failure === "link") replacements.linkSync = () => injected;
    await patched(replacements, () =>
      assert.rejects(s.create(secrets), error("IO")),
    );
    assert.equal(fs.existsSync(path), false, failure);
    assert.deepEqual(fs.readdirSync(dir), [], failure);
  }
});

test("key file postpublication failures retain an explicit uncertain digest", async (t) => {
  for (const failure of ["first-sync", "unlink", "last-sync"]) {
    const { dir, path } = fixture(t),
      s = store(t, dir);
    let n = 0,
      uncertain;
    const replacements =
      failure === "unlink"
        ? {
            unlinkSync: () => () => {
              throw new Error("private cleanup detail");
            },
          }
        : {
            fsyncSync: (real) => (fd) => {
              if (
                fs.fstatSync(fd).isDirectory() &&
                ++n === (failure === "first-sync" ? 1 : 2)
              )
                throw new Error("private sync detail");
              return real(fd);
            },
          };
    await patched(replacements, async () => {
      await assert.rejects(s.create(secrets), (e) => {
        uncertain = e;
        return error("UNCERTAIN")(e);
      });
    });
    assert.equal(uncertain.sha256, p.hash(fs.readFileSync(path)), failure);
    assert.deepEqual(await s.open(uncertain.sha256), secrets);
    await assert.rejects(s.create(secrets), error("EXISTS"));
    if (failure === "unlink")
      assert.equal(
        fs.readdirSync(dir).length,
        2,
        "orphan retained when cleanup refused",
      );
  }
});

test("key file leaves failed cleanup orphans inert and never adopts them", async (t) => {
  const { dir, path } = fixture(t),
    s = store(t, dir);
  await patched(
    {
      fsyncSync: () => () => {
        throw new Error("original");
      },
      unlinkSync: () => () => {
        throw new Error("cleanup");
      },
    },
    () => assert.rejects(s.create(secrets), error("IO")),
  );
  const [orphan] = fs.readdirSync(dir);
  assert.match(orphan, /^\.ps-key-[a-f0-9]{32}\.tmp$/);
  const bytes = fs.readFileSync(join(dir, orphan));
  assert(bytes.length > 0);
  await assert.rejects(s.open(p.hash(bytes)), error("MISSING"));
  const receipt = await s.create(secrets);
  assert.deepEqual(await s.open(receipt.sha256), secrets);
  assert.deepEqual(fs.readFileSync(join(dir, orphan)), bytes);
  assert.notDeepEqual(fs.readFileSync(path), bytes);
});

test("key file refuses to unlink a substituted temporary inode", async (t) => {
  const { dir } = fixture(t),
    s = store(t, dir);
  let temporary;
  await patched(
    {
      linkSync: () => (path) => {
        temporary = path;
        fs.renameSync(path, path + ".original");
        fs.writeFileSync(path, "replacement", { mode: 0o600 });
        throw new Error("link failed");
      },
    },
    () => assert.rejects(s.create(secrets), error("IO")),
  );
  assert(fs.existsSync(temporary), "substituted inode must not be removed");
  assert.equal(fs.readFileSync(temporary, "utf8"), "replacement");
  assert.equal(fs.existsSync(temporary + ".original"), true);
});

test("key file concurrent publishers cannot replace the winning record", async (t) => {
  const { parent, dir, path } = fixture(t),
    gate = join(parent, "go");
  const children = [child(t, dir, "race", gate), child(t, dir, "race", gate)];
  assert.deepEqual(await Promise.all(children.map((c) => c.line())), [
    { stage: "ready" },
    { stage: "ready" },
  ]);
  fs.writeFileSync(gate, "");
  const results = await Promise.all(children.map((c) => c.line()));
  const winners = results.filter((r) => r.result),
    losers = results.filter((r) => r.error);
  assert.equal(winners.length, 1, "exactly one writer wins");
  assert.deepEqual(losers, [{ error: "ERR_PS_KEY_FILE_EXISTS" }]);
  assert.equal(p.hash(fs.readFileSync(path)), winners[0].result.sha256);
  assert.deepEqual(fs.readdirSync(dir), [KEY_FILE]);
  const s = store(t, dir);
  assert.deepEqual(await s.open(winners[0].result.sha256), secrets);
  const exits = await Promise.all(children.map((c) => c.done));
  assert.deepEqual(exits.map((x) => x.code).sort(), [0, 2]);
});

for (const stage of [
  "temp-open",
  "temp-write",
  "file-sync",
  "publish",
  "published-sync",
  "cleanup",
  "cleanup-sync",
]) {
  test(
    "key file SIGKILL at " + stage + " leaves no partial final record",
    async (t) => {
      const { dir, path } = fixture(t),
        c = child(t, dir, stage);
      assert.deepEqual(await c.line(), { stage });
      c.process.kill("SIGKILL");
      assert.deepEqual(await c.done, { code: null, signal: "SIGKILL" });
      const names = fs.readdirSync(dir),
        s = store(t, dir);
      if (["temp-open", "temp-write", "file-sync"].includes(stage)) {
        assert.equal(
          fs.existsSync(path),
          false,
          "prepublish crash has no final file",
        );
        assert.equal(names.length, 1, "one inert orphan");
        await assert.rejects(s.open("00".repeat(32)), error("MISSING"));
        const r = await s.create(secrets);
        assert.deepEqual(await s.open(r.sha256), secrets);
        assert(
          fs.existsSync(join(dir, names[0])),
          "old orphan is never adopted or removed",
        );
      } else {
        const hash = p.hash(fs.readFileSync(path)); // Test inspection only, not an operator freshness assertion.
        assert.deepEqual(
          await s.open(hash),
          secrets,
          "postpublish record fully authenticates",
        );
        await assert.rejects(s.create(secrets), error("EXISTS"));
        assert.equal(
          fs.readdirSync(dir).length,
          ["cleanup", "cleanup-sync"].includes(stage) ? 1 : 2,
        );
      }
    },
  );
}
