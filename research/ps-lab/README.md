# Isolated PS research lab

Public test keys and deterministic proof nonces only. **Never issue assets with this code.** This is the first C1 fixture set for the [reference-core profile](../../docs/PS-CRYPTOGRAPHIC-PROFILE.md), not the app SDK, an issuer service or a cryptographic audit.

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
