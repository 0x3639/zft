import {
  canonical,
  check,
  exact,
  parseCanonical,
  digest,
} from "../../research/shielded-lab/core.mjs";
import { validatePins } from "../../research/shielded-lab/chain.mjs";
export function parseConfiguration(text, origin) {
  const c = parseCanonical(text, 16384);
  exact(c, ["format", "pins", "rpc", "artifacts"]);
  check(c.format === "zft-shielded-app-config-v1");
  const pins = validatePins(c.pins),
    here = new URL(origin),
    rpc = new URL(c.rpc);
  check(Number.isSafeInteger(Number(pins.chainId)), "Unsupported chain ID");
  const loopback = (u) =>
    ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname);
  check(
    rpc.href === c.rpc &&
      !rpc.username &&
      !rpc.password &&
      !rpc.hash &&
      !rpc.search &&
      (rpc.protocol === "https:" ||
        (here.protocol === "http:" &&
          loopback(here) &&
          rpc.protocol === "http:" &&
          loopback(rpc) &&
          pins.chainId === "31337")),
    "Unsupported RPC endpoint",
  );
  exact(c.artifacts, [
    "library",
    "create-wasm",
    "create-key",
    "create-verificationKey",
    "spend-wasm",
    "spend-key",
    "spend-verificationKey",
  ]);
  for (const [name, a] of Object.entries(c.artifacts)) {
    exact(a, ["url", "bytes", "sha256"]);
    check(
      typeof a.url === "string" &&
        /^\/shielded-assets\/[a-zA-Z0-9/_.-]+$/.test(a.url) &&
        !a.url.includes(".."),
    );
    check(
      Number.isInteger(a.bytes) &&
        a.bytes > 0 &&
        a.bytes <= 32 * 1024 * 1024 &&
        /^0x[0-9a-f]{64}$/.test(a.sha256),
    );
    if (name !== "library") {
      const [kind, type] = name.split("-");
      check(
        a.sha256 ===
          pins.artifacts[
            kind +
              { wasm: "Wasm", key: "Key", verificationKey: "VerificationKey" }[
                type
              ]
          ],
        "Artifact pin mismatch",
      );
    }
  }
  return structuredClone(c);
}
export const configurationId = (c) =>
  digest(new TextEncoder().encode(canonical(c)));
