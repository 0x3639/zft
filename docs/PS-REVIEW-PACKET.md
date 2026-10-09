# PS independent review packet

Updated October 9, 2026, against merged PR #23 baseline `673f89dba48a3222be02894ad659a62fe6e58aad` plus the local product, public-presentation persistent-issuer and offline-operations increments. **Independent reviewer: unassigned. Review result: pending.** This packet organizes the handoff; neither its author, test counts, curve-backend comparisons nor CodeRabbit constitute independent cryptographic validation.

## Freeze the reviewed revision

Record the exact commit under review and verify its signature. The five development increments were batch-signed with verified signatures before [PR #24](https://github.com/0x3639/zft/pull/24). Review fixes must also be signed. [Current release evidence](../research/ps-release-readiness-validation.json) lists current source hashes; [operations evidence](../research/ps-operations-validation.json) and other historical manifests apply only to their own revisions. Do not update mismatching hashes just to make a check pass.

```sh
git rev-parse HEAD
git verify-commit HEAD
python3 - <<'PY'
import hashlib, json
from pathlib import Path
v = json.loads(Path('research/ps-release-readiness-validation.json').read_text())
for name, expected in v['sourceSha256'].items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected, name
print('source hashes match')
PY
```

The main evidence manifest cannot hash itself or name its own eventual commit. The signed Git tree fixes that file together with its sources. Record tooling versions and platform, test failures and any changes made during review separately.

## Scope map

| Layer | Read first | Review target |
| --- | --- | --- |
| Reference core | [Frozen profile](PS-CRYPTOGRAPHIC-PROFILE.md), [source observation snapshot](../research/ps-reference-2026-10-06.json) | Distinguish observed client transcripts from derived issuer equations and added cross-group policy; no live server or license equivalence claim |
| Fixture implementation | [Python generator](../research/ps-lab/generate.py), [JS verifier](../research/ps-lab/verify.mjs), [vectors](../research/ps-lab/vectors.json), [dependency inventory](../research/ps-lab/dependencies.json) | Re-derive equations, encodings, group/subgroup constraints, challenge framing, nonce assumptions and negative cases without relying solely on same-author fixtures |
| Local credential protocol | [Profile and persistence specification](PS-LOCAL-ENGINE.md), [profile.mjs](../research/ps-lab/local/profile.mjs) | Scope/realm/keyset, session/base/purpose, asset equality, owner knowledge, fresh destination, recovery-capability and showing-context binding |
| State transitions | [Issuer](../research/ps-lab/local/issuer.mjs), [client](../research/ps-lab/local/client.mjs), [store](../research/ps-lab/local/store.mjs) | Atomic unique spend/reservation plus exact response; acknowledged complete backup; verify before saving replacement; retry/recovery and competing claims |
| Signed observations | [State profile](PS-LOCAL-STATE.md), [state.mjs](../research/ps-lab/local/state.mjs) | Separate pinned Ed25519 key, exact PS showing challenge, time/audience/sequence binding, one-use observer persistence, explicit rollback/equivocation limits |
| Image transport | [Image specification](PS-IMAGE-ENVELOPE.md), [image adapter](../research/ps-lab/local/image.mjs), [PNG subset](../research/ps-lab/local/png.mjs) | Version separation, whole-image binding, bearer-secret boundaries, no implicit trust selection, canonical schemas and bounded hostile inputs |
| Encrypted files | [Vault profile](PS-LOCAL-VAULT.md), [vault.mjs](../research/ps-lab/local/vault.mjs) | Fixed KDF costs, AEAD framing, pinned identity, complete decrypted-record validation, lock limits, exact saved recovery and no implied backup freshness |
| Browser console | [Local console](PS-BROWSER-LAB.md), [controller](../research/ps-lab/local/browser-lab.mjs), [server](../research/ps-lab/local/browser-server.mjs) | Local capability/origin/host boundary, no secret status leakage, exact file reselection, explicit Node/temporary-store scope and unverified browser saving |
| Product boundary | [Protocol proposal](PS-CREDENTIAL-PROTOCOL.md), [roadmap](IMPLEMENTATION.md) | Custody choice, wallet identity versus bearer authority, recovery usability, future hosted trust and incident assumptions |

## Reproduce and challenge the evidence

Follow the exact environment/install instructions in the [lab README](../research/ps-lab/README.md). Python 3.12 requirements are hash-pinned for macOS arm64 and Linux x86_64. Run `generate.py` without `--write`; a mismatch is a finding to investigate. The lab has a separate pnpm lock and requires `--ignore-workspace`.

```sh
pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
pnpm --dir research/ps-lab --ignore-workspace test
node research/ps-lab/check-controls.mjs
pnpm --dir research/ps-lab --ignore-workspace test:local
node research/ps-lab/local/check-controls.mjs
pnpm --dir research/ps-lab --ignore-workspace demo:local
pnpm --dir research/ps-lab --ignore-workspace demo:state
pnpm --dir research/ps-lab --ignore-workspace demo:image
pnpm --dir research/ps-lab --ignore-workspace demo:vault
```

With the repository's separate root dependencies installed, run the image codec compatibility check described in [image evidence](PS-IMAGE-ENVELOPE.md#evidence-and-remaining-work). All demos use public fixture issuer keys and disposable local data; the vault demo also uses a deliberately public test password. Do not introduce real assets, wallet keys, application databases, hosted bindings or external network calls into this review setup.

Specific questions for an independent reviewer:

1. Do the independently derived equations and transcript bytes match the frozen reference profile and the intentional local differences? Supply separately authored valid and invalid vectors, their provenance and exact expected failure conditions.
2. Can any challenge omit or ambiguously encode a dependent statement, session, key, asset, destination or recovery field? Check every transcript construction against its verification equation, not just the tests.
3. Can a malicious holder produce a different-asset replacement, reuse an owner secret/nonces unsafely, substitute public parameters, exploit subgroup/identity handling or extract a witness from the randomness model? Assess secret operations separately from public verification.
4. Can any interleaving or storage failure release a valid response without its durable spend/reservation, expose incomplete recovery, revive a spent local credential or consume an observer challenge without its receipt/watermark? Extend beyond the selected SIGKILL and SQLite-error tests.
5. Can stale state, issuer/observer restore, equivocation, compromised keys, manipulated clocks or trust replacement be represented as fresh authority? Existing tests deliberately demonstrate limits for fresh observers and historical receipts; require explicit incident/admission/retention policies rather than interpreting those tests as protections.
6. Can parsing, decompression, nested JSON, unsupported image formats or a private/public output mix leak authority or permit image substitution? Challenge the exact byte limits and trust boundary; current corpus coverage is bounded and same-author. Verify password/KDF costs, all AEAD inputs, final authentication before plaintext exposure, decrypted-record validation and the fact that old encrypted exports remain valid.
7. Are public/observer outputs accurately described? Base showing wallet bytes alone authenticate no wallet. The [public presentation](PS-PUBLIC-PRESENTATION.md) adds a separate optional ERC-191 signing-key endorsement of exact evidence; it does not check contract-wallet validity or grant spend authority. Reused nullifiers and public asset attributes can link observations. Image metadata removal is not steganographic erasure. Determine which privacy claims, if any, the whole proposed system could support.

## Required review output and release gates

For each finding, record revision, affected invariant, concrete attacker/input/failure path, reproduction, impact, proposed correction and independent retest result. Keep rejected hypotheses and unresolved questions distinct from validated findings. Record the scope and provenance of any external implementation or vectors; publicly readable website code is not automatically licensed for reuse.

A handoff is complete only when a reviewer records their scope, assumptions, excluded surfaces and unresolved findings. A clean report would still not qualify browser devices, production randomness/side channels, issuer custody/key ceremony, hardware durability, database rollback recovery, resource limits, hosting or a public custody model. C1/C3 remain partial; C4 is pending; the file/vault prototypes are limited C5 preparation and C6 is unimplemented. Do not infer release approval from test success, a signed commit or a bot review.


Browser console acceptance is deliberately partial: file selection and lost-response restore were exercised through the UI, while the selected recovery file was generated by the actual HTTP API because in-app download completion could not be confirmed. Challenge request/body bounds, capability exposure, UI state synchronization, password handling and actual target-browser downloads before treating this console as a product client. The user accepts ZFT-managed PS display initially; a later MetaMask Snap is deferred, without signing/custody permission implied.

Browser-vault review also covers the [fixed module adapter](../research/ps-lab/web/modules.mjs), [worker cryptography](../research/ps-lab/web/vault.mjs), [worker lifecycle](../research/ps-lab/web/worker.mjs), [IndexedDB transactions](../research/ps-lab/web/storage.mjs) and [UI generation guards](../research/ps-lab/web/vault-ui.mjs). Challenge the source-extraction anchors, private-data flow, ciphertext/AAD compatibility, transaction completion and stale-writer behavior, UI locking during asynchronous work and the same-origin trust assumption. [Acceptance scope](PS-BROWSER-VAULT.md#validation-and-acceptance) distinguishes Node portable-module tests, actual browser storage checks and Brave console saving from the unverified new in-app vault download. No independent review is implied.

## Open review item: former-holder and cross-asset forgery

**PS-OWN-01 — open; independent reviewer unassigned.** On October 8, 2026, the user supplied a screenshot warning that an ecash NFT scheme did not bind its secret/token chain to the same asset, allowing a former holder to construct another ownership claim after handing a token to someone else. The original source URL, scheme version and full equations have not been identified; do not attribute this warning to Pointcheval–Sanders generally or claim an exact match to the reference website. The screenshot is evidence of a question to investigate, not a validated vulnerability in this repository.

For the local PS profiles, independently assess whether the signature binds both the scoped asset attribute and owner secret, whether the transfer equality proof preserves that exact asset, and whether the source proof/nullifier plus atomic spend/response prevents a former holder from retaining usable authority after a recipient completes a claim. Construct malicious fresh proofs, not only altered honest transcripts: try substituting a second asset, mixing two valid credentials, changing the owner/nullifier, replaying earlier responses and competing claims. Work from the pinned parameters without using the deliberately public fixture issuer secrets as attacker knowledge; separately retain the assumption that a compromised or malicious issuer can forge. Check issuance, transfer, showing, recovery and image adapters together.

Required result: exact reviewed revision, attacker knowledge, independently authored positive/negative vectors, attack outcome and remaining assumptions. Explicitly distinguish handing over a copied file (any holder can still race) from a recipient's successfully committed refresh. Assess linkability separately: public asset attributes and repeated nullifiers already limit privacy.

Existing evidence: six focused engine regressions passed on `9b83f87` on October 8 (stale-copy/cancel, duplicate issuance, bearer validation, transfer-field binding, competing claims and cross-realm relabeling). They do not establish security against every freshly constructed malicious proof. This item remains a C1/C4 release-review gate before real-asset issuance or a hosted experiment. Continuing isolated browser work does not close it.

Browser credential review additionally covers the [client protocol/storage boundary](PS-BROWSER-CLIENT.md), generated proof execution, complete encrypted working journals, both outer and decrypted identity pins, exact saved-file acknowledgment, compare-and-swap completion, serialized Worker actions and loopback-only issuer interface. Existing reference/local proof equations are unchanged. Challenge authenticated but inconsistent journals, competing stale tabs, locked asynchronous completions, response loss, recovery replay and any path that sends bearer secrets to Node or revives spent authority. PS-OWN-01 remains open.

Browser artwork review covers the [portable PNG decoder boundary](PS-BROWSER-ARTWORK.md#browser-decompression-boundary), exact generated envelope adaptation, caller input ownership, private/public outputs and lock checks. Challenge native trailing-stream behavior across engines, internal decoder allocation, same-author Node/browser agreement and the UI distinction between a viewable stale image and successfully refreshed authority. Actual desktop PNG download/claim/cancel acceptance does not close PS-OWN-01 or qualify phones.


## Product interface boundary

Review the [React interface](PS-PRODUCT-INTERFACE.md), [bridge](../apps/web/src/ps/bridge.ts) and [fixed asset loader](../research/ps-lab/local/product-assets.mjs) for origin/capability scope, private/public output separation, late Worker replies, recovery gating and meaningful user labels. This interface preserves the existing credential Worker and transcripts; it does not authenticate a wallet or provide a fresh issuer observation. The [release sequence](PS-RELEASE-PLAN.md) separates implementation from independent review and device/hosting acceptance.

## Public-presentation review scope

Review the [new composition](PS-PUBLIC-PRESENTATION.md), its origin/chain audience, exact ERC-191 message and low-S recovery, full image/asset binding, pinned Ed25519 receipt, unsigned anonymous case, publication consent and Worker lock boundary. Re-derive malicious fresh signatures and proofs independently. Static public viewers bootstrap keys from the same origin and retain no global rollback state. Historical receipt validity must never be presented as current ownership. Profile login and ERC-1271 are outside this increment.

## Persistent issuer review scope

Review [local persistence](PS-PERSISTENT-LOCAL.md): private key generation/files, pinned identities, missing-registry rejection, exclusive local process ownership, saved response/status replay, publication startup verification, quota behavior and suspended admission. Same-directory locking and configuration hashes do not prove global freshness; copied/rolled-back stores and compromised keys remain release concerns. Private keys are plaintext local research files.

## Offline operations review scope

Review [backup/restore semantics](PS-LOCAL-OPERATIONS.md): closed SQLite snapshots under exclusive ownership, fixed files and limits, signature/checkpoint trust, suspended restore, no-overwrite/readiness behavior and explicit local approval. The test accepting the authenticity of an older snapshot documents a remaining rollback risk. Define external checkpoint authority, fencing, key compromise/retirement, response retention and recovery availability before hosting; local approval cannot establish those properties.

## Release handoff status

Use the [preflight](PS-RELEASE-PREFLIGHT.md) after the unpublished series is signed. [Target-device acceptance](PS-ACCEPTANCE-MATRIX.md), production key custody/operations and isolated staging owner approval remain pending. The checker validates recorded exact-candidate evidence; it does not provide independent review or certify report authenticity. No reviewer has been contacted or assigned.
