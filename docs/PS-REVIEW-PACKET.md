# PS independent review packet

Updated October 8, 2026, against merged PR #19 baseline `e0a8beb854f3a5fa29cf9aa47a3f529ada984322` plus the isolated Node-backed browser console. **Independent reviewer: unassigned. Review result: pending.** This packet organizes the handoff; neither its author, test counts, curve-backend comparisons nor CodeRabbit constitute independent cryptographic validation.

## Freeze the reviewed revision

Record the exact commit under review and verify its signature. [Current browser evidence](../research/ps-browser-validation.json) lists source hashes and unchanged baseline artifacts; historical manifests apply to their own revisions. Do not update mismatching hashes just to make a check pass.

```sh
git rev-parse HEAD
git verify-commit HEAD
python3 - <<'PY'
import hashlib, json
from pathlib import Path
v = json.loads(Path('research/ps-browser-validation.json').read_text())
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
7. Are public/observer outputs accurately described? Wallet bytes currently authenticate no wallet. Reused nullifiers and public asset attributes can link observations. Image metadata removal is not steganographic erasure. Determine which privacy claims, if any, the whole proposed system could support.

## Required review output and release gates

For each finding, record revision, affected invariant, concrete attacker/input/failure path, reproduction, impact, proposed correction and independent retest result. Keep rejected hypotheses and unresolved questions distinct from validated findings. Record the scope and provenance of any external implementation or vectors; publicly readable website code is not automatically licensed for reuse.

A handoff is complete only when a reviewer records their scope, assumptions, excluded surfaces and unresolved findings. A clean report would still not qualify browser devices, production randomness/side channels, issuer custody/key ceremony, hardware durability, database rollback recovery, resource limits, hosting or a public custody model. C1/C3 remain partial; C4 is pending; the file/vault prototypes are limited C5 preparation and C6 is unimplemented. Do not infer release approval from test success, a signed commit or a bot review.


Browser console acceptance is deliberately partial: file selection and lost-response restore were exercised through the UI, while the selected recovery file was generated by the actual HTTP API because in-app download completion could not be confirmed. Challenge request/body bounds, capability exposure, UI state synchronization, password handling and actual target-browser downloads before treating this console as a product client. The user accepts ZFT-managed PS display initially; a later MetaMask Snap is deferred, without signing/custody permission implied.
