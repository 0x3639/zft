# PS release preflight and external gates

This is preparation for step 7, not a release authorization. The [sequence](PS-RELEASE-PLAN.md) now has local product, public evidence, persistent issuer and offline restore increments. Independent review, production key/operations design, target device acceptance and isolated staging approval remain open. PS is still loopback-only; these changes have not been deployed to devnet or apex.

## Signed candidate and future revisions

The five local development commits were batch-signed and verified with expected fingerprint `310A0EAEA8449754CF17E8BBF6B82D1155879DAB`, retaining an unsigned backup branch, then published in [PR #24](https://github.com/0x3639/zft/pull/24). Shared GPG configuration remains intact. Every follow-up commit must also be signed and verified. Do not bypass a failed signature or rewrite merged/published history.

Signing changes commit IDs. Record the resulting exact candidate and tree in the review handoff. Earlier local test logs may be carried forward only where source/build hashes are identical, with the relationship documented. A later code change invalidates exact-candidate approvals until reviewed again. Push for CodeRabbit/CI review only after the new series is signed; never merge or deploy automatically.

## Required independent evidence

Copy [the pending evidence template](../research/ps-release-evidence-template.json) to a separate operator file outside the source tree. After the signed candidate is fixed, populate it only from real reports and approvals:

- **Independent crypto:** named independent reviewer, exact source candidate, report hash, no unresolved actionable findings and an explicit PS-OWN-01 disposition. A Codex/CodeRabbit result or same-author backend comparison cannot satisfy this gate.
- **Key custody:** production key generation/storage/access, constant-time/side-channel-qualified secret operations, pin distribution, retirement/rotation and compromise response. The local plaintext key file is not this deliverable.
- **Operations:** approved hosting topology and resources, stable registry, fencing/rollback policy, admission identity and limits, retention/recovery availability, backup transport and restore drills, monitoring/alerts and accountable operator. Local snapshots alone do not establish global freshness or operational readiness.
- **Devices:** actual [target matrix](PS-ACCEPTANCE-MATRIX.md) evidence, including extension and phones. Selected desktop automation does not satisfy missing targets.
- **Isolated staging approval:** named release owner and reviewed staging scope/configuration, canary, rollback and monitoring plan. Apex remains a separate decision.

Each gate names the same candidate and a bounded local report file with its SHA-256. The record also needs completed CodeRabbit review, zero actionable findings, green CI and preview against that exact head. The field values are operator attestations: the script checks consistency and hashes, not reviewer independence, honesty, quality or authenticity. Do not turn pending fields into approved merely to make the command pass.

## Run the read-only check

```sh
pnpm ps:release-test
pnpm ps:release-check /absolute/path/to/operator-evidence.json
```

The check verifies source-manifest hashes, the built `dist/web` fingerprint, clean source state, ancestry from merged PR #29 (`23df3222f9b3bd280b9947846eb78ba96d3d069c`), the expected signature on every new commit, exact-candidate report hashes, review/check states and target coverage. The known untracked worktree `node_modules` symlink is permitted; other untracked or tracked changes block readiness. The evidence file is outside Git to avoid a self-referential candidate SHA. Report paths are local operator paths, never issuer/file-selected URLs.

The default template intentionally fails. A successful synthetic test does not represent real approval. The checker only reports readiness for isolated staging; it does not deploy, merge, sign, install resources, contact reviewers or authorize apex. Existing v1 deployment commands are unchanged, and this is not a substitute for human release controls.

## Handoff and remaining decisions

The [review packet](PS-REVIEW-PACKET.md) and [operations policy](PS-LOCAL-OPERATIONS.md) are ready for a reviewer/operator to scope. The independent reviewer is unassigned. Target-device access and final support scope are unconfirmed. Hosting, production key custody and operational ownership are undecided. These are actual release dependencies; no live date or production cryptographic guarantee is asserted.

The source manifest is fixed to `research/ps-consolidated-validation.json`. An operator record cannot substitute a one-file or historical manifest; a different `sourceManifest` value blocks readiness. The checker always reads the fixed path regardless of operator input.

The trusted ancestry baseline advances to merged PR #29 for this consolidated service candidate; the expected signer is checked on every commit after that baseline. Historical validation JSON files, including the PR #24 readiness record, remain unchanged. No pending approval has been promoted.
