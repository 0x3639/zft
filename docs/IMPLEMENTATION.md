# ZFT implementation roadmap and acceptance gates

This roadmap tracks delivered work and the balance of the ZFT specification. The hosted devnet alpha is live; wallet custody, the remaining public-site features and beta qualification are the active backlog. Use this document for work status, [FUNCTIONAL-SPEC.md](FUNCTIONAL-SPEC.md) for required behavior, and [DEVNET-ALPHA.md](DEVNET-ALPHA.md) for deployed operation and limitations.

## Roadmap status

This is the work tracker for the [complete functional specification](FUNCTIONAL-SPEC.md). Update it in the same change as implementation or acceptance evidence. Last reconciled: **2026-10-05**, merged baseline **`cb8e2b1`** ([PR 1](https://github.com/0x3639/zft/pull/1)); current increment `feat/wallet-first-onboarding`, implementation commit **`c79bcb3`**. Live Worker **`f0261da2-d978-4781-8e03-b72b2f6b77df`** ([deployment checks](../research/wallet-first-deployment.json)).

Status meanings: **Complete** means the stated deliverable and its listed verification are complete; it does not imply all release gates passed. **In progress** means work is underway. **Next** means ready to implement. **Pending acceptance** means code exists but the specified real-world check remains. **Deferred** means a separately scoped protocol or launch decision is required. Do not use a percentage: these workstreams differ substantially in effort.

Current focus: **R1.7/R1.8 wallet-first onboarding and optional file protection**, implemented with the existing contract/API. Wallet mint/receive and profile signatures no longer require local keys. File sessions use memory by default or optional encrypted browser persistence; every new file key is backed up before submission. Device acceptance remains R1.5/R1.6. **R2 discovery/homepage is the next implementation slice.**

| Work | Status | Completed baseline or remaining deliverable | Acceptance |
| --- | --- | --- | --- |
| B1 Core ownership | Complete for SDK and Worker scope | Deployed ERC-721, codec, encrypted vault, mint/export/claim/cancel/recovery; real devnet canary | [Transaction evidence](../research/hosted-devnet-canary.json); device acceptance remains R6 |
| B2 Public proof and navigation | Complete for recorded scope | Collection-first profiles, Network dialogs, guest entry, proof card, historical epochs, safe proof download, theme/menu/lookup | [Browser evidence](../research/public-ui-acceptance.json); A-NAV/A-PROFILE/A-ITEM/A-PROOF subset |
| B3 Page sharing | Complete for recorded scope | Initial HTML, current-holding collages, selected epochs, bounded thumbnail derivatives | [Hosted check](../research/public-canary.json), [renderer fixtures](../research/sharing-fixtures/results.json); remaining sharing checks in R5/R6 |
| R1 Wallet custody | Pending acceptance | Custody transitions, wallet-first mint/receive/profile auth and optional file protection implemented; actual wallet/device acceptance remains | A-WALLET, A-TRANSFER, A-RECOVERY |
| R2 Discovery and homepage | Next | Collection and NFT search/sorts/cursors; rankings, fresh art and homepage navigation | A-HOME, A-DISCOVERY |
| R3 Activity | Next after event schema | Public event journal, Everyone/Following, actor/item links, profile feed, honest times | A-ACTIVITY, A-PROFILE |
| R4 Profile media | Next | Avatar/cover upload, local preview/crop/reset, signed save, sharing revisions | A-PROFILE, A-SHARE |
| R5 Help and remaining sharing | Next | Basics/Technical views, task-aware CTAs, technical metadata and remaining image compositions | A-NAV, A-SHARE |
| R6 Browser and device acceptance | Pending acceptance | Actual wallet extension, two-browser/phone ownership and recovery, accessibility and errors | A-WALLET, A-TRANSFER, A-RECOVERY, A-NAV |
| R7 Operations and release review | Pending acceptance | Sponsor fault injection, chain reorg/reset drills, limits, incident procedures, independent review | A-OPERATIONS |
| R8 Apex promotion | After R6/R7 and release review | Reviewed build/deployment settings, `zft.foo` app routing, smoke checks and rollback | Hosting/release acceptance |
| R9 Curated collections | Scope decision open | Group public items at `/c/:collectionId`; decide whether part of this beta | A-DISCOVERY, A-PROFILE, A-SHARE |
| E1 Encrypted sharing and remote backup | Deferred | Separate encryption/storage/recovery/retention protocol | New protocol review and recovery/race tests |
| E2 Marketplace | Deferred | Verify Karum deployment/source/order types, payment asset, safe payouts; then listings/offers/settlement | A-MARKET; [exchange plan](MARKETPLACE.md) |
| E3 Mainnet and private ownership | Outside devnet release | Mainnet launch and privacy research are separate projects | Independent design and launch review |

## Remaining work checklist

### Wallet custody

- [x] Provider discovery, explicit connection, pinned network add/switch, account/network/disconnect handling and balance UI.
- [x] Confirm the existing deployed contract can authorize both custody directions without exporting a wallet private key.
- [x] R1.1 Shared wallet session and on-chain wallet inventory with unavailable/wrong-network states.
- [x] R1.2 Prepare a fresh disposable destination, persist it and require its recovery acknowledgment before wallet authorization.
- [x] R1.3 Verify the exact wallet signer/domain/recipient/epoch, persist authorization, submit and reconcile without replacing a pending destination.
- [x] R1.4 Return file custody to the selected wallet; invalidate old exports; distinguish wallet ownership from stale local records.
- [ ] R1.5 Complete custody acceptance: 12 automated tests cover rejection, account/network/disconnect, invalid signature, unavailable sponsor/RPC, expiry/retry, recovery restore, competing edits and simulated round trip. The [hosted SDK round trip](../research/hosted-wallet-canary.json) also passed four confirmed transactions, stale-file rejection and indexed inventory; real browser restart and competing on-chain claim acceptance remain open.
- [ ] R1.6 Exercise an actual MetaMask extension and phone wallet. Mock-provider tests do not close this item.
- [x] R1.7 MetaMask-first onboarding, direct wallet mint/receive, wallet-backed profile authentication without a ZFT password, and resumable public wallet-operation journals. Explicit identity selection preserves existing local profiles; no linking/merging or implicit publication. Tests cover rejection, changed account/network, signature mismatch, lost responses, nonce changes and competing journal writes; actual extension/mobile acceptance remains R1.6.
- [x] R1.8 Optional “Protect this browser with a password” and default session-only file keys. Existing encrypted vaults and v1 recovery remain compatible; upgrade preserves keys/identity. New-key acknowledgment gates every file-custody submission. Manual lock/session end, 15-minute inactivity lock and unload guidance implemented. Automated memory-only persistence, backup gating, recovery, wrong-passphrase, overwrite refusal and upgrade tests pass; device acceptance remains R6. [Reference storage evidence](../research/reference-key-storage.json).

### Discovery and homepage

- [ ] R2.1 Versioned metadata/profile search projections and a real profile creation field; preserve unknown legacy creation times rather than inventing dates.
- [ ] R2.2 Collection directory: name search, Popular/Newest/Biggest ranking, consistent counts and independent like actions.
- [ ] R2.3 NFT directory: title search, Newest/Oldest/A–Z, deterministic bounded cursors and current collector context when unambiguous.
- [ ] R2.4 Homepage ranked collections, fresh artwork, recent activity, explanation and onboarding/recovery CTAs using real data.
- [ ] R2.5 Full-dataset filters before pagination; duplicate/tie/stale-response/empty-result checks; keyboard and mobile acceptance.

### Activity

- [ ] R3.1 Append-only public profile/social/publication event journal; atomic idempotent transitions and explicit reversal policy.
- [ ] R3.2 Everyone/Following, distinct guest/zero-follow/empty-feed states, stable cursor pagination and profile feed.
- [ ] R3.3 Actor/target profile links, NFT links/thumbnails, absolute/relative timestamps and secondary explorer proof links.
- [ ] R3.4 Unpublish visibility, duplicate requests and reorg rollback tests; never infer a known person's gift or sale from a raw address transition.

### Profile media and help

- [ ] R4.1 Versioned avatar/cover references and signed bounded upload; reject transferable envelopes and active content.
- [ ] R4.2 Local preview/crop, explicit save, optimistic revision checks and reset to default.
- [ ] R4.3 Apply public media to profiles, directory/home cards and OG revisions; old public cache limitations remain explicit.
- [ ] R4.4 Verify image limits, wrong-profile writes, malformed uploads, fallback, responsive crop and keyboard controls.
- [ ] R5.1 Basics/Technical help with URL/history state and correct ZVM/file/recovery explanations.
- [ ] R5.2 Distinct technical-page HTML/OG; page-specific discovery/home artwork where appropriate.
- [ ] R5.3 Finish copy-failure, not-found, outage, long-title/crop and 0/1/2/3+ collection sharing checks against the full spec.

### Acceptance and launch

- [ ] R6.1 Run the browser acceptance script below, including current/outdated recovery and interrupted pending operations.
- [ ] R6.2 Validate keyboard/screen-reader/reduced-motion/large-text behavior at 320/360/768/1440px; preserve scroll/focus and error states.
- [ ] R6.3 Exercise historical public proofs after an actual post-publication transfer and unpublish; inspect downloaded artifacts.
- [ ] R6.4 Verify target social-platform previews/recrawls and hosted large-art behavior; local workerd timing is not a hosted CPU guarantee.
- [ ] R7.1 Sponsor crash before/after broadcast, retry/nonce gaps, fee replacement and ambiguous-state recovery.
- [ ] R7.2 Controlled reorg/reset/deep rollback tests and independent ZVM/finality assumptions; preserve deployment mismatch stops.
- [ ] R7.3 Storage/admission/journal retention, performance/limits and incident/rollback procedures with measured evidence. Current Vite entry bundle is about 664 kB minified / 202 kB gzip and triggers its size warning; evaluate route splitting during performance work.
- [ ] R7.4 Release review, dependency/license inventory and source-license decision; approved explorer source publication remains separate.
- [ ] R7.5 Remove sponsor RPC waits from authentication and status polling. CodeRabbit identified the shared serial queue in `apps/api/sponsor.ts`: a slow RPC blocks challenges/authentication and queues polling behind submissions. Preserve atomic one-time challenge consumption and quota counters through a separate auth service or atomic D1 transitions; retain serialization for sponsor nonces/broadcasts. Prove bounded auth/poll latency under a stalled RPC and concurrent submissions, and test challenge replay and quota races before changing this boundary.
- [ ] R8.1 Review release artifact and apex/Git deployment configuration; preserve canonical art and metadata routes.
- [ ] R8.2 Promote the app to `zft.foo`, verify fresh/deep/private routes and rollback, and update the runbook.

## Decisions and dependencies

Continue ready work without reopening the confirmed domain, visual theme, Cloudflare hosting, real devnet implementation, or MetaMask direction. Remaining decisions are curated-collection beta scope; long-term historical publication retention; whether portable profile-key endorsements are required; project source license; encrypted-link/remote-backup protocol; and the verified exchange/payment asset. An unanswered expansion decision does not block the existing collectible app.

Confirmed custody direction: MetaMask controls ordinary holdings and profile actions; a fresh independent disposable key controls each transferable file. Wallet private keys are never requested/exported. Wallet and local profiles remain separate, explicitly selectable identities with no automatic linking. File custody is session-only by default; password protection is optional for remembered browser keys. Existing protected vaults stay protected. A recovery download is a secret bearer snapshot, unaffected by the browser password.

No completion date is committed. Re-estimate each implementation slice from the actual remaining work and external acceptance dependencies rather than carrying forward the original pre-implementation estimate.

## Work tracking rules

For each slice, record its IDs, code/schema changes, tests, remaining gaps, commit/PR and deployed version. Check an item only when its stated outcome has evidence; a prepared patch, successful click, mocked provider or SDK canary does not establish real-device acceptance. Update the functional specification when semantics change and the runbook when deployed behavior changes. Keep unresolved findings with their affected roadmap ID. Maintain this tracker in the repository; no external issue tracker or recurring automation is configured.

### Delivery log

R1.7/R1.8 validation: **93 TypeScript and 14 Foundry tests**, typecheck, frontend build and Worker dry run pass. The [hosted wallet-first canary](../research/hosted-wallet-first.json) confirmed direct mint, session-file custody, and direct receipt in a second wallet; scoped wallet profile authentication and stale-file rejection passed. [Browser inspection](../research/wallet-first-ui.json) covers desktop/360px onboarding and recovery gates. Actual MetaMask/phone and full recovery UI acceptance remain open; these items are not counted as completed by the SDK canary.

| Date | Work | Evidence and remaining work |
| --- | --- | --- |
| 2026-10-04 | B1 core hosted alpha | Contract `0x42666265e38f2d1b786e8af8e9576224a95b90ae`; [runbook](DEVNET-ALPHA.md), hosted SDK canary; device/operations gates remain |
| 2026-10-04 | B2/B3 public parity | Commit `da97ce2`; 31 TypeScript tests, CI and preview build passed; live version `027deb34-587b-4b19-9383-35b657cfecd7`; wallet custody and R2–R8 remain |
| 2026-10-04 | R1.1–R1.4 implemented and deployed | `/wallet`, indexed wallet inventory, backed-up destination keys, typed authorization, resumable sponsor jobs, return-to-wallet and conditional vault writes; 42 TypeScript tests/typecheck/frontend build/Worker dry run passed. Actual MetaMask/phone acceptance and R1.7/R1.8 remain open. Version `a5a54d62-0d22-4fd4-9355-dc0c31470c52`; [hosted canary](../research/hosted-wallet-canary.json) passed at blocks 95002/95009/95016/95023. |
| 2026-10-04 | PR #1 CodeRabbit follow-up · B2/B3, R1.5, R5.3 | Commit `7f65ba0` fixes four validated findings: isolate invalid token metadata; serve the app shell when share metadata/storage fails; preserve interrupted claim/cancel retries and renew reverted jobs without changing destination keys; correct custody documentation. Numeric validation rejects malformed selections before BigInt conversion. 67 tests pass, including 11 workerd HTML cases, plus typecheck/build/Worker dry run; GitHub CI and Cloudflare preview passed. Deployed version `b7464b4d-00d6-4271-bd01-85c86d74d789`; [six hosted route checks](../research/coderabbit-hosted-checks.json) pass and the browser renders the unindexed item's Retry action. Sponsor queue isolation remains open as R7.5. |
| 2026-10-04 | R1.7/R1.8 implemented and deployed | Wallet-first identity/mint/receive; account-scoped public journals; optional protected storage and memory-only file sessions; pre-submission key backups. 93 TypeScript and 14 Foundry tests, typecheck/build/Worker dry run pass. [Three hosted transactions](../research/hosted-wallet-first.json), [UI checks](../research/wallet-first-ui.json), and [exact hosted bundle/private routes](../research/wallet-first-deployment.json) verified. Worker `f0261da2-d978-4781-8e03-b72b2f6b77df`. Actual extension/phone and full browser recovery acceptance remain open; R2 discovery/homepage is next. |

### CodeRabbit review disposition

Review on commit `6738866`, [PR #1](https://github.com/0x3639/zft/pull/1):

- [Invalid metadata breaks a gallery](https://github.com/0x3639/zft/pull/1#discussion_r4180193321): confirmed and fixed. Missing/malformed/schema-invalid/hash/image/creator-mismatched metadata is excluded per token; actual storage outages still fail visibly. Regression tests retain valid peers in gallery, profile tabs and OG collection previews.
- [Share failures return JSON](https://github.com/0x3639/zft/pull/1#discussion_r4180193347): confirmed and fixed, including snapshot R2 lookup/write failures. Workerd tests verify usable HTML, original error status, noindex/no image disclosure, removed stale tags, unavailable asset-shell status and HEAD semantics.
- [Unsent/reverted rotations become stale](https://github.com/0x3639/zft/pull/1#discussion_r4180193351): confirmed and fixed. Prior-owner keys keep the saved transition resumable; retries retain the destination and expected nonce. Reverted operations get a distinct authorization digest before expiry too; live/confirmed jobs remain unchanged and unrelated winning owners stay stale.
- [Stale custody docs](https://github.com/0x3639/zft/pull/1#discussion_r4180193360): corrected in the marketplace proposal and review agenda; real MetaMask/phone acceptance remains open.
- Sponsor queue performance suggestion: valid but deferred to R7.5 because challenge consumption and quota increments currently depend on the same serialization. Removing the queue without an atomic replacement would weaken those guarantees.
- CodeRabbit's generic 80% docstring advisory is not a repository build requirement. No blanket docstring expansion is planned. GitHub verification and Cloudflare preview checks for the reviewed commit passed; the earlier preview configuration failure was already fixed.

## Verification matrix

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

## Browser acceptance script

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

## Launch artifacts

Before beta, commit the actual deployment manifest, contract source verification link, environment/binding documentation without secrets, threat/invariant review, backup guide, incident runbook, dependency/license inventory, measured Cloudflare limits, sponsorship budget, and reproducible acceptance evidence. Build hashes identify the reviewed frontend release.

The initial public beta remains clearly labeled ZVM devnet and collectible-only. Enabling sales or mainnet moves through another explicit review. An ERC-721 interface check and six BLS precompile probes are preliminary capability evidence, not proof that ZFT or ZVM is production-ready.

## Repository and CI workflow

The proposal/prototype and hosted alpha now exist. Continue implementation with focused changes for the roadmap IDs and functional-spec acceptance IDs above. CI checks TypeScript/build, protocol vectors, meaningful service tests, contract suites, and end-to-end scenarios as they become applicable. Documentation/prototype changes need focused link/syntax/layout checks rather than transaction canaries for unchanged code.

Cloudflare beta deployments use a scoped environment; PR previews have separate services and no beta sponsor authority. Production/mainnet deployment is not triggered merely by merging a UI change. Contract deployment requires explicit network/key configuration and verification of the approved source artifact.
