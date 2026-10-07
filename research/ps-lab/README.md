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
```

The 88 local tests include 21 actual process-kill locations, multiprocess races, bounded SQLite page-limit/lock/read-only errors, repeated recovery after a later spend, 29 signed-state cases and 12 observer recovery regressions. Seventeen mutations must cause their named regressions to fail. The demo prints outcomes and removes its temporary files; no ZVM, wallet, reference-mint or hosted-service access is required. See [current observer recovery evidence](../ps-observer-recovery-validation.json), [historical state evidence](../ps-state-validation.json), [historical recovery evidence](../ps-recovery-validation.json) and [historical engine evidence](../ps-local-engine-validation.json). Page-limit errors do not qualify hardware power loss, real disk exhaustion or corrupt/rolled-back databases. The [separate state profile](../../docs/PS-LOCAL-STATE.md) pins an Ed25519 key and signs the exact showing context, issuer report and timestamp. Its observer persists one-use challenges and a sequence floor; this neither reserves an unspent credential nor detects all issuer rollback/equivocation. The state demo uses a fresh in-memory status key; the PS keys remain public fixtures. Browser/file adapters, wallet endorsement, independent review and production status/storage/key custody remain open.
