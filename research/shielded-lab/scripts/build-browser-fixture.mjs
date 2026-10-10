import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProfile, digest } from "../core.mjs";
import { deployment, metadata } from "../test/fixtures.mjs";
const lab = fileURLToPath(new URL("../", import.meta.url)),
  p = await createProfile(),
  old = p.note(deployment, metadata, 1n, 2n),
  next = p.note(deployment, metadata, 3n, 4n),
  tree = new p.Tree();
tree.append(BigInt(old.commitment));
const fixtures = {
  create: p.creationInput(old),
  spend: p.spendInput(old, next, tree.path(0)),
};
const artifacts = {};
for (const name of ["create", "spend"])
  for (const [kind, file] of [
    ["wasm", `${name}_js/${name}.wasm`],
    ["key", `${name}-groth16.zkey`],
    ["verificationKey", `${name}-groth16.vkey.json`],
  ]) {
    const path = resolve(lab, "build", file);
    artifacts[`${name}-${kind}`] = {
      url: `/artifacts/${name}-${kind}`,
      sha256: digest(readFileSync(path)),
      bytes: statSync(path).size,
    };
  }
const bundle = resolve(lab, "node_modules/snarkjs/build/snarkjs.min.js");
artifacts.library = {
  url: "/vendor/snarkjs.min.js",
  sha256: digest(readFileSync(bundle)),
  bytes: statSync(bundle).size,
};
writeFileSync(
  resolve(lab, "build/browser-fixture.json"),
  JSON.stringify(
    {
      format: "zft-shielded-public-browser-fixture-v1",
      scope: "Disposable public test secrets 1/2 and 3/4; no user state",
      artifacts,
      fixtures,
    },
    null,
    2,
  ) + "\n",
);
console.log("Built public browser fixture and pinned artifact sizes/hashes");
