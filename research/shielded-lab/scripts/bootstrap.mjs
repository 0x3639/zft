// Official experimental tool/artifact downloads, accepted only under exact pinned digests.
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  chmod,
  unlink,
} from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const lab = fileURLToPath(new URL("../", import.meta.url)),
  dir = resolve(lab, ".tools");
await mkdir(dir, { recursive: true });
const compilers = {
  darwin: {
    file: "circom-macos-amd64",
    sha256: "e006332b3fe225f11c3b87bd2debbf5d7f568d6efbde25e5a6a12cd6988c8ecb",
  },
  linux: {
    file: "circom-linux-amd64",
    sha256: "85342c7ff332d948df7c0c50ecf201e6129349aef550ce873f3c811b79fe53a3",
  },
};
const compiler = compilers[process.platform];
if (!compiler || (process.platform === "linux" && process.arch !== "x64"))
  throw Error("No pinned compiler for this platform");
const entries = [
  {
    name: "circom",
    url: `https://github.com/iden3/circom/releases/download/v2.2.3/${compiler.file}`,
    algorithm: "sha256",
    digest: compiler.sha256,
    max: 32 * 1024 * 1024,
  },
  {
    name: "powersOfTau28_hez_final_15.ptau",
    url: "https://circom.info/powersOfTau28_hez_final_15.ptau",
    algorithm: "blake2b512",
    digest:
      "982372c867d229c236091f767e703253249a9b432c1710b4f326306bfa2428a17b06240359606cfe4d580b10a5a1f63fbed499527069c18ae17060472969ae6e",
    max: 40 * 1024 * 1024,
  },
];
if (process.argv.includes("--comparison"))
  entries.push({
    name: "powersOfTau28_hez_final_17.ptau",
    url: "https://circom.info/powersOfTau28_hez_final_17.ptau",
    algorithm: "blake2b512",
    digest:
      "6247a3433948b35fbfae414fa5a9355bfb45f56efa7ab4929e669264a0258976741dfbe3288bfb49828e5df02c2e633df38d2245e30162ae7e3bcca5b8b49345",
    max: 150 * 1024 * 1024,
  });
const hash = (bytes, algorithm) =>
  createHash(algorithm).update(bytes).digest("hex");
for (const entry of entries) {
  const path = resolve(dir, entry.name);
  let existing;
  try {
    existing = await readFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing) {
    if (hash(existing, entry.algorithm) !== entry.digest)
      throw Error(
        `Existing ${entry.name} has wrong digest; preserve and inspect it`,
      );
    console.log(`${entry.name}: existing digest verified`);
    continue;
  }
  const response = await fetch(entry.url, {
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw Error(`Artifact unavailable: ${entry.name}`);
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > entry.max) throw Error("Artifact too large");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(parts);
  if (hash(bytes, entry.algorithm) !== entry.digest)
    throw Error(`Digest mismatch: ${entry.name}`);
  const temp = path + "." + randomBytes(12).toString("hex") + ".tmp";
  try {
    await writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  if (entry.name === "circom") await chmod(path, 0o700);
  console.log(`${entry.name}: downloaded digest verified`);
}
