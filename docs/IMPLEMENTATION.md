# Implementation plan and acceptance gates

Implementation authorized 2026-10-04. The first devnet slice now implements the contract, protocol/codec/vault, core transaction frontend, and a Cloudflare sponsor/API. The contract is deployed and the live SDK/Worker canary passes. See [DEVNET-ALPHA.md](DEVNET-ALPHA.md) for exact status, evidence, and remaining gates. The table below remains the full release target; public profile/social/OG parity and production indexing are still pending.

## 1. Delivery order

| Milestone | Deliverable | Acceptance gate |
| --- | --- | --- |
| M0 · Review | Scope, ownership model, recovery policy, frontend direction, host/domain, release boundary | Resolve blocking decisions; accepted spec revision |
| M1 · Protocol foundations | Workspace, schemas, SDK typed data, vault/pending-key journal, canonical image/file codec | Frozen golden vectors; malformed/stale-file behavior; recovery restore; no secret upload path |
| M2 · Contract | Non-upgradeable ZFT, tests, deployment scripts, shared signing vectors | Unit/fuzz/invariant tests; reviewer can reproduce signature/nonce behavior locally |
| M3 · Cloudflare services | Workers routes, R2/D1 bindings, sponsor DO, indexer, quotas, signed social relations, HTML share heads and unique OG generation | Idempotent jobs, crash/retry and nonce reconciliation; reorged index rebuild; isolated previews; crawler-visible per-page images |
| M4 · Product frontend | React screens based on prototype, public profiles/tabs/detail views, real vault/codec/client integration | Two-browser mint/export/claim/re-export/cancel, updated backup restore, profile/social/share parity, mobile/accessibility |
| M5 · Devnet beta | Verified contract canary, Cloudflare custom domain, deployment manifest, operations runbook | Independent endpoint/client verification; review of ZVM assumptions; public test flow and incident/recovery drill |
| M6 · Optional expansion | Encrypted links/backups, wallet integration, Karum, private protocol research | Separate specifications and reviewed trust/settlement model per feature |

Some implementation work can overlap, but freeze SDK/contract signing vectors before wiring sponsorship. The image codec and pending-key persistence are prerequisites for live claims, not polish deferred to launch.

## 2. Planning estimate

For one experienced engineer, use **approximately 5–8 engineering weeks** as a planning range for the proposed devnet beta, including profile/social pages and unique OG previews, after decisions are settled. This excludes waiting for an independent security review, ZVM changes, unavailable source/specs, custom private cryptography, and marketplace settlement. Re-estimate after M1 validates codec performance and sponsor transport. These are effort estimates, not promises of calendar delivery.

A smaller proof-of-concept can land sooner by omitting discovery/profiles and using local-only collection display. Do not reduce scope by dropping key persistence, signature binding, or race/reorg verification.

## 3. Verification matrix

| Area | Meaningful verification |
| --- | --- |
| Contract | Wrong signer/domain/nonce/recipient, expiry, duplicate mint, malleable signatures, concurrent rotations, standard transfers, receiver hooks, stateful epoch invariant |
| File codec | Canonical hashes across fixtures/platforms, JPEG/PNG roundtrip, EXIF orientation, alpha, duplicate envelopes, truncated lengths, CRC mismatch, large numeric IDs, malformed image rejection |
| Vault | Encrypt/decrypt, wrong passphrase, record AAD substitution, recovery snapshot completeness, browser-close-before-claim, interrupted backup, stale key reconciliation |
| API/sponsor | Schema/body limits, envelope rejection, signed challenge consumption, quota/simulation rules, fixed target/method, outbox idempotency, crash before/after broadcast, fee replacement and nonce gap handling |
| Indexer | Duplicate delivery, checkpoint rewind, parent hash mismatch, finalized/unfinalized labeling, deployment/genesis reset detection |
| Frontend | Real two-browser flow, stale file, cancel race, refresh pending, sponsor unavailable, backup missing/outdated, restored collection, mobile and accessibility |
| Hosting | SPA deep links, Worker API routing, immutable art/metadata MIME/hash/cache, isolated secrets/buckets, CSP, deployment rollback |

Suggested tooling: Foundry for contract tests; Vitest for protocol/codec/vault/service logic; Cloudflare’s supported Workers test harness for bindings; Playwright for real end-to-end scenarios. Pin versions in M1. Do not write superficial snapshot tests to substitute for protocol assertions.

## 4. Devnet acceptance script

1. Deploy and verify a canary on the allowlisted ZVM devnet. Pin deployment block and bytecode hash.
2. Browser A creates a vault, saves recovery, and mints a fixture image. Inspect its mint and owner in explorer/RPC.
3. A exports the original file twice. Browser B imports one copy, saves its pending recipient key, and claims.
4. Close B after submission, reopen, and reconcile. Confirm B’s local fresh key owns the finalized token.
5. Browser C imports the other old copy and gets a stale-copy rejection without a valid rotation.
6. B re-exports to C; C claims with a fresh key, proving repeated transfer preserves the same token ID.
7. Repeat with sender cancellation, then concurrent claim/cancel. Exactly one valid nonce transition succeeds.
8. Restore an updated recovery bundle into a clean browser and export the currently owned item. Show that an earlier snapshot does not contain newly acquired keys.
9. Disable sponsor and simulate RPC outage. Local viewing remains available; signing/export dependent on current ownership is correctly gated.
10. On a controlled test chain or documented ZVM test fixture, force reorg/reset conditions. Verify journals/indexes recover and old deployment files are not silently reused.

A public devnet test by itself cannot force network reorgs safely. Use controlled infrastructure/test fixtures for failure injection and independent operators for ZVM state reproduction.

## 5. Launch artifacts

Before beta, commit the actual deployment manifest, contract source verification link, environment/binding documentation without secrets, threat/invariant review, backup guide, incident runbook, dependency/license inventory, measured Cloudflare limits, sponsorship budget, and reproducible acceptance evidence. Build hashes identify the reviewed frontend release.

The initial public beta remains clearly labeled ZVM devnet and collectible-only. Enabling sales or mainnet moves through another explicit review. An ERC-721 interface check and six BLS precompile probes are preliminary capability evidence, not proof that ZFT or ZVM is production-ready.

## 6. Repository and CI workflow

The empty repository receives this proposal/prototype as its initial commit. Subsequent implementation should use focused pull requests for M1–M5. CI checks TypeScript/build, protocol vectors, meaningful service tests, contract suites, and end-to-end scenarios as they become applicable. Documentation/prototype changes need focused link/syntax/layout checks rather than pretending the future backend already exists.

Cloudflare beta deployments use a scoped environment; PR previews have separate services and no beta sponsor authority. Production/mainnet deployment is not triggered merely by merging a UI change. Contract deployment requires explicit network/key configuration and verification of the approved source artifact.
