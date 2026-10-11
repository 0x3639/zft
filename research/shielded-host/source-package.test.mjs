import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readSelected,
  packageFiles,
  inventory,
  digest,
  verifyPackage,
  sourceArchive,
  collectPackages,
  verifySupplement,
  projectRoot,
  modulePackage,
} from "./source-package.mjs";
import { handle, ORIGIN } from "./worker.mjs";

test("source selection rejects traversal, directories and file/parent symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "zft-source-selection-"));
  try {
    mkdirSync(join(root, "safe"));
    writeFileSync(join(root, "safe/input.js"), "public source");
    writeFileSync(join(root, "private.txt"), "disposable fixture only");
    symlinkSync(join(root, "private.txt"), join(root, "link.js"));
    symlinkSync(join(root, "safe"), join(root, "linked"));
    assert.equal(
      readSelected(root, "safe/input.js").toString(),
      "public source",
    );
    for (const name of [
      "../private.txt",
      "/private.txt",
      "safe/../private.txt",
      "safe\\input.js",
      "safe",
      "link.js",
      "linked/input.js",
    ])
      assert.throws(
        () => readSelected(root, name),
        undefined,
        "unsafe source selection must fail",
      );
    assert.throws(() => packageFiles(root), /symlink/);
  } finally {
    rmSync(root, { recursive: true });
  }
});
test("source pins reject added, missing and modified installed files", () => {
  const entries = [
    ["package.json", Buffer.from('{"name":"fixture"}')],
    ["src/main.js", Buffer.from("export const n = 1;")],
  ];
  const pin = {
    id: "fixture@1",
    files: 2,
    treeSha256: digest(JSON.stringify(inventory(entries))),
  };
  assert.equal(verifyPackage(entries, pin).length, 2);
  for (const bad of [
    entries.slice(0, 1),
    [...entries, ["extra.js", Buffer.from("extra")]],
    [entries[0], ["src/main.js", Buffer.from("export const n = 2;")]],
  ])
    assert.throws(
      () => verifyPackage(bad, pin),
      /differs/,
      "source changes must invalidate the selected package",
    );
});
test("USTAR downloads are deterministic and independently readable without extraction", () => {
  const name = "project/" + "long-directory/".repeat(8) + "input.js";
  const contents = Buffer.from("exact source\0bytes\n");
  const entries = [
    [name, contents],
    ["project/LICENSE", Buffer.from("fixture license")],
  ];
  const archive = sourceArchive(entries);
  assert.deepEqual(
    sourceArchive([...entries].reverse()),
    archive,
    "archive metadata and ordering must be deterministic",
  );
  const names = execFileSync("tar", ["-tzf", "-"], {
    input: archive,
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  assert.deepEqual(names, entries.map(([n]) => n).sort());
  assert.deepEqual(
    execFileSync("tar", ["-xzOf", "-", name], { input: archive }),
    contents,
  );
  for (const bad of [
    "/absolute",
    "../escape",
    "a/../escape",
    "a\\b",
    "x\nheader",
  ])
    assert.throws(() => sourceArchive([[bad, contents]]), /Unsafe/);
  assert.throws(
    () => sourceArchive([entries[0], entries[0]]),
    /Invalid archive/,
  );
});
test("unlisted physical build inputs stop packaging before dependency discovery", () => {
  const root = mkdtempSync(join(tmpdir(), "zft-source-scope-"));
  try {
    writeFileSync(join(root, "unlisted.js"), "export default 1;");
    assert.throws(
      () =>
        collectPackages([join(root, "unlisted.js")], root, {
          licensedFiles: [],
          otherFiles: [],
        }),
      /outside declared source scope/,
      "every physical project input requires explicit license/source coverage",
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});
test("upstream additions require exact size, SHA-256 and Git blob identity", () => {
  const bytes = Buffer.from("public upstream source\n");
  const pin = {
    bytes: bytes.length,
    sha256: digest(bytes),
    gitBlob: createHash("sha1")
      .update(Buffer.from(`blob ${bytes.length}\0`))
      .update(bytes)
      .digest("hex"),
  };
  assert.doesNotThrow(() => verifySupplement(bytes, pin));
  for (const bad of [
    { ...pin, bytes: bytes.length + 1 },
    { ...pin, sha256: "00".repeat(32) },
    { ...pin, gitBlob: "00".repeat(20) },
  ])
    assert.throws(() => verifySupplement(bytes, bad), /differs/);
});
test("approved source scope covers reconstructable files and preserves separate third-party scope", () => {
  const scope = JSON.parse(
    readFileSync(
      join(projectRoot, "research/shielded-host/license-scope.json"),
    ),
  );
  assert.equal(scope.license, "GPL-3.0-only");
  const all = [...scope.licensedFiles, ...scope.otherFiles];
  assert.equal(new Set(all).size, all.length);
  for (const name of all)
    assert.ok(readSelected(projectRoot, name).length > 0, name);
  assert.ok(
    scope.licensedFiles.includes(
      "research/shielded-lab/browser/prover-worker.js",
    ),
    "worker source must accompany its separately bundled output",
  );
  assert.ok(scope.otherFiles.includes("design/vendor/zenon/LICENSE"));
  assert.ok(scope.otherFiles.includes("apps/web/public/favicon.svg"));
  assert.ok(
    !scope.licensedFiles.some(
      (n) => n.startsWith("design/vendor/") || n.startsWith("research/ps-lab/"),
    ),
  );
});
test("source and notice downloads use exact static routes and the existing credential-free boundary", async () => {
  const paths = [
    "/shielded/source/index.html",
    "/shielded/source/GPL-3.0-only.txt",
    "/shielded/source/zft-shielded-source.tar.gz",
    "/shielded/source/inventory.json",
  ];
  const files = Object.fromEntries(
    paths.map((path) => [
      path,
      {
        bytes: 6,
        type: path.endsWith(".gz") ? "application/gzip" : "text/plain",
      },
    ]),
  );
  const calls = [],
    env = {
      ASSETS: {
        fetch: async (r) => {
          calls.push(r);
          return new Response("source");
        },
      },
    };
  for (const path of paths) {
    const r = await handle(
      new Request(ORIGIN + path, {
        headers: { authorization: "fixture", cookie: "fixture" },
      }),
      env,
      { files },
    );
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("content-type"), files[path].type);
    assert.equal([...calls.at(-1).headers].length, 0);
    const head = await handle(
      new Request(ORIGIN + path, { method: "HEAD" }),
      env,
      { files },
    );
    assert.equal(await head.text(), "");
  }
  for (const path of [
    "/shielded/source/missing.tar.gz",
    "/shielded/source/index.html?key=fixture",
    "/shielded/source/%69ndex.html",
  ])
    assert.equal(
      (await handle(new Request(ORIGIN + path), env, { files })).status,
      404,
    );
  assert.equal(calls.length, paths.length * 2);
});

test("nested module-type metadata does not hide the owning package identity", () => {
  const root = mkdtempSync(join(tmpdir(), "zft-source-owner-"));
  try {
    const pkg = join(root, "node_modules", "fixture");
    mkdirSync(join(pkg, "esm"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      '{"name":"fixture","version":"1.0.0"}',
    );
    writeFileSync(join(pkg, "esm/package.json"), '{"type":"module"}');
    writeFileSync(join(pkg, "esm/main.js"), "export const n=1;");
    assert.equal(modulePackage(join(pkg, "esm/main.js")).id, "fixture@1.0.0");
  } finally {
    rmSync(root, { recursive: true });
  }
});
