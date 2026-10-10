import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { groth16, plonk, curves } from "snarkjs";
import { encodeAbiParameters } from "viem";
import { check, Q, digest } from "./core.mjs";
import { validatePins } from "./chain.mjs";
const lab = fileURLToPath(new URL("./", import.meta.url));
export async function prove(
  name,
  input,
  system = "groth16",
  expectedPins = null,
) {
  check(
    ["create", "spend"].includes(name) && ["groth16", "plonk"].includes(system),
  );
  const buffers = {
    Wasm: readFileSync(resolve(lab, `build/${name}_js/${name}.wasm`)),
    Key: readFileSync(resolve(lab, `build/${name}-${system}.zkey`)),
    VerificationKey: readFileSync(
      resolve(lab, `build/${name}-${system}.vkey.json`),
    ),
  };
  if (expectedPins) {
    const pins = validatePins(expectedPins);
    check(system === pins.system);
    for (const [kind, bytes] of Object.entries(buffers))
      check(
        digest(bytes) === pins.artifacts[name + kind],
        "Prover artifact pin mismatch",
      );
  }
  const api = system === "groth16" ? groth16 : plonk;
  const result = await api.fullProve(input, buffers.Wasm, buffers.Key);
  const key = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(buffers.VerificationKey),
  );
  check(
    await api.verify(key, result.publicSignals, result.proof),
    "Local proof verification failed",
  );
  // snarkjs 0.7.6's PLONK text export omits the separator between arrays.
  // Encode its documented Solidity field order directly and test it on the generated verifier.
  const args =
    system === "groth16"
      ? JSON.parse(
          "[" +
            (await api.exportSolidityCallData(
              result.proof,
              result.publicSignals,
            )) +
            "]",
        )
      : [
          ["A", "B", "C", "Z", "T1", "T2", "T3", "Wxi", "Wxiw"]
            .flatMap((k) => result.proof[k].slice(0, 2))
            .concat(
              [
                "eval_a",
                "eval_b",
                "eval_c",
                "eval_s1",
                "eval_s2",
                "eval_zw",
              ].map((k) => result.proof[k]),
            ),
          result.publicSignals,
        ];
  const signals = result.publicSignals.map(BigInt);
  check(signals.length === 4 && signals.every((x) => x >= 0n && x < Q));
  const data =
    system === "groth16"
      ? encodeAbiParameters(
          [
            { type: "uint256[2]" },
            { type: "uint256[2][2]" },
            { type: "uint256[2]" },
          ],
          args.slice(0, 3),
        )
      : encodeAbiParameters([{ type: "uint256[24]" }], [args[0]]);
  return { ...result, args, data, signals };
}
export async function closeProver() {
  const curve = await curves.getCurveFromName("bn128");
  await curve.terminate();
}
