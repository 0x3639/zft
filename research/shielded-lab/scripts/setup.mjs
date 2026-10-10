// Disposable development setup. Never qualify these keys as a production ceremony.
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { zKey, plonk } from "snarkjs";
const lab = fileURLToPath(new URL("../", import.meta.url));
const build = resolve(lab, "build");
const ptau15 = resolve(lab, ".tools/powersOfTau28_hez_final_15.ptau");
const ptau17 = resolve(lab, ".tools/powersOfTau28_hez_final_17.ptau");
const hash = (p, a = "sha256") =>
  createHash(a).update(readFileSync(p)).digest("hex");
if (
  hash(ptau15, "blake2b512") !==
  "982372c867d229c236091f767e703253249a9b432c1710b4f326306bfa2428a17b06240359606cfe4d580b10a5a1f63fbed499527069c18ae17060472969ae6e"
)
  throw Error("Wrong powers of tau");
const selected = process.argv.slice(2);
if (
  selected.length !== 0 &&
  (selected.length !== 2 ||
    !["create", "spend"].includes(selected[0]) ||
    !["groth16", "plonk"].includes(selected[1]))
)
  throw Error("Expected optional circuit and proof-system arguments");
const templates = Object.fromEntries(
  ["groth16", "plonk"].map((p) => [
    p,
    readFileSync(
      resolve(lab, `node_modules/snarkjs/templates/verifier_${p}.sol.ejs`),
      "utf8",
    ),
  ]),
);
const compilation = JSON.parse(
  readFileSync(resolve(build, "compile.json"), "utf8"),
);
try {
  for (const name of ["create", "spend"])
    for (const system of ["groth16", "plonk"]) {
      if (selected.length && (selected[0] !== name || selected[1] !== system))
        continue;
      const ptau = name === "spend" && system === "plonk" ? ptau17 : ptau15;
      if (
        ptau === ptau17 &&
        hash(ptau, "blake2b512") !==
          "6247a3433948b35fbfae414fa5a9355bfb45f56efa7ab4929e669264a0258976741dfbe3288bfb49828e5df02c2e633df38d2245e30162ae7e3bcca5b8b49345"
      )
        throw Error("Wrong powers of tau");
      const start = performance.now(),
        prefix = resolve(build, `${name}-${system}`),
        key = prefix + ".zkey";
      if (existsSync(key)) throw Error("Refusing to replace existing key");
      if (system === "groth16") {
        await zKey.newZKey(
          resolve(build, name + ".r1cs"),
          ptau,
          prefix + "-initial.zkey",
        );
        await zKey.contribute(
          prefix + "-initial.zkey",
          key,
          "DISPOSABLE LOCAL DEVELOPMENT",
          randomBytes(64).toString("hex"),
        );
      } else {
        const result = await plonk.setup(
          resolve(build, name + ".r1cs"),
          ptau,
          key,
          { info: console.log, error: console.error, debug: () => {} },
        );
        if (result === -1) throw Error("PLONK setup rejected parameters");
      }
      writeFileSync(
        prefix + ".vkey.json",
        JSON.stringify(await zKey.exportVerificationKey(key), null, 2) + "\n",
        { flag: "wx" },
      );
      writeFileSync(
        prefix + ".sol",
        await zKey.exportSolidityVerifier(key, templates),
        { flag: "wx" },
      );
      const row = {
        name,
        system,
        milliseconds: performance.now() - start,
        artifacts: Object.fromEntries(
          [".zkey", ".vkey.json", ".sol"].map((ext) => [
            name + "-" + system + ext,
            { sha256: hash(prefix + ext), bytes: statSync(prefix + ext).size },
          ]),
        ),
      };
      writeFileSync(
        prefix + ".setup.json",
        JSON.stringify(
          {
            format: "zft-shielded-experimental-setup-v1",
            scope:
              "Disposable local setup; no independent contribution or production approval",
            ptauBlake2b512: hash(ptau, "blake2b512"),
            compilation,
            ...row,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
      console.log(JSON.stringify(row));
    }

  // snarkjs curve worker pools persist after all awaited work has completed.
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
