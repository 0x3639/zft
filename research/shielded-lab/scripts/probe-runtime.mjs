// Read-only RPC qualification probes. eth_call state overrides never publish code or a transaction.
import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, keccak256 } from "viem";
const lab = fileURLToPath(new URL("../", import.meta.url));
const url = process.env.ZFT_PROBE_RPC ?? "https://devnet.zenon.foo/zvm/rpc",
  out = process.argv[2];
if (!out) throw Error("Pass an output path");
const report = {
  format: "zft-shielded-runtime-probe-v2",
  time: new Date().toISOString(),
  url,
  scope:
    "Read-only BN254 and generated-verifier execution via state override, when supported; no public deployment, independent operator, fee or finality qualification",
  batches: [],
};
const word = (n) => BigInt(n).toString(16).padStart(64, "0"),
  P =
    21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const g2 = [
  11559732032986387107991004021392285783925812861821192530917403151452391805634n,
  10857046999023057135944570762232829481370756359578518086990519993285655852781n,
  4082367875863433681332203403145435568316851327593401208105741076214120093531n,
  8495653923123431417604973247489272438418190587263600148770280649306958101930n,
];
const hex = (values) => "0x" + values.map(word).join("");
async function request(calls) {
  const body = calls.map(({ method, params }, id) => ({
    jsonrpc: "2.0",
    id,
    method,
    params,
  }));
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok) throw Error("RPC HTTP " + response.status);
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw Error("RPC response too large");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  const received = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    !Array.isArray(received) ||
    received.length !== calls.length ||
    new Set(received.map((r) => r.id)).size !== calls.length
  )
    throw Error("Invalid batch response");
  const rows = calls.map((c, id) => {
    const response = received.find((r) => r.id === id);
    if (!response || response.jsonrpc !== "2.0")
      throw Error("Mismatched batch response");
    return { name: c.name, request: body[id], response };
  });
  report.batches.push(rows);
  return rows.map((r) => r.response);
}
try {
  const [chain, genesis, head, version] = await request([
    { name: "chainId", method: "eth_chainId", params: [] },
    { name: "genesis", method: "eth_getBlockByNumber", params: ["0x0", false] },
    { name: "head", method: "eth_getBlockByNumber", params: ["latest", false] },
    { name: "clientVersion", method: "web3_clientVersion", params: [] },
  ]);
  if (chain.error || genesis.error || head.error || !head.result?.hash)
    throw Error("Chain identity unavailable");
  if (
    chain.result !== "0x7001b5" ||
    genesis.result.hash !==
      "0x2a55e0b69e552a105d559e99b12e0cae28d6e07a3c7a9f264a1543a040ef8ea4"
  )
    throw Error("Selected ZVM chain/genesis mismatch");
  report.chainId = chain.result;
  report.genesisHash = genesis.result.hash;
  report.block = { number: head.result.number, hash: head.result.hash };
  report.clientVersion = version.result ?? null;
  const block = head.result.number,
    call = (name, to, data, expected) => ({
      name,
      method: "eth_call",
      params: [
        { to: "0x" + to.toString(16).padStart(40, "0"), data, gas: "0x1e8480" },
        block,
      ],
      expected,
    });
  const primitive = [
    call("add-generator-zero", 6, hex([1n, 2n, 0n, 0n]), hex([1n, 2n])),
    call("mul-generator-one", 7, hex([1n, 2n, 1n]), hex([1n, 2n])),
    call("invalid-add-point", 6, hex([1n, 3n, 0n, 0n]), "execution-error"),
    call("empty-pairing", 8, "0x", hex([1n])),
    call("single-pair-false", 8, hex([1n, 2n, ...g2]), hex([0n])),
    call(
      "inverse-pair-true",
      8,
      hex([1n, 2n, ...g2, 1n, P - 2n, ...g2]),
      hex([1n]),
    ),
    call("invalid-pairing-length", 8, "0x01", "execution-error"),
  ];
  const responses = await request(primitive);
  report.primitives = primitive.map((c, i) => ({
    name: c.name,
    expected: c.expected,
    passed:
      c.expected === "execution-error"
        ? [-32000, -32003, 3].includes(responses[i].error?.code) &&
          /revert|precompile|execution|vm error/i.test(
            responses[i].error?.message ?? "",
          )
        : responses[i].result === c.expected,
  }));
  report.generatedVerifiers = [];
  const { contracts } = JSON.parse(
    await readFile(resolve(lab, "build/contracts.json"), "utf8"),
  );
  for (const name of ["create", "spend"])
    for (const system of ["groth16", "plonk"]) {
      const fixture = JSON.parse(
        await readFile(
          resolve(lab, `build/benchmark-${name}-${system}.json`),
          "utf8",
        ),
      );
      const artifact =
          contracts[
            `${name === "create" ? "Create" : "Spend"}${system === "groth16" ? "Groth16" : "Plonk"}Verifier`
          ],
        target = "0x0000000000000000000000000000000000001234";
      const altered = structuredClone(fixture.args);
      altered.at(-1)[0] = "0x01";
      const cases = [
        ["valid", fixture.args, true],
        ["wrong-domain", altered, false],
      ].map(([label, args, expected]) => ({
        name: `${name}-${system}-${label}`,
        method: "eth_call",
        params: [
          {
            to: target,
            data: encodeFunctionData({
              abi: artifact.abi,
              functionName: "verifyProof",
              args,
            }),
            gas: "0x1e8480",
          },
          block,
          { [target]: { code: artifact.runtime } },
        ],
        expected,
      }));
      const results = await request(cases);
      report.generatedVerifiers.push({
        name,
        system,
        runtimeKeccak256: keccak256(artifact.runtime),
        cases: cases.map((c, i) => ({
          name: c.name,
          expected: c.expected,
          passed: results[i].result === hex([c.expected ? 1n : 0n]),
          error: results[i].error ?? null,
        })),
      });
    }
  const [again] = await request([
    {
      name: "recheck-pinned-block",
      method: "eth_getBlockByNumber",
      params: [block, false],
    },
  ]);
  report.blockStable = again.result?.hash === head.result.hash;
  report.status =
    report.blockStable &&
    report.primitives.every((r) => r.passed) &&
    report.generatedVerifiers.every((r) => r.cases.every((c) => c.passed))
      ? "selected-read-only-execution-passed"
      : "incomplete-or-failed";
} catch (error) {
  report.status = "incomplete-or-unavailable";
  report.error = error.message;
}
await writeFile(out, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    status: report.status,
    chainId: report.chainId,
    primitives: report.primitives,
    generatedVerifiers: report.generatedVerifiers,
    output: out,
  }),
);
