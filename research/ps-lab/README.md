# Isolated PS research lab

Current local increment: [offline operations](../../docs/PS-LOCAL-OPERATIONS.md), with 250 local tests, 73 mutation controls and explicit suspended-restore review. [Current evidence](../ps-operations-validation.json) preserves earlier manifests as historical.

Previous local increment: [persistent issuer](../../docs/PS-PERSISTENT-LOCAL.md). [Historical persistent evidence](../ps-persistent-validation.json) records 242 local tests, 68 controls and 22 actual process-kill locations. Earlier manifests, including product/public presentation, remain historical. No hosted release or production key-custody claim.

Previous local increment: [public PS presentation](../../docs/PS-PUBLIC-PRESENTATION.md), with separate credential proof, optional wallet signing-key endorsement and issuer snapshot. [Historical presentation evidence](../ps-presentation-validation.json) records 230 local tests, 63 lab controls, 241 app tests and precise browser limits. The product-interface manifest is now historical.

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

The 216 local tests include 21 actual process-kill locations, multiprocess races, bounded SQLite page-limit/lock/read-only errors, repeated recovery after a later spend, 29 signed-state cases, 12 observer recovery regressions, 13 parser cases, 25 image cases, 22 vault cases, 12 browser/controller/HTTP cases, 20 portable browser-vault/worker cases 23 browser-client/journal/HTTP cases and 13 browser-artwork cases. Fifty-eight mutations must cause their named regressions to fail. The demo prints outcomes and removes its temporary files; no ZVM, wallet, reference-mint or hosted-service access is required. See [current browser-artwork evidence](../ps-browser-artwork-validation.json), [historical browser-client evidence](../ps-browser-client-validation.json), [historical browser-vault evidence](../ps-browser-vault-validation.json), [historical browser evidence](../ps-browser-validation.json), [historical vault evidence](../ps-vault-validation.json), [historical image evidence](../ps-image-validation.json), [historical parser evidence](../ps-parser-validation.json), [historical observer recovery evidence](../ps-observer-recovery-validation.json), [historical state evidence](../ps-state-validation.json), [historical recovery evidence](../ps-recovery-validation.json) and [historical engine evidence](../ps-local-engine-validation.json). Page-limit errors do not qualify hardware power loss, real disk exhaustion or corrupt/rolled-back databases. The [separate state profile](../../docs/PS-LOCAL-STATE.md) pins an Ed25519 key and signs the exact showing context, issuer report and timestamp. Its observer persists one-use challenges and a sequence floor; this neither reserves an unspent credential nor detects all issuer rollback/equivocation. The state demo uses a fresh in-memory status key; the PS keys remain public fixtures. The offline file/vault adapters are described below; product/device integration, wallet endorsement, independent review and production status/storage/key custody remain open.

