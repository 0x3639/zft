import assert from "node:assert/strict";
import { test } from "node:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as p from "./profile.mjs";
import { secrets, realm, wallet, nonce, asset } from "./test-support.mjs";
import {
  PsKeyEnvelope,
  KEY_ENVELOPE,
  KEY_REQUEST,
  KEY_RESPONSE,
  ENVELOPE_BYTES,
  WRAPPED_KEY_BYTES,
} from "./key-envelope.mjs";

const manifest = p.manifest(realm, secrets);
const configurationId = "73".repeat(32);
const keyId = "test-only/wrapping-key-v1";
const kek = Buffer.alloc(32, 7); // Public test wrapping key, never a deployment key.
const tick = () => new Promise((resolve) => setImmediate(resolve));
const error = (code) => (e) => {
  assert.equal(e.code, "ERR_PS_KEY_ENVELOPE_" + code);
  assert.equal(e.message, "PS key envelope " + code.toLowerCase());
  assert.equal(e.cause, undefined);
  return true;
};
function provider(request) {
  const context = Buffer.from(request.context);
  let material;
  if (request.operation === "wrap") {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", kek, iv);
    cipher.setAAD(context);
    material = Buffer.concat([
      iv,
      cipher.update(request.material),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  } else {
    const value = Buffer.from(request.material);
    const cipher = createDecipheriv("aes-256-gcm", kek, value.subarray(0, 12));
    cipher.setAAD(context);
    cipher.setAuthTag(value.subarray(-16));
    material = Buffer.concat([
      cipher.update(value.subarray(12, -16)),
      cipher.final(),
    ]);
  }
  return {
    format: KEY_RESPONSE,
    operation: request.operation,
    key_id: request.key_id,
    material,
  };
}
function adapter(transport = provider, extra = {}) {
  return new PsKeyEnvelope({
    manifest,
    configurationId,
    keyId,
    transport,
    ...extra,
  });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function change(wire, update) {
  const value = JSON.parse(wire);
  update(value);
  return p.canonical(value);
}
function flip(hex) {
  return (hex.startsWith("00") ? "01" : "00") + hex.slice(2);
}
function block(ms) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* Intentional event-loop blocking fixture. */
  }
}
async function knownRecord() {
  let key;
  const wire = await adapter((r) => {
    key = Buffer.from(r.material);
    return provider(r);
  }).seal(secrets);
  const transport = (r) => ({
    format: KEY_RESPONSE,
    operation: "unwrap",
    key_id: r.key_id,
    material: key,
  });
  return { wire, key, transport };
}
function authenticatedPayload(wire, key, payload) {
  const value = JSON.parse(wire);
  const cipher = createCipheriv("aes-256-gcm", key, p.bytes(value.iv, 12));
  cipher.setAAD(
    p.utf8(
      p.canonical({
        scope: value.scope,
        wrapped_key: value.wrapped_key,
        iv: value.iv,
      }),
    ),
  );
  value.ciphertext = Buffer.concat([
    cipher.update(payload),
    cipher.final(),
  ]).toString("hex");
  value.tag = cipher.getAuthTag().toString("hex");
  return p.canonical(value);
}

test("key envelope validates pinned constructor identity before transport", () => {
  let calls = 0;
  const config = {
    manifest,
    configurationId,
    keyId,
    transport: () => {
      calls++;
    },
  };
  for (const patch of [
    { manifest: { ...manifest, keyset_id: "00".repeat(33) } },
    { manifest: { ...manifest, public_key: "00".repeat(336) } },
    { manifest: { ...manifest, realm: "x" } },
    { manifest: { ...manifest, extra: 1 } },
    { configurationId: "" },
    { configurationId: "AB".repeat(32) },
    { keyId: "" },
    { keyId: "bad\nkey" },
    { keyId: "a".repeat(2049) },
    { timeoutMs: 99 },
    { timeoutMs: 5001 },
    { timeoutMs: NaN },
    { transport: null },
  ])
    assert.throws(
      () => new PsKeyEnvelope({ ...config, ...patch }),
      error("CONFIG"),
    );
  assert.throws(() => new PsKeyEnvelope(null), error("CONFIG"));
  assert.equal(calls, 0);
});

test("key envelope round trips exact scalars with fresh data keys and IVs", async () => {
  const keys = [],
    contexts = [];
  const s = adapter((r, options) => {
    assert.equal(r.format, KEY_REQUEST);
    assert(Object.isFrozen(r));
    assert(options.signal instanceof AbortSignal);
    contexts.push(r.context);
    if (r.operation === "wrap")
      keys.push(Buffer.from(r.material).toString("hex"));
    return provider(r);
  });
  const a = await s.seal(secrets),
    b = await s.seal(secrets);
  assert.deepEqual(await s.open(a), secrets);
  assert.deepEqual(await s.open(b), secrets);
  assert.notEqual(keys[0], keys[1]);
  assert.notEqual(JSON.parse(a).iv, JSON.parse(b).iv);
  assert.notEqual(a, b);
  assert(contexts.every((v) => v === contexts[0]));
  assert.equal(JSON.parse(contexts[0]).format, KEY_ENVELOPE);
  for (const value of [...Object.values(secrets), ...keys])
    assert(!a.includes(value));
});

test("key envelope rejects invalid or mismatched scalars before wrap", async () => {
  let calls = 0;
  const s = adapter((r) => {
    calls++;
    return provider(r);
  });
  for (const value of [
    null,
    {},
    { ...secrets, extra: "x" },
    { ...secrets, x: "00".repeat(32) },
    { ...secrets, x: "ff".repeat(32) },
    { ...secrets, x: p.scalarHex(42n) },
    { ...secrets, x: secrets.x.toUpperCase() },
    { ...secrets, x: "ab".repeat(10000) },
  ]) {
    await assert.rejects(s.seal(value), error("INPUT"));
  }
  assert.equal(calls, 0);
});

test("key envelope snapshots caller secrets and constructor configuration", async () => {
  const input = { ...secrets },
    config = {
      manifest: { ...manifest },
      configurationId,
      keyId,
      transport: provider,
    };
  const s = new PsKeyEnvelope(config);
  const pending = s.seal(input);
  input.x = p.scalarHex(42n);
  config.manifest.realm = "00".repeat(32);
  config.keyId = "wrong";
  const wire = await pending;
  assert.deepEqual(await s.open(wire), secrets);
  assert.equal(JSON.parse(wire).scope.wrapping_key_id, keyId);
});

test("key envelope isolates encryption key from transport mutation", async () => {
  const s = adapter((r) => {
    if (r.operation === "wrap") r.material.fill(0);
    return provider(r);
  });
  const wire = await s.seal(secrets);
  await assert.rejects(s.open(wire), error("RESPONSE"));
});

test("key envelope rejects scope substitution before unwrap", async () => {
  const wire = await adapter().seal(secrets);
  let calls = 0;
  const s = adapter((r) => {
    calls++;
    return provider(r);
  });
  for (const [field, value] of [
    ["configuration_id", "00".repeat(32)],
    ["wrapping_key_id", "test-only/other"],
    ["purpose", "status-key"],
    ["format", "v0"],
    ["algorithm", "AES-128-GCM"],
    ["manifest", { ...manifest, realm: "00".repeat(32) }],
  ]) {
    await assert.rejects(
      s.open(
        change(wire, (v) => {
          v.scope[field] = value;
        }),
      ),
      error("INPUT"),
    );
  }
  await assert.rejects(
    s.open(
      change(wire, (v) => {
        v.scope.extra = true;
      }),
    ),
    error("INPUT"),
  );
  assert.equal(calls, 0);
});

test("key envelope rejects noncanonical and malformed records before unwrap", async () => {
  const wire = await adapter().seal(secrets);
  let calls = 0;
  const s = adapter((r) => {
    calls++;
    return provider(r);
  });
  for (const input of [
    "",
    null,
    {},
    wire + "\n",
    JSON.stringify(JSON.parse(wire), null, 2),
    '{"tag":"00",' + wire.slice(1),
    change(wire, (v) => {
      v.extra = 1;
    }),
    change(wire, (v) => {
      delete v.tag;
    }),
    change(wire, (v) => {
      v.iv = "00";
    }),
    change(wire, (v) => {
      v.tag = "00".repeat(15);
    }),
    change(wire, (v) => {
      v.ciphertext = v.ciphertext.toUpperCase();
    }),
  ]) {
    await assert.rejects(s.open(input), error("INPUT"));
  }
  assert.equal(calls, 0);
});

test("key envelope bounds serialized records wrapped keys and ciphertext before unwrap", async () => {
  const wire = await adapter().seal(secrets);
  let calls = 0;
  const s = adapter((r) => {
    calls++;
    return provider(r);
  });
  for (const input of [
    " ".repeat(ENVELOPE_BYTES + 1),
    change(wire, (v) => {
      v.wrapped_key = "ab".repeat(WRAPPED_KEY_BYTES + 1);
    }),
    change(wire, (v) => {
      v.wrapped_key = "";
    }),
    change(wire, (v) => {
      v.ciphertext = "ab".repeat(513);
    }),
    change(wire, (v) => {
      v.ciphertext = "";
    }),
  ]) {
    await assert.rejects(s.open(input), error("INPUT"));
  }
  assert.equal(calls, 0);
});

test("key envelope authenticates ciphertext IV tag and wrapped key", async () => {
  const { wire, transport } = await knownRecord();
  for (const field of ["ciphertext", "iv", "tag", "wrapped_key"]) {
    const s = adapter(transport); // Always supplies correct original DEK, isolating record AEAD checks.
    await assert.rejects(
      s.open(
        change(wire, (v) => {
          v[field] = flip(v[field]);
        }),
      ),
      error("RESPONSE"),
    );
  }
  const other = adapter(transport, { configurationId: "74".repeat(32) });
  await assert.rejects(
    other.open(
      change(wire, (v) => {
        v.scope.configuration_id = "74".repeat(32);
      }),
    ),
    error("RESPONSE"),
  );
});

test("key envelope validates authenticated plaintext against full pinned manifest", async () => {
  const { wire, key, transport } = await knownRecord();
  for (const payload of [
    p.canonical({ ...secrets, x: p.scalarHex(42n) }),
    p.canonical({ ...secrets, x: "00".repeat(32) }),
    p.canonical({ ...secrets, extra: true }),
    p.canonical(secrets) + "\n",
    Buffer.from([0xff, 0xfe]),
    "{}",
  ]) {
    await assert.rejects(
      adapter(transport).open(authenticatedPayload(wire, key, payload)),
      error("RESPONSE"),
    );
  }
});

test("key envelope validates transport metadata and owned bounded byte responses", async () => {
  const wire = await adapter().seal(secrets);
  const patches = [
    (v) => ({ ...v, format: "other" }),
    (v) => ({ ...v, operation: "wrong" }),
    (v) => ({ ...v, key_id: "other" }),
    (v) => ({ ...v, extra: 1 }),
    (v) => ({ ...v, material: "secret" }),
    (v) => ({ ...v, material: new Uint8Array() }),
    (v) => ({ ...v, material: new Uint8Array(4097) }),
    (v) => ({ ...v, material: new Uint8Array(new SharedArrayBuffer(32)) }),
    () => null,
  ];
  for (const patch of patches) {
    const s = adapter((r) => patch(provider(r)));
    await assert.rejects(s.seal(secrets), error("RESPONSE"));
    await assert.rejects(s.open(wire), error("RESPONSE"));
  }
  for (const size of [31, 33])
    await assert.rejects(
      adapter((r) => ({ ...provider(r), material: new Uint8Array(size) })).open(
        wire,
      ),
      error("RESPONSE"),
    );
  const s = adapter((r) => {
    const response = provider(r);
    response.material[Symbol.iterator] = function* () {
      yield 0;
    };
    return response;
  });
  assert.deepEqual(await s.open(await s.seal(secrets)), secrets);
});

test("key envelope accepts bounded opaque wrapped-key byte lengths", async () => {
  for (const length of [1, WRAPPED_KEY_BYTES]) {
    const s = adapter((r) => ({
      format: KEY_RESPONSE,
      operation: r.operation,
      key_id: r.key_id,
      material: new Uint8Array(length).fill(8),
    }));
    const wire = await s.seal(secrets);
    assert.equal(JSON.parse(wire).wrapped_key.length, length * 2);
    assert(Buffer.byteLength(wire) <= ENVELOPE_BYTES);
  }
});

test("key envelope scrubs denied wrap and unwrap errors without retry or plaintext fallback", async () => {
  const wire = await adapter().seal(secrets);
  for (const asynchronous of [false, true]) {
    let calls = 0;
    const s = adapter(() => {
      calls++;
      const e = new Error("provider-private-diagnostic", {
        cause: "secret-value",
      });
      if (asynchronous) return Promise.reject(e);
      throw e;
    });
    await assert.rejects(s.seal(secrets), error("UNAVAILABLE"));
    assert.equal(calls, 1);
    await assert.rejects(s.open(wire), error("UNAVAILABLE"));
    assert.equal(calls, 2);
  }
});

test("key envelope refuses concurrent work without queueing", async () => {
  const pending = deferred();
  let request,
    calls = 0;
  const s = adapter((r) => {
    request = r;
    calls++;
    return pending.promise;
  });
  const first = s.seal(secrets);
  await tick();
  await assert.rejects(s.seal(secrets), error("BUSY"));
  await assert.rejects(s.open("{}"), error("BUSY"));
  assert.equal(calls, 1);
  pending.resolve(provider(request));
  await first;
});

test("key envelope absolute deadline rejects late unwrap and closes instance", async () => {
  const wire = await adapter().seal(secrets);
  const pending = deferred();
  let response,
    signal,
    calls = 0;
  const s = adapter(
    (r, options) => {
      calls++;
      response = provider(r);
      signal = options.signal;
      return pending.promise;
    },
    { timeoutMs: 100 },
  );
  const opening = s.open(wire);
  setTimeout(() => pending.resolve(response), 180);
  await assert.rejects(opening, error("TIMEOUT"));
  assert(signal.aborted);
  await assert.rejects(s.open(wire), error("CLOSED"));
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(calls, 1);
});

test("key envelope rejects valid unwrap after synchronous event-loop stall", async () => {
  const wire = await adapter().seal(secrets);
  const s = adapter(
    (r) => {
      const result = provider(r);
      block(130);
      return result;
    },
    { timeoutMs: 100 },
  );
  await assert.rejects(s.open(wire), error("TIMEOUT"));
});

test("key envelope checks deadline before dispatch", async () => {
  let calls = 0;
  const s = adapter(
    (r) => {
      calls++;
      return provider(r);
    },
    { timeoutMs: 100 },
  );
  const pending = s.seal(secrets);
  block(130);
  await assert.rejects(pending, error("TIMEOUT"));
  assert.equal(calls, 0);
});

test("key envelope validates signal and leaves pre-aborted idle instance usable", async () => {
  let calls = 0;
  const s = adapter((r) => {
    calls++;
    return provider(r);
  });
  for (const opts of [null, { signal: {} }])
    await assert.rejects(s.seal(secrets, opts), error("INPUT"));
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    s.seal(secrets, { signal: c.signal }),
    error("CANCELLED"),
  );
  assert.equal(calls, 0);
  await s.seal(secrets);
  assert.equal(calls, 1);
});

