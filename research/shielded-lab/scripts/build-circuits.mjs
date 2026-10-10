import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const lab = fileURLToPath(new URL("../", import.meta.url));
const root = resolve(lab, "../..");
const compiler = process.env.ZFT_CIRCOM ?? resolve(lab, ".tools/circom");
const version = execFileSync(compiler, ["--version"], {
  encoding: "utf8",
}).trim();
if (version !== "circom compiler 2.2.3")
  throw Error("Unexpected compiler version");
mkdirSync(resolve(lab, "build"), { recursive: true });
for (const name of ["create", "spend"]) {
  execFileSync(
    compiler,
    [
      resolve(root, `circuits/shielded/${name}.circom`),
      "--r1cs",
      "--wasm",
      "--sym",
      "--inspect",
      "--O2",
      "-l",
      resolve(lab, "node_modules"),
      "-o",
      resolve(lab, "build"),
    ],
    { stdio: "inherit" },
  );
}
const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
writeFileSync(
  resolve(lab, "build/compile.json"),
  JSON.stringify(
    {
      version,
      compilerSha256: hash(compiler),
      artifacts: Object.fromEntries(
        ["create", "spend"]
          .flatMap((n) => [`${n}.r1cs`, `${n}_js/${n}.wasm`])
          .map((n) => [n, hash(resolve(lab, "build", n))]),
      ),
    },
    null,
    2,
  ) + "\n",
);
