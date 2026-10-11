import {
  readFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const jsonBytes = (value) =>
  Buffer.from(JSON.stringify(value, null, 2) + "\n");
const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, "../..");
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function safeName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.includes("\\") ||
    /[^\x20-\x7e]/.test(name) ||
    name.split("/").some((n) => !n || n === "." || n === "..")
  )
    throw Error("Unsafe source path");
  return name;
}
// Archive inputs are explicit regular files. Never traverse a project directory or follow an entry symlink.
export function readSelected(root, name) {
  safeName(name);
  let path = root;
  const parts = name.split("/");
  for (let i = 0; i < parts.length; i++) {
    path = resolve(path, parts[i]);
    const s = lstatSync(path);
    if (
      s.isSymbolicLink() ||
      (i < parts.length - 1 ? !s.isDirectory() : !s.isFile())
    )
      throw Error("Nonregular source entry");
    if (i === parts.length - 1 && s.size > 64 * 1024 * 1024)
      throw Error("Source file too large");
  }
  return readFileSync(path);
}
export function packageFiles(root) {
  const entries = [];
  function walk(directory, prefix = "") {
    for (const name of readdirSync(directory).sort(compare)) {
      if (name === "node_modules" || name === ".git") continue;
      const path = resolve(directory, name),
        rel = prefix + name,
        s = lstatSync(path);
      if (s.isSymbolicLink()) throw Error("Package symlink entry");
      if (s.isDirectory()) walk(path, rel + "/");
      else entries.push([safeName(rel), readSelected(root, rel)]);
    }
  }
  walk(root);
  return entries.sort(([a], [b]) => compare(a, b));
}
export function inventory(entries) {
  return entries
    .map(([path, bytes]) => [path, bytes.length, digest(bytes)])
    .sort(([a], [b]) => compare(a, b));
}
export function verifyPackage(entries, pin) {
  const rows = inventory(entries);
  if (
    rows.length !== pin.files ||
    digest(JSON.stringify(rows)) !== pin.treeSha256
  )
    throw Error(
      "Installed package differs from selected source pins: " + pin.id,
    );
  return rows;
}
// Portable USTAR, with fixed ownership/mode/time and no links or executable entries.
export function sourceArchive(entries) {
  const chunks = [],
    seen = new Set();
  for (const [path, bytes] of [...entries].sort(([a], [b]) => compare(a, b))) {
    safeName(path);
    if (seen.has(path) || !Buffer.isBuffer(bytes))
      throw Error("Invalid archive entry");
    seen.add(path);
    const header = Buffer.alloc(512);
    let name = path,
      prefix = "";
    if (Buffer.byteLength(name) > 100) {
      const index = path.lastIndexOf("/", 155);
      if (index < 1) throw Error("Archive path too long");
      prefix = path.slice(0, index);
      name = path.slice(index + 1);
    }
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155)
      throw Error("Archive path too long");
    const field = (value, offset, length) => {
      if (Buffer.byteLength(value) > length)
        throw Error("Archive field overflow");
      header.write(value, offset, length, "ascii");
    };
    const octal = (n, offset, length) =>
      field(n.toString(8).padStart(length - 1, "0") + "\0", offset, length);
    field(name, 0, 100);
    octal(0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(bytes.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    field("0", 156, 1);
    field("ustar\0", 257, 6);
    field("00", 263, 2);
    field(prefix, 345, 155);
    const checksum = header.reduce((sum, n) => sum + n, 0);
    field(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    chunks.push(
      header,
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
    );
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}
function packageAt(directory) {
  const root = realpathSync(directory),
    metadata = readSelected(root, "package.json"),
    p = JSON.parse(metadata);
  if (!p.name || !p.version) throw Error("Missing package identity");
  return { root, metadata, p, id: p.name + "@" + p.version };
}
function dependency(directory, name) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))
    throw Error("Invalid dependency name");
  for (let p = directory; ; p = dirname(p)) {
    const candidate = resolve(p, "node_modules", name);
    if (existsSync(resolve(candidate, "package.json")))
      return packageAt(candidate);
    if (dirname(p) === p) throw Error("Missing dependency: " + name);
  }
}
export function modulePackage(file) {
  for (
    let p = dirname(file);
    p.includes(sep + "node_modules");
    p = dirname(p)
  ) {
    if (existsSync(resolve(p, "package.json"))) {
      const metadata = JSON.parse(
        readFileSync(resolve(p, "package.json"), "utf8"),
      );
      if (metadata.name && metadata.version) return packageAt(p);
    }
  }
  throw Error("Unknown build dependency");
}
export function collectPackages(modules, root, scope) {
  const packages = new Map(),
    inputs = new Set(),
    allowed = new Set([...scope.licensedFiles, ...scope.otherFiles]);
  function add(p, role) {
    const old = packages.get(p.id);
    if (old && !old.metadata.equals(p.metadata))
      throw Error("Ambiguous package version");
    if (!old) packages.set(p.id, { ...p, roles: new Set(), dependencies: {} });
    packages.get(p.id).roles.add(role);
    return packages.get(p.id);
  }
  for (const id of modules) {
    if (id.startsWith("\0")) continue; // Rollup virtual wrappers refer to separately listed physical modules.
    const file = id.split("?")[0];
    if (file.includes(sep + "node_modules" + sep))
      add(modulePackage(file), "bundler-input");
    else {
      const name = relative(root, file).split(sep).join("/");
      if (!allowed.has(name))
        throw Error("Build input outside declared source scope: " + name);
      readSelected(root, name);
      inputs.add(name);
    }
  }
  const lab = resolve(root, "research/shielded-lab");
  add(dependency(lab, "snarkjs"), "pinned-prebuilt-prover");
  add(dependency(lab, "circomlib"), "circuit-source");
  add(dependency(root, "@openzeppelin/contracts"), "contract-source");
  const visited = new Set();
  function visit(p) {
    if (visited.has(p.id)) return;
    visited.add(p.id);
    for (const name of Object.keys(p.p.dependencies ?? {}).sort(compare)) {
      const child = add(
        dependency(p.root, name),
        "conservative-prebuilt-closure",
      );
      p.dependencies[name] = child.id;
      visit(child);
    }
  }
  for (const p of [...packages.values()])
    if (["snarkjs", "ffjavascript"].includes(p.p.name)) visit(p);
  return {
    packages: [...packages.values()].sort((a, b) => compare(a.id, b.id)),
    inputs: [...inputs].sort(compare),
  };
}
export function verifySupplement(bytes, pin) {
  if (
    bytes.length !== pin.bytes ||
    digest(bytes) !== pin.sha256 ||
    createHash("sha1")
      .update(Buffer.from(`blob ${bytes.length}\0`))
      .update(bytes)
      .digest("hex") !== pin.gitBlob
  )
    throw Error("Upstream supplement differs from pinned Git blob");
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function buildSources({
  modules,
  root = projectRoot,
  destination,
  uiOnly,
}) {
  const scope = JSON.parse(
    readSelected(root, "research/shielded-host/license-scope.json"),
  );
  const pins = JSON.parse(
    readSelected(root, "research/shielded-host/source-pins.json"),
  );
  const { packages, inputs } = collectPackages(modules, root, scope);
  if (
    JSON.stringify(packages.map((p) => p.id)) !==
    JSON.stringify(pins.packages.map((p) => p.id).sort(compare))
  )
    throw Error("Dependency set differs from source pins");
  mkdirSync(destination, { recursive: false });
  const outputs = {},
    write = (name, bytes) => {
      safeName(name);
      if (bytes.length > 25 * 1024 * 1024)
        throw Error("Source download exceeds asset size limit");
      const path = resolve(destination, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes, { flag: "wx" });
      outputs[name] = { bytes: bytes.length, sha256: digest(bytes) };
    };
  const project = [...new Set([...scope.licensedFiles, ...scope.otherFiles])]
    .sort(compare)
    .map((name) => [name, readSelected(root, name)]);
  write(
    "zft-shielded-source.tar.gz",
    sourceArchive(project.map(([n, b]) => ["zft/" + n, b])),
  );
  write("GPL-3.0-only.txt", readSelected(root, "LICENSES/GPL-3.0-only.txt"));
  write("license-scope.json", jsonBytes(scope));
  const records = [];
  for (const p of packages) {
    const pin = pins.packages.find((entry) => entry.id === p.id),
      entries = packageFiles(p.root),
      rows = verifyPackage(entries, pin);
    const supplements = pins.upstream.find((u) => u.package === p.id);
    const slug = p.id.replaceAll("/", "__");
    const archive = entries.map(([n, b]) => ["package/" + n, b]);
    const notices = [];
    for (const [name, bytes] of entries)
      if (
        /^(license|licence|copying|notice|ofl)([.-]|$)/i.test(
          name.split("/").at(-1),
        )
      ) {
        const path = "notices/" + slug + "/" + name;
        write(path, bytes);
        notices.push(path);
      }
    if (supplements) {
      for (const source of supplements.matchingFiles) {
        const bytes = readSelected(p.root, source.path);
        if (digest(bytes) !== source.sha256)
          throw Error("Preferred source mismatch");
      }
      for (const source of supplements.supplements) {
        const bytes = readSelected(
          resolve(root, "research/shielded-host/.sources"),
          slug + "/" + source.path,
        );
        verifySupplement(bytes, source);
        archive.push(["upstream/" + source.path, bytes]);
        if (
          /^(license|licence|copying|notice|ofl)([.-]|$)/i.test(
            source.path.split("/").at(-1),
          )
        ) {
          const path = "notices/" + slug + "/upstream/" + source.path;
          write(path, bytes);
          notices.push(path);
        }
      }
    }
    const archivePath = "dependencies/" + slug + ".tar.gz";
    write(archivePath, sourceArchive(archive));
    records.push({
      id: p.id,
      declaredLicense: p.p.license ?? null,
      legacyLicenses: p.p.licenses ?? null,
      author: p.p.author ?? null,
      repository: p.p.repository ?? null,
      roles: [...p.roles].sort(compare),
      dependencies: p.dependencies,
      archive: archivePath,
      notices,
      installedFiles: rows,
      upstream: supplements ?? null,
    });
  }
  for (const name of ["LICENSE", "NOTICE.md"])
    write(
      "notices/vendor-zenon/" + name,
      readSelected(root, "design/vendor/zenon/" + name),
    );
  write(
    "REBUILD.md",
    readSelected(root, "docs/SHIELDED-SOURCE-DISTRIBUTION.md"),
  );
  const index = {
    format: "zft-shielded-source-package-v1",
    mode: uiOnly
      ? "ui-only-no-selected-proof-artifacts"
      : "selected-devnet-artifacts",
    projectLicense: "GPL-3.0-only",
    scope: "license-scope.json",
    physicalProjectInputs: inputs,
    projectFiles: inventory(project),
    packages: records,
    downloads: { ...outputs },
    limits: [
      "Conservative dependency closure includes packages that browser stubs may exclude.",
      "Installed sources and exact upstream supplements are supplied; prebuilt bundle reproduction has not been independently qualified.",
      "Fresh random setup cannot reproduce existing devnet proving keys. Selected public artifacts are separate exact downloads; there is no retained ceremony entropy.",
      "No hosted activation, independent review, production ceremony, wallet/device acceptance or chain finality is implied.",
    ],
  };
  write("inventory.json", jsonBytes(index));
  const links = Object.entries(outputs)
    .filter(([name]) => !name.startsWith("notices/"))
    .map(
      ([name, item]) =>
        `<li><a href="/shielded/source/${escape(name)}">${escape(name)}</a> (${item.bytes} bytes)<br><small>SHA-256 ${item.sha256}</small></li>`,
    )
    .join("\n");
  const packagesHtml = records
    .map(
      (p) =>
        `<li>${escape(p.id)} — ${escape(p.declaredLicense ?? JSON.stringify(p.legacyLicenses))} ${p.notices.map((n) => `<a href="/shielded/source/${escape(n)}">notice</a>`).join(" ")}${p.notices.length ? "" : " (license declaration retained in package metadata; no standalone notice supplied by this source snapshot)"}</li>`,
    )
    .join("\n");
  write(
    "index.html",
    Buffer.from(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ZFT shielded source and licenses</title><link rel="stylesheet" href="/shielded/source/page.css"></head><body><main><a href="/shielded">Back to shielded devnet</a><h1>Source and licenses</h1><p>ZFT-owned files listed in the scope are licensed under GPL-3.0-only. Third-party licenses and existing grants remain intact. Brand marks, user artwork, keys and recovery files are excluded. No warranty is provided; see the license.</p><p>This package accompanies the experimental devnet client. The inventory identifies exact sources, notices and downloads. Read REBUILD.md for reconstruction instructions and the limits of prebuilt and disposable setup evidence.</p><h2>Downloads</h2><ul>${links}</ul><h2>Third-party notices</h2><ul>${packagesHtml}</ul><p><a href="/shielded/source/notices/vendor-zenon/LICENSE">Zenon design MIT license</a> · <a href="/shielded/source/notices/vendor-zenon/NOTICE.md">Zenon attribution</a></p></main></body></html>\n`,
    ),
  );
  write(
    "page.css",
    Buffer.from(
      "body{font:1rem/1.6 system-ui,sans-serif;margin:2rem auto;padding:0 1rem;max-width:70rem;color:#152828;background:#f5faf8}a{color:#076d55}li{margin-bottom:.6rem;overflow-wrap:anywhere}small{font-family:monospace}h1,h2{line-height:1.2}\n",
    ),
  );
  return {
    packages: records.length,
    projectFiles: project.length,
    files: Object.keys(outputs).length,
    downloads: outputs,
  };
}
