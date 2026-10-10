import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createProfile } from "../core.mjs";
import { prove, closeProver } from "../prover.mjs";
import { deployment, metadata } from "../test/fixtures.mjs";
const [name, system, out] = process.argv.slice(2);
const p = await createProfile(),
  old = p.note(deployment, metadata, 1n, 2n),
  next = p.note(deployment, metadata, 3n, 4n),
  tree = new p.Tree();
tree.append(BigInt(old.commitment));
const input =
  name === "create"
    ? p.creationInput(old)
    : p.spendInput(old, next, tree.path(0));
const rows = [];
let result;
try {
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    result = await prove(name, input, system);
    rows.push({
      milliseconds: performance.now() - start,
      rssBytes: process.memoryUsage().rss,
    });
  }
  const report = {
    format: "zft-shielded-desktop-prover-v1",
    name,
    system,
    node: process.version,
    arch: process.arch,
    platform: process.platform,
    samples: rows,
    maxRssKiB: process.resourceUsage().maxRSS,
    proofBytes: (result.data.length - 2) / 2,
    proof: result.proof,
    publicSignals: result.publicSignals,
    args: result.args,
    data: result.data,
  };
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      name,
      system,
      samples: rows,
      maxRssKiB: report.maxRssKiB,
      proofBytes: report.proofBytes,
    }),
  );
} finally {
  await closeProver();
}
