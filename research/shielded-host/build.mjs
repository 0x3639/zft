import { build } from "vite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  selectedConfiguration,
  readArtifacts,
  SHA256,
  ORIGIN,
} from "./artifacts.mjs";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const uiOnly = process.argv.slice(2).join(" ") === "--ui-only";
if (process.argv.length > 2 && !uiOnly)
  throw Error("Only --ui-only is supported");
const configText = readFileSync(
  resolve(here, "../shielded-devnet/evidence/app-config.json"),
  "utf8",
);
const config = selectedConfiguration(configText);
// Validate all actual deployment artifacts BEFORE generating a deployable package.
const artifacts = uiOnly
  ? []
  : readArtifacts(config, resolve(here, "../shielded-lab"));
const output = resolve(here, "build", uiOnly ? "ui-check" : "candidate");
if (existsSync(output))
  throw Error(
    "Output exists; preserve or explicitly remove only this generated package before rebuilding",
  );
mkdirSync(output, { recursive: true });
const publicDir = resolve(output, "public"),
  ui = resolve(publicDir, "shielded");
const result = await build({
  configFile: false,
  root: here,
  base: "/shielded/",
  publicDir: false,
  resolve: {
    alias: {
      circomlibjs: resolve(
        root,
        "research/shielded-lab/node_modules/circomlibjs/src/poseidon_wasm.js",
      ),
    },
  },
  build: { outDir: ui, emptyOutDir: false, target: "es2022", sourcemap: false },
});
const modules = new Set();
for (const chunk of result.output ?? [])
  if (chunk.type === "chunk")
    for (const name of Object.keys(chunk.modules)) modules.add(name);
const licenses = new Map();
for (const module of [
  ...modules,
  resolve(
    root,
    "research/shielded-lab/node_modules/snarkjs/build/snarkjs.min.js",
  ),
]) {
  if (!module.includes("node_modules")) continue;
  let directory = dirname(module.split("?")[0]);
  while (directory.includes("node_modules")) {
    const path = resolve(directory, "package.json");
    if (existsSync(path)) {
      const p = JSON.parse(readFileSync(path, "utf8"));
      if (p.name && p.version) {
        const id = p.name + "@" + p.version;
        if (!licenses.has(id)) {
          const notices = readdirSync(directory)
            .filter((n) => /^(license|copying|notice|ofl)([.-]|$)/i.test(n))
            .filter((n) => lstatSync(resolve(directory, n)).isFile());
          licenses.set(id, {
            name: p.name,
            version: p.version,
            declaredLicense: p.license ?? null,
            repository: p.repository?.url ?? p.repository ?? null,
            notices: notices.map((n) => ({
              file: n,
              sha256: SHA256(readFileSync(resolve(directory, n))),
            })),
          });
          const noticeDir = resolve(
            output,
            "dependency-notices",
            id.replace(/[^a-zA-Z0-9@._-]/g, "_"),
          );
          mkdirSync(noticeDir, { recursive: true });
          for (const n of notices)
            copyFileSync(resolve(directory, n), resolve(noticeDir, n));
        }
        break;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}
mkdirSync(resolve(ui, "brand"), { recursive: true });
for (const [name, source] of [
  [
    "light.svg",
    "assets/brand/rendered/logo/zft-lockup-horizontal-on-light.svg",
  ],
  ["dark.svg", "assets/brand/rendered/logo/zft-lockup-horizontal-on-dark.svg"],
  ["favicon.svg", "favicon.svg"],
])
  copyFileSync(
    resolve(root, "apps/web/public", source),
    resolve(ui, "brand", name),
  );
writeFileSync(resolve(ui, "config.json"), configText, { flag: "wx" });
for (const artifact of artifacts) {
  const destination = resolve(publicDir, "." + artifact.path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, artifact.bytes, { flag: "wx" });
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const files = {};
let javascript = "";
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.isFile()) throw Error("Unexpected package entry");
    const bytes = readFileSync(path),
      url = "/" + path.slice(publicDir.length + 1);
    if (bytes.length > 25 * 1024 * 1024)
      throw Error("Cloudflare asset limit exceeded");
    files[url] = {
      bytes: bytes.length,
      sha256: SHA256(bytes),
      type:
        types[extname(path)] ??
        (url.endsWith("-wasm")
          ? "application/wasm"
          : "application/octet-stream"),
    };
    if (path.endsWith(".js")) javascript += bytes.toString("utf8");
  }
}
walk(publicDir);
for (const marker of ["zft-shielded-app-config-v1", "Use ZVM devnet"])
  if (!javascript.includes(marker)) throw Error("Missing app build marker");
for (const marker of [
  "/test/fund",
  "/test/mine",
  "anvil_setBalance",
  "/api/sponsor",
  "zft-ps-local-v1",
])
  if (javascript.includes(marker))
    throw Error("Unexpected legacy/test capability");
const report = {
  format: "zft-shielded-static-package-v1",
  deployable: !uiOnly,
  origin: ORIGIN,
  route: new URL(ORIGIN).hostname + "/shielded*",
  configurationSha256: SHA256(configText),
  files,
};
writeFileSync(
  resolve(output, uiOnly ? "ui-check.json" : "asset-manifest.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
writeFileSync(
  resolve(output, "dependency-inventory.json"),
  JSON.stringify(
    {
      scope:
        "Build module package metadata and top-level notice files, plus the pinned prebuilt snarkjs bundle package. Not a complete transitive provenance or redistribution approval.",
      packages: [...licenses.values()].sort((a, b) =>
        (a.name + a.version).localeCompare(b.name + b.version),
      ),
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    mode: uiOnly ? "nondeployable-ui-check" : "prepared-not-deployed",
    files: Object.keys(files).length,
    bytes: Object.values(files).reduce((sum, e) => sum + e.bytes, 0),
    artifacts: artifacts.length,
    noticePackages: licenses.size,
  }),
);