The [parser qualification](../../docs/PS-LOCAL-ENGINE.md#parser-boundary-qualification) covers 471 bounded malformed variants across ten artifact families (578 rejected calls, including restoration into two stores), with unchanged database rows after each rejection and valid operations afterward. Exact UTF-8 limits, depth/numbers and maximum asset size are also checked. Four mutations prove the suite catches weaker canonical-wire, byte-count, field and depth checks. This is selected same-author coverage, not exhaustive fuzzing or independent cryptographic validation.

## Offline PNG file prototype

The [versioned image envelope](../../docs/PS-IMAGE-ENVELOPE.md) carries plaintext local bearer authority in one private PNG chunk. Import checks the caller-pinned issuer and signed image binding; public export returns only the exact original image. The image demo uses disposable private files and demonstrates issue, claim with a lost response, restore, cancel and stale-copy rejection. This is not a browser adapter, encrypted vault or hosted product.

With root dependencies installed, `pnpm exec tsx research/ps-lab/check-image-codec.ts` reproduces three original normalized fixtures, checks decoded pixels and verifies that v1 normalization/import/public upload reject the new private chunk while v1 roundtrips remain valid. CI runs this separately from the isolated lab suite. The [independent-review packet](../../docs/PS-REVIEW-PACKET.md) is prepared; the reviewer is unassigned and review remains pending.

## Encrypted local file vault

The [separate vault format](../../docs/PS-LOCAL-VAULT.md) encrypts typed bearer and recovery records, supports explicit lock/reopen, and requires exact saved encrypted-file readback before acknowledging recovery. Fixed scrypt/AES-GCM parameters, complete caller-pinned identity and decrypted-record validation are covered by 22 tests and seven controls. The vault demo restores a lost claim response using disposable encrypted files and a public test password. Working SQLite stores remain plaintext, older exports remain readable and password changes do not revoke old backups. No browser/v1 vault integration or secure-memory claim is made.


## Disposable browser console

Run `pnpm --dir research/ps-lab --ignore-workspace browser:local` from the repository root and open the printed launch link. See [PS-BROWSER-LAB.md](../../docs/PS-BROWSER-LAB.md) for the flow and boundaries. The browser drives Node-held cryptography and three plaintext client stores over an authenticated loopback interface. Public test keys only; stopping removes the temporary issuer and prevents later recovery. Twelve new tests and five controls bring totals to 160/40; the 21 SIGKILL locations are unchanged. [Historical persistent evidence](../ps-browser-validation.json) separates UI acceptance from HTTP tests; browser-managed download saving remains unverified. No production app/dependency or core protocol change.

## Browser-owned vault protection

The console's **Browser vault** link opens the [isolated browser vault](../../docs/PS-BROWSER-VAULT.md). Opening, validation and re-encryption run in a worker; IndexedDB stores only encrypted envelopes with revision conflict checks. Seven real-browser storage checks are separate from the 180 Node tests and 45 mutation controls. The issuer and mint/claim working stores remain in Node. That vault-only view does not construct proofs; the browser-client increment below adds that workflow. Wallet/product/device integration remains open. See [historical evidence](../ps-browser-vault-validation.json) for backend interoperability and precise download acceptance limits.

## Browser credential execution

The console's **Browser client** link runs mint/claim/cancel proofs in a dedicated Worker and persists encrypted working state. Save and reselect an encrypted recovery download before submission; recover the exact committed response after loss. The Node issuer receives protocol requests and retrieval capabilities, not browser credential secrets or passwords. The unchanged older console continues using its Node client stores. See [workflow, bounds and acceptance](../../docs/PS-BROWSER-CLIENT.md) and [historical PR #22 evidence](../ps-browser-client-validation.json). Public test keys only. [PS-OWN-01](../../docs/PS-REVIEW-PACKET.md#open-review-item-former-holder-and-cross-asset-forgery) is an open independent-review item, not a resolved finding.

## Browser artwork

The same client now validates normalized PNG inputs, claims private PNGs and displays selected artwork using public image bytes only. Explicit private downloads carry plaintext bearer authority; public downloads preserve only the original image. Existing encrypted recovery gates apply to mint/claim/cancel. See [workflow, strict decoder boundary and acceptance](../../docs/PS-BROWSER-ARTWORK.md) and [current evidence](../ps-browser-artwork-validation.json). Automated tests use a strict Node decoder adapter; actual browser checks exercise native decompression. There is no general image normalizer, phone qualification or independent cryptographic review.


## ZFT product interface

Run `pnpm ps:local` from the repository root to build and open the real React `/ps/` interface on a disposable loopback issuer. It adds collection/item routes and JPG/PNG preparation over the existing browser Worker. Root dependencies must already be installed. See [workflow and limits](../../docs/PS-PRODUCT-INTERFACE.md), [release sequence](../../docs/PS-RELEASE-PLAN.md) and [current evidence](../ps-product-interface-validation.json). The lab suite now contains 218 tests and 58 controls; root verification separately contains 235 tests and three bridge controls. Earlier records above describe their historical slices.

The root app wallet interoperability tests import this lab's pinned verifier. Before running root `pnpm test` in a fresh checkout, also run `pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts`; the app CI job performs both separate installs. No root dependency or lock changes are required.
