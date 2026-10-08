# Isolated PS research lab

The reference fixtures use public test keys and deterministic proof nonces. **Never issue assets with this code.** This is the first C1 fixture set for the [reference-core profile](../../docs/PS-CRYPTOGRAPHIC-PROFILE.md), not the app SDK, an issuer service or a cryptographic audit.

The Python generator uses py_ecc; the JavaScript verifier uses noble. The two backends agree on generator/point encodings, keyset and asset hashing, committed issuance v3, randomized showing, private transfer and unblinding. Both transcript implementations were prepared together; independent review and an external oracle remain open.

From the repository root, with Node 22.12+, pnpm 10.14.0 and Python 3.12:

```sh
pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
python3.12 -m venv /tmp/zft-ps-lab-venv
/tmp/zft-ps-lab-venv/bin/python -m pip install --require-hashes --only-binary=:all: -r research/ps-lab/requirements.txt
/tmp/zft-ps-lab-venv/bin/python research/ps-lab/check-inventory.py
/tmp/zft-ps-lab-venv/bin/python research/ps-lab/generate.py
pnpm --dir research/ps-lab --ignore-workspace test
node research/ps-lab/check-controls.mjs
```

`--ignore-workspace` is required: this folder is deliberately outside the application's pnpm workspace. The Python lock includes wheels for CPython 3.12 on Linux x86_64 and macOS arm64. Other platforms need a reviewed hash inventory update, not removal of hash checking. Keep virtual environments outside this checkout.

`generate.py` checks the committed JSON byte-for-byte; `--write` explicitly regenerates it for a reviewed profile change. It does not silently refresh fixtures during tests. `check-controls.mjs` temporarily removes each verification check and requires a specific negative test to fail; it removes its temporary modules afterward. The test command also runs a portability regression that copies the lab harness into a temporary path containing spaces, Unicode and a URL metacharacter, then checks all three controls and removes the copy. `ZFT_PS_VERIFIER` is a test-harness override used only for these broken controls.

The dependency inventory and `licenses/` retain package license notices. No NonFungible Cash bundle is imported, executed or vendored. Source observations remain in the [frozen reference evidence](../ps-reference-2026-10-06.json). There is no network, wallet, storage or deployed application integration in the fixture execution.

## Local state-machine extension

The separately versioned [local issuer/client harness](../../docs/PS-LOCAL-ENGINE.md) lives in `local/`. It uses fresh random client secrets/nonces but public test issuer keys, dedicated plaintext SQLite stores and scoped ZFT transcripts. It is still research-only. The frozen reference files above are unchanged.

```sh
pnpm --dir research/ps-lab --ignore-workspace test:local
node research/ps-lab/local/check-controls.mjs
pnpm --dir research/ps-lab --ignore-workspace demo:local
pnpm --dir research/ps-lab --ignore-workspace demo:state
pnpm --dir research/ps-lab --ignore-workspace demo:image
pnpm --dir research/ps-lab --ignore-workspace demo:vault
```

The 148 local tests include 21 actual process-kill locations, multiprocess races, bounded SQLite page-limit/lock/read-only errors, repeated recovery after a later spend, 29 signed-state cases, 12 observer recovery regressions, 13 parser cases, 25 image cases and 22 vault cases. Thirty-five mutations must cause their named regressions to fail. The demo prints outcomes and removes its temporary files; no ZVM, wallet, reference-mint or hosted-service access is required. See [current vault evidence](../ps-vault-validation.json), [historical image evidence](../ps-image-validation.json), [historical parser evidence](../ps-parser-validation.json), [historical observer recovery evidence](../ps-observer-recovery-validation.json), [historical state evidence](../ps-state-validation.json), [historical recovery evidence](../ps-recovery-validation.json) and [historical engine evidence](../ps-local-engine-validation.json). Page-limit errors do not qualify hardware power loss, real disk exhaustion or corrupt/rolled-back databases. The [separate state profile](../../docs/PS-LOCAL-STATE.md) pins an Ed25519 key and signs the exact showing context, issuer report and timestamp. Its observer persists one-use challenges and a sequence floor; this neither reserves an unspent credential nor detects all issuer rollback/equivocation. The state demo uses a fresh in-memory status key; the PS keys remain public fixtures. The offline file/vault adapters are described below; browser/working-store integration, wallet endorsement, independent review and production status/storage/key custody remain open.

The [parser qualification](../../docs/PS-LOCAL-ENGINE.md#parser-boundary-qualification) covers 471 bounded malformed variants across ten artifact families (578 rejected calls, including restoration into two stores), with unchanged database rows after each rejection and valid operations afterward. Exact UTF-8 limits, depth/numbers and maximum asset size are also checked. Four mutations prove the suite catches weaker canonical-wire, byte-count, field and depth checks. This is selected same-author coverage, not exhaustive fuzzing or independent cryptographic validation.

## Offline PNG file prototype

The [versioned image envelope](../../docs/PS-IMAGE-ENVELOPE.md) carries plaintext local bearer authority in one private PNG chunk. Import checks the caller-pinned issuer and signed image binding; public export returns only the exact original image. The image demo uses disposable private files and demonstrates issue, claim with a lost response, restore, cancel and stale-copy rejection. This is not a browser adapter, encrypted vault or hosted product.

With root dependencies installed, `pnpm exec tsx research/ps-lab/check-image-codec.ts` reproduces three original normalized fixtures, checks decoded pixels and verifies that v1 normalization/import/public upload reject the new private chunk while v1 roundtrips remain valid. CI runs this separately from the isolated lab suite. The [independent-review packet](../../docs/PS-REVIEW-PACKET.md) is prepared; the reviewer is unassigned and review remains pending.

## Encrypted local file vault

The [separate vault format](../../docs/PS-LOCAL-VAULT.md) encrypts typed bearer and recovery records, supports explicit lock/reopen, and requires exact saved encrypted-file readback before acknowledging recovery. Fixed scrypt/AES-GCM parameters, complete caller-pinned identity and decrypted-record validation are covered by 22 tests and seven controls. The vault demo restores a lost claim response using disposable encrypted files and a public test password. Working SQLite stores remain plaintext, older exports remain readable and password changes do not revoke old backups. No browser/v1 vault integration or secure-memory claim is made.
