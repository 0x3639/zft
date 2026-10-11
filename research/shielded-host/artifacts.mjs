import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseConfiguration } from "../../packages/shielded/config.mjs";
export const ORIGIN = "https://devnet.zenon.foo";
export const RPC = ORIGIN + "/zvm/rpc";
export const REGISTRY = "0x94bd9f5181a28120f2a02cb5cbc276b641ad6da0";
// Exact canonical PR34 configuration, checked against merged 6c9d0d before selection.
const CONFIGURATION_SHA256 =
  "0x9a1a07626e19c3174c2c8261495f54b2603a4fee0b79fb2bc0096b6eaa803559";
export const SHA256 = (bytes) =>
  "0x" + createHash("sha256").update(bytes).digest("hex");
export const sources = Object.freeze({
  library: "node_modules/snarkjs/build/snarkjs.min.js",
  "create-wasm": "build/create_js/create.wasm",
  "create-key": "build/create-groth16.zkey",
  "create-verificationKey": "build/create-groth16.vkey.json",
  "spend-wasm": "build/spend_js/spend.wasm",
  "spend-key": "build/spend-groth16.zkey",
  "spend-verificationKey": "build/spend-groth16.vkey.json",
});
export function selectedConfiguration(text) {
  const c = parseConfiguration(text, ORIGIN);
  if (
    c.rpc !== RPC ||
    c.pins.chainId !== "7340469" ||
    c.pins.genesisHash !==
      "0x2a55e0b69e552a105d559e99b12e0cae28d6e07a3c7a9f264a1543a040ef8ea4" ||
    c.pins.contracts.registry.address !== REGISTRY ||
    SHA256(text) !== CONFIGURATION_SHA256
  )
    throw Error("Unselected devnet configuration");
  return c;
}
// Reads only public proving material. Never creates a setup or substitutes another build.
export function readArtifacts(config, lab) {
  return Object.entries(sources).map(([name, source]) => {
    const path = resolve(lab, source),
      stat = lstatSync(path),
      a = config.artifacts[name];
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== a.bytes ||
      stat.size > 25 * 1024 * 1024
    )
      throw Error("Public artifact size/type mismatch: " + name);
    const bytes = readFileSync(path);
    if (SHA256(bytes) !== a.sha256)
      throw Error("Public artifact hash mismatch: " + name);
    return { path: a.url, bytes, sha256: a.sha256 };
  });
}
