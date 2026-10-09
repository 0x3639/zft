# PS release sequence

The user authorized completing each engineering step, committing it, and continuing to the next. Baseline: merged PR #23, `673f89dba48a3222be02894ad659a62fe6e58aad`. This sequence refines [C1–C6](IMPLEMENTATION.md#ps-credential-work); it does not mark external review or device acceptance complete.

| Step | Deliverable and exit evidence | Status |
| --- | --- | --- |
| 1. Product interface | Collection and issuer-scoped item routes; JPG/PNG preparation; private file receive; explicit public/private export; saved recovery before mint/claim/cancel and restoration | Local implementation and selected desktop acceptance complete; [evidence](PS-PRODUCT-INTERFACE.md). Hosted activation stays closed |
| 2. Identity and public proofs | Separate credential validity, wallet endorsement and signed issuer observation; opt-in public presentation, bounded public routes and sharing metadata | Local implementation and automated evidence complete; [public presentation](PS-PUBLIC-PRESENTATION.md). Real extension and full publish UI acceptance pending; no current-ownership claim |
| 3. Persistent issuer | Stable pinned trust, private keys, durable registry, admission and resource limits; restart/restore tests | Next. A persistent local prototype can precede review; hosted access cannot |
| 4. Independent review | Reviewer named, exact signed revision, independently authored adversarial vectors, findings and retests including PS-OWN-01 | Handoff prepared; reviewer unassigned. This is an external release dependency, not a task the implementation author can self-certify |
| 5. Recovery and operations | Backups/restore drills, rollback and equivocation policy, outage behavior, retention, monitoring, key compromise and rotation procedure | Selected local failure evidence exists; operational qualification pending |
| 6. Browser and device acceptance | Real target browsers, wallet extension, phone download/reselect/claim, accessibility and storage/lifecycle failures | Selected Codex desktop checks only; target-device matrix pending |
| 7. Staging and limited release | Reviewed resources/configuration, release gates, controlled canary, monitoring and rollback; explicit release approval | Pending steps 2–6. Apex promotion remains separate |

Continue engineering where dependencies permit while recording blocked external gates. A bot review, signed commit, large test suite or distinct curve backend is not independent cryptographic validation. [PS-OWN-01](PS-REVIEW-PACKET.md#open-review-item-former-holder-and-cross-asset-forgery) remains open before real assets or hosting.

## Commit and release policy for this sequence

The user temporarily authorized unsigned **local** increments to avoid a GPG prompt after every step. Use `git -c commit.gpgsign=false commit`; leave repository/global signing configuration unchanged. Keep the new series unpublished. At the end, sign the unpublished commits in a batch, verify every signature, and push for review. Signing rewrites commit IDs; do not rewrite merged/published history. GPG may still require local approval when the signing batch runs. No merge or deployment follows automatically from a commit.

Keep the v1 protocol/data, frozen PS reference artifacts and historical evidence manifests intact. New current manifests record their own source hashes and inherited evidence. ZVM downtime does not block local PS work. Initial MetaMask inventory display is unnecessary; an optional display Snap follows the core experience.
