import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { ProtectedRecord, RECORD_LIMITS } from "./protected-record.mjs";
import { config, transport } from "../local/key-file-test-support.mjs";
import * as p from "../local/profile.mjs";
const input = Buffer.from("private session material");
const tick = () => new Promise((r) => setImmediate(r));
const options = {
  ...config,
  purpose: "session",
  recordId: "81".repeat(32),
  transport,
};
const adapter = (t, extra = {}) => {
  const r = new ProtectedRecord({ ...options, ...extra });
  t.after(() => r.close());
  return r;
};
const code = (c) => ({ code: "ERR_PS_RECORD_" + c });
const change = (wire, mutate) => {
  const v = JSON.parse(wire);
  mutate(v);
  return p.canonical(v);
};
const flip = (h) => (h.startsWith("00") ? "01" : "00") + h.slice(2);

test("protected record roundtrip owns bytes and samples fresh key and IV", async (t) => {
  const r = adapter(t),
    copy = Buffer.from(input),
    pending = r.seal(copy);
  copy.fill(0);
  const a = await pending,
    b = await r.seal(input);
  assert.notEqual(a, b);
  assert.notEqual(JSON.parse(a).iv, JSON.parse(b).iv);
  assert.notEqual(JSON.parse(a).wrapped_key, JSON.parse(b).wrapped_key);
  assert.deepEqual(Buffer.from(await r.open(a)), input);
  assert(!a.includes(input.toString("hex")));
  const out = await r.open(a);
  out.fill(0);
  assert.deepEqual(Buffer.from(await r.open(a)), input);
});
test("protected record context substitution fails before unwrap", async (t) => {
  const r = adapter(t),
    wire = await r.seal(input);
  let calls = 0;
  for (const extra of [
    { recordId: "82".repeat(32) },
    { purpose: "backup" },
    { configurationId: "83".repeat(32) },
    { keyId: "other" },
  ]) {
    const other = adapter(t, {
      ...extra,
      transport: (req) => {
        calls++;
        return transport(req);
      },
    });
    await assert.rejects(other.open(wire), code("INPUT"));
  }
  assert.equal(calls, 0);
});
test("protected record rejects tampered authenticated content", async (t) => {
  const r = adapter(t),
    wire = await r.seal(input);
  for (const field of ["iv", "tag", "ciphertext", "wrapped_key"]) {
    await assert.rejects(
      r.open(
        change(wire, (v) => {
          v[field] = flip(v[field]);
        }),
      ),
      (e) => {
        assert(
          ["ERR_PS_RECORD_RESPONSE", "ERR_PS_RECORD_UNAVAILABLE"].includes(
            e.code,
          ),
        );
        return true;
      },
    );
  }
  assert.deepEqual(Buffer.from(await r.open(wire)), input);
});
test("protected record bounds inputs and rejects ambiguous encodings", async (t) => {
  const r = adapter(t);
  for (const value of [
    Buffer.alloc(0),
    Buffer.alloc(RECORD_LIMITS.session + 1),
    "secret",
    new Uint8Array(new SharedArrayBuffer(4)),
  ])
    await assert.rejects(r.seal(value), code("INPUT"));
  const wire = await r.seal(input);
  for (const bad of [
    wire + " ",
    change(wire, (v) => {
      v.extra = true;
    }),
    change(wire, (v) => {
      v.ciphertext = "00".repeat(513);
    }),
    change(wire, (v) => {
      v.tag = v.tag.toUpperCase();
    }),
  ])
    await assert.rejects(r.open(bad), code("INPUT"));
  assert.throws(
    () => new ProtectedRecord({ ...options, purpose: "issuer-scalars" }),
    code("CONFIG"),
  );
});
test("protected record verifies response identity and sanitizes errors", async (t) => {
  for (const field of ["format", "operation", "key_id"]) {
    const r = adapter(t, {
      transport: (req) => ({ ...transport(req), [field]: "wrong" }),
    });
    await assert.rejects(r.seal(input), code("RESPONSE"));
  }
  for (const material of [
    "x",
    new Uint8Array(new SharedArrayBuffer(32)),
    Buffer.alloc(4097),
  ]) {
    const r = adapter(t, {
      transport: (req) => ({ ...transport(req), material }),
    });
    await assert.rejects(r.seal(input), code("RESPONSE"));
  }
  const r = adapter(t, {
    transport: () => {
      throw new Error("credentials and internal location");
    },
  });
  await assert.rejects(r.seal(input), (e) => {
    assert.equal(e.code, "ERR_PS_RECORD_UNAVAILABLE");
    assert.equal(e.message, "PS record unavailable");
    assert.equal(e.cause, undefined);
    return true;
  });
});
test("protected record isolates provider material from actual encryption key", async (t) => {
  const r = adapter(t, {
    transport: (req) => {
      if (req.operation === "wrap") req.material.fill(7);
      return transport(req);
    },
  });
  const wire = await r.seal(input);
  await assert.rejects(r.open(wire), code("RESPONSE"));
});
test("protected record ignores custom iterators on selected byte views", async (t) => {
  const r = adapter(t),
    value = Buffer.from(input);
  value[Symbol.iterator] = function* () {
    yield 0;
  };
  assert.deepEqual(Buffer.from(await r.open(await r.seal(value))), input);
});
test("protected record active abort discards late results and closes", async (t) => {
  let resolve, seen;
  const r = adapter(t, {
    transport: (req, { signal }) => {
      seen = signal;
      return new Promise((ok) => {
        resolve = () => ok(transport(req));
      });
    },
  });
  const c = new AbortController(),
    pending = r.seal(input, { signal: c.signal });
  await tick();
  await assert.rejects(r.seal(input), code("BUSY"));
  c.abort();
  await assert.rejects(pending, code("CANCELLED"));
  assert(seen.aborted);
  resolve();
  await tick();
  await assert.rejects(r.seal(input), code("CLOSED"));
});
test("protected record preaborted input leaves idle instance usable", async (t) => {
  const r = adapter(t),
    c = new AbortController();
  c.abort();
  await assert.rejects(r.seal(input, { signal: c.signal }), code("CANCELLED"));
  assert.deepEqual(Buffer.from(await r.open(await r.seal(input))), input);
});
test("protected record monotonic deadline rejects a blocking late provider", async (t) => {
  const r = adapter(t, {
    timeoutMs: 100,
    transport: (req) => {
      const end = performance.now() + 140;
      while (performance.now() < end) {}
      return transport(req);
    },
  });
  await assert.rejects(r.seal(input), code("TIMEOUT"));
  await assert.rejects(r.seal(input), code("CLOSED"));
});
test("protected record stalled provider times out and explicit close aborts", async (t) => {
  const a = adapter(t, {
    timeoutMs: 100,
    transport: () => new Promise(() => {}),
  });
  await assert.rejects(a.seal(input), code("TIMEOUT"));
  let signal;
  const b = adapter(t, {
    transport: (r, o) => {
      signal = o.signal;
      return new Promise(() => {});
    },
  });
  const pending = b.seal(input);
  await tick();
  b.close();
  await assert.rejects(pending, code("CLOSED"));
  assert(signal.aborted);
});
test("protected backup record preserves binary archive bytes and is role separated", async (t) => {
  const r = adapter(t, { purpose: "backup" }),
    bytes = Buffer.alloc(16384);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const wire = await r.seal(bytes);
  assert.deepEqual(Buffer.from(await r.open(wire)), bytes);
  await assert.rejects(adapter(t).open(wire), code("INPUT"));
});
