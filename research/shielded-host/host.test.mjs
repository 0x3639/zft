import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { canonical } from "../shielded-lab/core.mjs";
import {
  selectedConfiguration,
  readArtifacts,
  sources,
  SHA256,
} from "./artifacts.mjs";
import { handle, ORIGIN } from "./worker.mjs";
const text = readFileSync(
  new URL("../shielded-devnet/evidence/app-config.json", import.meta.url),
  "utf8",
);
const entry = { bytes: 4, type: "text/javascript", sha256: SHA256("test") };
const manifest = {
  files: {
    "/shielded/index.html": { ...entry, type: "text/html" },
    "/shielded/assets/app.js": entry,
    "/shielded/config.json": { ...entry, type: "application/json" },
    "/shielded-assets/create-key": entry,
  },
};
function assets() {
  const calls = [];
  return {
    calls,
    ASSETS: {
      fetch: async (req) => {
        calls.push(req);
        return new Response("test");
      },
    },
  };
}
test("selection rejects changed RPC, chain, genesis, registry and noncanonical config", () => {
  assert.equal(selectedConfiguration(text).pins.chainId, "7340469");
  for (const mutate of [
    (c) => (c.rpc = "https://example.org"),
    (c) => (c.pins.chainId = "1"),
    (c) => (c.pins.genesisHash = "0x" + "11".repeat(32)),
    (c) => (c.pins.contracts.registry.address = "0x" + "12".repeat(20)),
  ]) {
    const c = JSON.parse(text);
    mutate(c);
    assert.throws(() => selectedConfiguration(canonical(c)));
  }
  assert.throws(() => selectedConfiguration(text + "\n"));
});
test("artifact packaging checks every exact byte pin and never replaces missing material", () => {
  const directory = mkdtempSync(join(tmpdir(), "zft-host-artifacts-"));
  const c = JSON.parse(text);
  try {
    for (const [name, p] of Object.entries(sources)) {
      const data = Buffer.from(name);
      mkdirSync(dirname(join(directory, p)), { recursive: true });
      writeFileSync(join(directory, p), data);
      c.artifacts[name].bytes = data.length;
      c.artifacts[name].sha256 = SHA256(data);
    }
    assert.equal(readArtifacts(c, directory).length, 7);
    const source = join(directory, sources.library);
    const before = readFileSync(source);
    writeFileSync(source, Buffer.alloc(before.length, 1));
    assert.throws(() => readArtifacts(c, directory), /hash mismatch/);
    writeFileSync(source, Buffer.concat([before, Buffer.from("x")]));
    assert.throws(() => readArtifacts(c, directory), /size\/type/);
    rmSync(source);
    assert.throws(() => readArtifacts(c, directory));
  } finally {
    rmSync(directory, { recursive: true });
  }
});
test("static worker serves only exact routes and package allowlist, never RPC/legacy fallback", async () => {
  const a = assets();
  for (const path of [
    "/shielded",
    "/shielded/",
    "/shielded/create",
    "/shielded/claim",
    "/shielded/recovery",
    "/shielded/assets/app.js",
    "/shielded-assets/create-key",
  ])
    assert.equal(
      (await handle(new Request(ORIGIN + path), a, manifest)).status,
      200,
    );
  for (const path of [
    "/",
    "/zvm/rpc",
    "/explorer/",
    "/api/sponsor",
    "/shielded/unknown",
    "/shielded/assets/missing.js",
    "/shielded/index.html",
    "/shielded?rpc=bad",
    "/shielded/%61ssets/app.js",
  ])
    assert.equal(
      (await handle(new Request(ORIGIN + path), a, manifest)).status,
      404,
    );
  assert.equal(
    (await handle(new Request("https://example.org/shielded"), a, manifest))
      .status,
    404,
  );
  assert.equal(a.calls.length, 7);
});
test("static requests never forward credentials or allow state-changing methods", async () => {
  const a = assets();
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    assert.equal(
      (await handle(new Request(ORIGIN + "/shielded", { method }), a, manifest))
        .status,
      405,
    );
  assert.equal(a.calls.length, 0);
  const response = await handle(
    new Request(ORIGIN + "/shielded", {
      headers: {
        cookie: "private",
        authorization: "private",
        range: "bytes=0-1",
        "if-none-match": "private",
      },
    }),
    a,
    manifest,
  );
  assert.equal(response.status, 200);
  assert.equal([...a.calls[0].headers].length, 0);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.match(
    response.headers.get("content-security-policy"),
    /connect-src 'self' https:\/\/devnet.zenon.foo\/zvm\/rpc/,
  );
  assert.equal(
    response.headers.get("cross-origin-embedder-policy"),
    "require-corp",
  );
  const head = await handle(
    new Request(ORIGIN + "/shielded", { method: "HEAD" }),
    a,
    manifest,
  );
  assert.equal(await head.text(), "");
});
test("missing bound assets fail closed instead of returning app HTML or redirects", async () => {
  for (const status of [301, 302, 404, 500]) {
    const r = await handle(
      new Request(ORIGIN + "/shielded-assets/create-key"),
      { ASSETS: { fetch: async () => new Response("wrong", { status }) } },
      manifest,
    );
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("location"), null);
  }
  const failed = await handle(
    new Request(ORIGIN + "/shielded"),
    {
      ASSETS: {
        fetch: async () => {
          throw Error("provider detail");
        },
      },
    },
    manifest,
  );
  assert.equal(failed.status, 503);
  assert.equal(await failed.text(), "Static package unavailable");
  assert.equal(failed.headers.get("cache-control"), "no-store");
  const r = await handle(
    new Request(ORIGIN + "/shielded/config.json"),
    assets(),
    manifest,
  );
  assert.match(r.headers.get("content-disposition"), /attachment/);
});
