# PS release sequence

The user authorized completing each engineering step, committing it, and continuing to the next. Baseline: merged PR #23, `673f89dba48a3222be02894ad659a62fe6e58aad`. This sequence refines [C1–C6](IMPLEMENTATION.md#ps-credential-work); it does not mark external review or device acceptance complete.

| Step | Deliverable and exit evidence | Status |
| --- | --- | --- |
| 1. Product interface | Collection and issuer-scoped item routes; JPG/PNG preparation; private file receive; explicit public/private export; saved recovery before mint/claim/cancel and restoration | Local implementation and selected desktop acceptance complete; [evidence](PS-PRODUCT-INTERFACE.md). Hosted activation stays closed |
| 2. Identity and public proofs | Separate credential validity, wallet endorsement and signed issuer observation; opt-in public presentation, bounded public routes and sharing metadata | Local implementation and automated evidence complete; [public presentation](PS-PUBLIC-PRESENTATION.md). Native anonymous publication passed; real extension and wallet-endorsed UI acceptance pending; no current-ownership claim |
| 3. Persistent issuer | Stable pinned trust, private keys, durable registry, admission and resource limits; restart/restore tests | [Persistent local prototype](PS-PERSISTENT-LOCAL.md) and selected restart tests complete. Production key custody, operational qualification and hosting remain gated |
| 4. Independent review | Reviewer named, exact signed revision, independently authored adversarial vectors, findings and retests including PS-OWN-01 | Handoff prepared; reviewer unassigned. This is an external release dependency, not a task the implementation author can self-certify |
| 5. Recovery and operations | Backups/restore drills, rollback and equivocation policy, outage behavior, retention, monitoring, key compromise and rotation procedure | [Offline backup/restore tooling and drills](PS-LOCAL-OPERATIONS.md) and [local live health](PS-OPERATIONS-HEALTH.md) implemented. Global freshness, production key lifecycle, retention, alert delivery and operator qualification remain open |
| 6. Browser and device acceptance | Real target browsers, wallet extension, phone download/reselect/claim, accessibility and storage/lifecycle failures | [Target matrix and runbook](PS-ACCEPTANCE-MATRIX.md) prepared; selected Codex desktop checks only. Real extension/phone evidence pending |
| 7. Staging and limited release | Reviewed resources/configuration, release gates, controlled canary, monitoring and rollback; explicit release approval | [Read-only preflight](PS-RELEASE-PREFLIGHT.md) implemented; signed candidate published for review; release remains blocked by missing external evidence. No deployment |

Continue engineering where dependencies permit while recording blocked external gates. A bot review, signed commit, large test suite or distinct curve backend is not independent cryptographic validation. [PS-OWN-01](PS-REVIEW-PACKET.md#open-review-item-former-holder-and-cross-asset-forgery) remains open before real assets or hosting.

## Commit and release policy for this sequence

October 9 user update: remaining implementation is consolidated on one branch with unsigned local checkpoints, followed by batch signing and one final PR. See the [consolidated candidate checklist](PS-CONSOLIDATED-CANDIDATE.md). This supersedes the earlier per-increment signing/PR cadence, while release gates remain in force.

The user authorized unsigned local increments during development, then requested batch signing. All five increments were signed and verified without changing their trees and published in [PR #24](https://github.com/0x3639/zft/pull/24). The unsigned originals remain on a local backup branch. Repository/global signing configuration is unchanged. PR #24 merged at `b89cf61c3961b55f8fff5631a72c1c5740bfd3d7` after six verified signed commits, clean latest-head CodeRabbit and green CI/preview. PRs #25–#29 followed that earlier signed-increment cadence. The current consolidated candidate instead uses unsigned local checkpoints followed by final batch signing and one PR, as directed above. Never rewrite merged/published history; no merge or deployment follows automatically from a commit.

Keep the v1 protocol/data, frozen PS reference artifacts and historical evidence manifests intact. New current manifests record their own source hashes and inherited evidence. ZVM downtime does not block local PS work. Initial MetaMask inventory display is unnecessary; an optional display Snap follows the core experience.

## Custody contract experiment after PR #26

PR #25 merged at `f3bb3bfcb8d4e60344a33dfaea6fd5d5bf3a0c27` after clean exact-head review and CI/preview. The [hosting/custody proposal](PS-HOSTING-CUSTODY-DESIGN.md) then merged in PR #26 at `19d4c35af70d17c9df85206c37cbed64f8e11b0c`, also with clean exact-head review and checks. Provider, reviewer and resource choices remain pending.

The next local increment implements the [status signer contract](PS-STATUS-SIGNER-CONTRACT.md): raw Ed25519 request/response validation, pinned-key verification, owned message bytes, bounded async lifecycle and selected compatibility tests. It has no private-key loader, cloud access or live issuer integration. Protected storage, qualified PS secret operations and durable asynchronous signing remain subsequent engineering; none of the seven release gates is promoted by this adapter.

## Key-envelope experiment after PR #27

PR #27 merged at `f69b8302ab44ab30c22c9126584f88e5718616f7` after clean exact-head CodeRabbit and green CI/preview on signed head `50dd3baa991b48ea966c0a329908ab07a54b89bf`. The [next local experiment](PS-KEY-ENVELOPE.md) defines the encrypted record for long-lived PS scalars and tests injected wrapping/unwrap failures. It leaves the existing issuer and every historical manifest intact.

Next work remains qualified secret execution, actual provider identity/permissions, durable asynchronous integration, protected session state and whole backups, hosted admission/fencing/retention/alerts, target devices and independent review. Provider/account/region/budget/operator and reviewer are unassigned; neither this record format nor its merge authorizes resources, migration or staging.

## Encrypted key-file experiment after PR #28

PR #28 merged at `0259f76e78abdc1ee85d9e58e839531215302e35` after clean exact-head CodeRabbit and green CI/preview on signed head `7f81ec92529f65018e7ed4cf00bdcecbefcc2506`. The [next local experiment](PS-KEY-FILE.md) adds a create-only private ciphertext file, explicit digest selection, publication/synchronization failure handling and real process-kill/race tests. It composes the unchanged envelope adapter without calling the serving issuer or migrating any data.

The selected local filesystem experiments do not qualify power-loss durability, network filesystems, global writer fencing, rollback freshness, provider custody or production key execution. Existing plaintext issuer/session stores and all external release gates remain unchanged. Subsequent integration still needs an approved key/configuration/checkpoint authority and durable async issuer recovery; none follows automatically from file publication.

## Consolidated service after PR #29

PR #29 merged at `23df3222f9b3bd280b9947846eb78ba96d3d069c`. The [consolidated candidate](PS-CONSOLIDATED-CANDIDATE.md) completes provider-neutral integration in one change: protected session/whole-backup records, asynchronous issuer/status commits, exact recovery, stopped restore/wrapping rotation, explicit admission, HTTP/client composition and operator procedures. The original local issuer and application stay unchanged. Its local checkpoints remain unsigned until the final batch-signing pass; only then is one PR published. Actual provider/backend qualification, independent review, global operational acceptance, devices and staging approvals remain external dependencies.
