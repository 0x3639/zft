import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateRelease,
  artifactHash,
  GATES,
  DEVICES,
} from "./check-ps-release.mjs";
// Synthetic evidence tests validator decisions; no real approvals are asserted.
function fixture() {
  const head = "1".repeat(40),
    digest = "2".repeat(64),
    facts = {
      head,
      errors: [],
      clean: true,
      sourcesMatch: true,
      artifactSha256: digest,
      sourceManifestSha256: digest,
      signedCommits: [{ commit: head, valid: true }],
    },
    evidence = {
      format: "zft-ps-release-evidence-v1",
      target: "isolated-staging",
      candidate: head,
      artifactSha256: digest,
      sourceManifestSha256: digest,
      gates: Object.fromEntries(
        GATES.map((name) => [
          name,
          {
            status: "approved",
            candidate: head,
            owner: "synthetic test reviewer",
            report: "test report",
            reportSha256: digest,
          },
        ]),
      ),
      checks: {
        candidate: head,
        ci: "passed",
        preview: "passed",
        codeRabbit: "complete",
        actionableFindings: 0,
      },
    };
  Object.assign(evidence.gates.independentCrypto, {
    independenceConfirmed: true,
    psOwn01: "resolved",
    unresolvedActionableFindings: 0,
  });
  evidence.gates.devices.passedTargets = [...DEVICES];
  return {
    facts,
    evidence,
    check: () => evaluateRelease(facts, evidence, () => digest),
  };
}
test("release preflight accepts only a complete synthetic exact-candidate record", () => {
  const f = fixture();
  assert.equal(f.check().ready, true);
});
test("later candidate cannot inherit an earlier review or CI result", () => {
  for (const name of [...GATES, "checks"]) {
    const f = fixture();
    (name === "checks" ? f.evidence.checks : f.evidence.gates[name]).candidate =
      "3".repeat(40);
    assert.equal(f.check().ready, false);
  }
});
test("mixed unsigned commits block release even when evidence claims approval", () => {
  const f = fixture();
  f.facts.signedCommits.push({ commit: "4".repeat(40), valid: false });
  assert.equal(f.check().ready, false);
});
test("open ownership review or same-author review cannot satisfy independent release gate", () => {
  for (const change of [
    { psOwn01: "open" },
    { independenceConfirmed: false },
    { unresolvedActionableFindings: 1 },
  ]) {
    const f = fixture();
    Object.assign(f.evidence.gates.independentCrypto, change);
    assert.equal(f.check().ready, false);
  }
});
test("artifact substitution changed source evidence and dirty worktrees block release", () => {
  for (const key of [
    "artifactSha256",
    "sourceManifestSha256",
    "clean",
    "sourcesMatch",
  ]) {
    const f = fixture();
    f.facts[key] = key.endsWith("Sha256") ? "5".repeat(64) : false;
    assert.equal(f.check().ready, false);
  }
});
test("missing device and report evidence are not satisfied by test counts", () => {
  const f = fixture();
  f.evidence.gates.devices.passedTargets.pop();
  assert.equal(f.check().ready, false);
  const badType = fixture();
  badType.evidence.gates.devices.passedTargets = DEVICES.join(",");
  assert.equal(badType.check().ready, false);
  const g = fixture();
  assert.equal(
    evaluateRelease(g.facts, g.evidence, () => {
      throw Error("not found");
    }).ready,
    false,
  );
  assert.equal(
    evaluateRelease(g.facts, g.evidence, () => "0".repeat(64)).ready,
    false,
  );
});
test("isolated staging approval cannot authorize apex promotion", () => {
  const f = fixture();
  f.evidence.gates.stagingApproval.apex = true;
  assert.equal(f.check().ready, false);
});
test("artifact fingerprint changes for added modified or removed files and rejects symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "zft-release-artifact-"));
  try {
    writeFileSync(join(dir, "index.html"), "a");
    const first = artifactHash(dir);
    writeFileSync(join(dir, "index.html"), "b");
    assert.notEqual(artifactHash(dir), first);
    const second = artifactHash(dir);
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "x");
    assert.notEqual(artifactHash(dir), second);
    rmSync(join(dir, "assets", "app.js"));
    assert.equal(artifactHash(dir), second);
    symlinkSync(join(dir, "index.html"), join(dir, "alias"));
    assert.throws(() => artifactHash(dir), /symlinks/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("operator evidence cannot substitute a partial source manifest", () => {
  const f = fixture();
  f.evidence.sourceManifest = "research/partial-one-file.json";
  const result = f.check();
  assert.equal(result.ready, false);
  assert(result.blockers.some((x) => /source manifest/.test(x)));
  f.evidence.sourceManifest = "research/ps-release-readiness-validation.json";
  assert.equal(f.check().ready, true);
});
