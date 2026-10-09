// Read-only preflight. This validates recorded evidence, not its authors' honesty.
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
export const BASE = "673f89dba48a3222be02894ad659a62fe6e58aad";
export const SOURCE_MANIFEST = "research/ps-release-readiness-validation.json";
export const SIGNER = "310A0EAEA8449754CF17E8BBF6B82D1155879DAB";
export const GATES = [
  "independentCrypto",
  "keyCustody",
  "operations",
  "devices",
  "stagingApproval",
];
export const DEVICES = [
  "chromium-desktop-metamask",
  "firefox-desktop-metamask",
  "safari-ios",
  "chrome-android",
];
const hash = (b) => createHash("sha256").update(b).digest("hex");
function boundedFile(path, limit = 1048576) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    throw Error("Regular bounded evidence file required");
  return readFileSync(path);
}
export function artifactHash(root) {
  const rows = [];
  let size = 0;
  function walk(dir) {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, f.name);
      if (f.isSymbolicLink()) throw Error("Build symlinks forbidden");
      if (f.isDirectory()) walk(path);
      else {
        const bytes = boundedFile(path, 64 * 1024 * 1024);
        size += bytes.length;
        rows.push([relative(root, path).split("\\").join("/"), hash(bytes)]);
        if (rows.length > 2048 || size > 64 * 1024 * 1024)
          throw Error("Build exceeds preflight limits");
      }
    }
  }
  walk(root);
  if (!rows.length) throw Error("Build missing");
  return hash(
    JSON.stringify(rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}
export function evaluateRelease(facts, evidence, reportHash) {
  const blockers = [...facts.errors];
  if (
    evidence.sourceManifest !== undefined &&
    evidence.sourceManifest !== SOURCE_MANIFEST
  )
    blockers.push("The fixed release source manifest is required");
  if (evidence.format !== "zft-ps-release-evidence-v1")
    blockers.push("Unsupported evidence format");
  if (evidence.target !== "isolated-staging")
    blockers.push("Only isolated staging is in scope");
  if (evidence.candidate !== facts.head)
    blockers.push("Candidate must match this exact commit");
  if (evidence.artifactSha256 !== facts.artifactSha256)
    blockers.push("Built artifact differs from the approved artifact");
  if (evidence.sourceManifestSha256 !== facts.sourceManifestSha256)
    blockers.push("Source evidence differs from the approved manifest");
  if (!facts.clean) blockers.push("Worktree has unpublished file changes");
  if (!facts.sourcesMatch)
    blockers.push("Source hashes do not match the candidate");
  if (!facts.signedCommits.length || facts.signedCommits.some((x) => !x.valid))
    blockers.push("Every new commit must have the expected verified signature");
  for (const name of GATES) {
    const gate = evidence.gates?.[name];
    if (
      !gate ||
      gate.status !== "approved" ||
      gate.candidate !== facts.head ||
      typeof gate.owner !== "string" ||
      !gate.owner.trim()
    ) {
      blockers.push(name + ": exact-candidate owner approval required");
      continue;
    }
    if (
      typeof gate.report !== "string" ||
      !gate.report ||
      !/^([a-f0-9]{64})$/.test(gate.reportSha256 ?? "")
    ) {
      blockers.push(name + ": hashed report required");
      continue;
    }
    try {
      if (reportHash(gate.report) !== gate.reportSha256)
        blockers.push(name + ": report hash mismatch");
    } catch {
      blockers.push(name + ": report unavailable");
    }
  }
  const crypto = evidence.gates?.independentCrypto;
  if (
    crypto?.independenceConfirmed !== true ||
    crypto?.psOwn01 !== "resolved" ||
    crypto?.unresolvedActionableFindings !== 0
  )
    blockers.push("Independent C1/C4 review and PS-OWN-01 remain open");
  const tested = evidence.gates?.devices?.passedTargets ?? [];
  if (!Array.isArray(tested) || !DEVICES.every((x) => tested.includes(x)))
    blockers.push("Target browser/phone acceptance is incomplete");
  const checks = evidence.checks;
  if (
    !checks ||
    checks.candidate !== facts.head ||
    checks.ci !== "passed" ||
    checks.preview !== "passed" ||
    checks.codeRabbit !== "complete" ||
    checks.actionableFindings !== 0
  )
    blockers.push("Exact-head CI, preview and completed review required");
  if (evidence.gates?.stagingApproval?.apex === true)
    blockers.push("Apex promotion requires a separate decision");
  return {
    ready: blockers.length === 0,
    candidate: facts.head,
    target: "isolated-staging",
    blockers,
  };
}
export function collectFacts(root) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const errors = [],
    head = git("rev-parse", "HEAD");
  let sourceManifestSha256 = null,
    sourcesMatch = false,
    built = null;
  try {
    const file = boundedFile(resolve(root, SOURCE_MANIFEST)),
      value = JSON.parse(file);
    sourceManifestSha256 = hash(file);
    const entries = Object.entries(value.sourceSha256);
    sourcesMatch =
      entries.length > 0 &&
      entries.every(([name, expected]) => {
        const path = resolve(root, name);
        if (!path.startsWith(root + "/")) return false;
        return hash(boundedFile(path, 8 * 1024 * 1024)) === expected;
      });
  } catch {
    errors.push("Current source evidence is unavailable");
  }
  try {
    built = artifactHash(join(root, "dist/web"));
  } catch (e) {
    errors.push(e.message);
  }
  let commits = [];
  try {
    git("merge-base", "--is-ancestor", BASE, head);
    commits = git("rev-list", BASE + ".." + head)
      .split("\n")
      .filter(Boolean);
  } catch {
    errors.push("Candidate is not based on the reviewed baseline");
  }
  const signedCommits = commits.map((commit) => {
    const r = spawnSync("git", ["verify-commit", "--raw", commit], {
      cwd: root,
      encoding: "utf8",
    });
    const raw = (r.stderr ?? "") + "\n" + (r.stdout ?? "");
    return {
      commit,
      valid:
        r.status === 0 &&
        raw
          .split("\n")
          .some(
            (l) =>
              l.startsWith("[GNUPG:] VALIDSIG ") &&
              l.split(" ").includes(SIGNER),
          ),
    };
  });
  const tracked = git("status", "--porcelain", "--untracked-files=no"),
    untracked = git("ls-files", "--others", "--exclude-standard")
      .split("\n")
      .filter(Boolean)
      .filter(
        (f) =>
          !(f === "node_modules" && lstatSync(join(root, f)).isSymbolicLink()),
      );
  return {
    head,
    errors,
    clean: !tracked && !untracked.length,
    sourcesMatch,
    sourceManifestSha256,
    artifactSha256: built,
    signedCommits,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = resolve("."),
    evidencePath = resolve(
      process.argv[2] ?? "research/ps-release-evidence-template.json",
    );
  const evidence = JSON.parse(boundedFile(evidencePath)),
    facts = collectFacts(root);
  const result = evaluateRelease(facts, evidence, (path) =>
    hash(boundedFile(resolve(path))),
  );
  console.log(
    JSON.stringify(
      {
        ...result,
        sourceManifestSha256: facts.sourceManifestSha256,
        artifactSha256: facts.artifactSha256,
        signedCommits: facts.signedCommits,
      },
      null,
      2,
    ),
  );
  process.exitCode = result.ready ? 0 : 1;
}