test("key envelope active cancellation consumes late rejection and permanently closes", async () => {
  const pending = deferred(),
    c = new AbortController();
  let signal;
  const s = adapter((r, options) => {
    signal = options.signal;
    return pending.promise;
  });
  const sealing = s.seal(secrets, { signal: c.signal });
  await tick();
  c.abort();
  await assert.rejects(sealing, error("CANCELLED"));
  assert(signal.aborted);
  pending.reject(new Error("late-provider-secret"));
  await tick();
  await assert.rejects(s.seal(secrets), error("CLOSED"));
});

test("key envelope close before and after dispatch discards work", async () => {
  for (const dispatched of [false, true]) {
    const d = deferred();
    let calls = 0;
    const s = adapter(() => {
      calls++;
      return d.promise;
    });
    const pending = s.seal(secrets);
    if (dispatched) await tick();
    s.close();
    s.close();
    await assert.rejects(pending, error("CLOSED"));
    d.resolve({ material: new Uint8Array(32) });
    await tick();
    assert.equal(calls, Number(dispatched));
    await assert.rejects(s.open("{}"), error("CLOSED"));
  }
});

test("key envelope rejects wrong unwrap key and does not alter retained ciphertext", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zft envelope failure "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wire = await adapter().seal(secrets),
    path = join(dir, "keys.enc.json");
  writeFileSync(path, wire, { mode: 0o600, flag: "wx" });
  await assert.rejects(
    adapter((r) => ({ ...provider(r), material: Buffer.alloc(32) })).open(
      readFileSync(path, "utf8"),
    ),
    error("RESPONSE"),
  );
  assert.equal(readFileSync(path, "utf8"), wire);
  assert.deepEqual(readdirSync(dir), ["keys.enc.json"]);
});

