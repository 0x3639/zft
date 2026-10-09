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

The user authorized unsigned local increments during development, then requested batch signing. All five increments were signed and verified without changing their trees and published in [PR #24](https://github.com/0x3639/zft/pull/24). The unsigned originals remain on a local backup branch. Repository/global signing configuration is unchanged. PR #24 merged at `b89cf61c3961b55f8fff5631a72c1c5740bfd3d7` after six verified signed commits, clean latest-head CodeRabbit and green CI/preview. New operations work starts from that merged baseline with signed commits on its own branch. Never rewrite merged/published history; no merge or deployment follows automatically from a commit.

Keep the v1 protocol/data, frozen PS reference artifacts and historical evidence manifests intact. New current manifests record their own source hashes and inherited evidence. ZVM downtime does not block local PS work. Initial MetaMask inventory display is unnecessary; an optional display Snap follows the core experience.