test("key envelope persisted ciphertext reopens in a new process and preserves issuer behavior", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zft envelope restart "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "keys.enc.json"),
    s = adapter();
  writeFileSync(path, await s.seal(secrets), { mode: 0o600, flag: "wx" });
  s.close();
  const base = new URL("./", import.meta.url).href;
  const code = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
    import { join } from 'node:path';
    import * as p from ${JSON.stringify(new URL("./profile.mjs", base).href)};
    import { PsKeyEnvelope, KEY_RESPONSE } from ${JSON.stringify(new URL("./key-envelope.mjs", base).href)};
    import { Issuer } from ${JSON.stringify(new URL("./issuer.mjs", base).href)};
    import { Client } from ${JSON.stringify(new URL("./client.mjs", base).href)};
    const kek=Buffer.alloc(32,7), provider=${provider.toString()};
    const config=JSON.parse(process.argv[2]);
    const opened=await new PsKeyEnvelope({...config,transport:provider}).open(readFileSync(process.argv[1],'utf8'));
    const issuer=new Issuer(join(process.argv[3],'issuer.db'),config.manifest.realm,opened);
    const client=new Client(join(process.argv[3],'client.db'),config.manifest);
    try {
      assert.deepEqual(issuer.pinned.manifest,config.manifest);
      const bytes=p.utf8('disposable envelope restart asset');
      const op=client.prepareIssue(issuer.session('issue'),bytes);
      client.acknowledge(op,p.hash(client.backup(op)));
      const id=client.submit(op,issuer), wallet=${JSON.stringify(wallet)}, nonce=${JSON.stringify(nonce)};
      const result=issuer.checkShowing(client.show(id,wallet,nonce),wallet,nonce,p.assetValue(bytes,issuer.pinned));
      assert.equal(result.state,'unspent'); assert.equal(result.walletAuthenticated,false);
      process.stdout.write('reopened and verified');
    } finally {client.close();issuer.close();}
  `;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const out = execFileSync(
    process.execPath,
    [
      "--experimental-sqlite",
      "--input-type=module",
      "-e",
      code,
      path,
      JSON.stringify({ manifest, configurationId, keyId }),
      dir,
    ],
    {
      env,
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(out, "reopened and verified");
  assert(!readdirSync(dir).includes("private.json"));
});
