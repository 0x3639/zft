# Finding and finishing shielded ZFTs

The reported problem was that creation appeared finished but the picture was difficult to find. The prior homepage entered the older profile/wallet flow, while the shielded collection showed abbreviated operation IDs. Preparing an encrypted draft or submitting the first creation commitment was not completion.

This candidate is based on merged PR38 (`67223bc6a961fcdc86321c92e1d33bb9f4db6599`). It updates the existing client and navigation. It does not migrate, erase or re-encrypt saved records, change configuration pins, deploy contracts, or change the proof/contract/recovery formats.

## User flow

- The homepage's Create, Receive and Recover actions use full navigations into `/shielded`. The old profile action says “Create a public profile”; older wallet/file collections remain accessible and clearly labelled.
- “Open my collection” verifies the selected devnet configuration and opens the same encrypted IndexedDB journal as before. Titles and thumbnails remain locked until the user provides a password. Unlocking previews does not select an operation, write its journal or send a transaction. Different passwords may unlock different records.
- The collection shows named picture cards with the last saved status. Historical and renewed backup records remain visible; the number is saved records, not a count of independently verified current assets. Opening a record requires its password and a fresh status check before any retry.
- A draft immediately offers its encrypted recovery download. The exact saved file must still be reselected before proof/submission. Nothing treats a download click or checkbox as acknowledgement.
- One next action is shown: save/verify recovery, check an uncertain response, prepare a proof, approve the first reservation, wait/check blocks, or finish with transaction two. The first transaction explicitly says creation is unfinished. An expired authorization renews the same destination and requires a new backup.
- Completion returns to My collection with the name, thumbnail and “Observed on devnet” status. This is a checked RPC observation, not independently qualified finality or current private ownership. Public image and transferable bearer exports have distinct labels.
- Reload/Lock clears the password, previews and download URLs, while encrypted records remain. Recovery reopens the same destination and returns to the collection for observation. No wallet connection is needed to inspect or recover saved authority.

`inspect(id, password)` exposes only the decrypted record ID, name and public image to the current browser session. The UI does not persist those previews separately. `creationProgress` is advisory, checked at a rechecked block and reset on selection/close; submission still independently enforces all existing conditions. There is no automatic transaction, polling, retry or replacement.

## Verification

[Current validation](../research/shielded-usability-validation.json) preserves all prior manifests. Ten controller tests pass, including two new regressions that fail the deployed baseline with named assertions: saved-picture discovery after reopening the same journal, and a lost reservation response progressing through waiting, reveal and completion. All ten mutation controls detect bypasses, including the two new gallery-selection and premature-reveal mutations. Three UI/navigation regressions join the existing app suite (252 total tests).

An actual in-app Chromium trial used a separate loopback origin, disposable fee wallet, real local Groth16 proofs and simulated contracts. It saved and reselected recovery, displayed the unfinished first transaction, finished creation, returned to a named collection, reloaded/unlocked without connecting a wallet, and restored the same picture from the saved file. A long pause also exercised expired authorization and same-destination renewal. The test touched only its two explicitly authorized disposable Downloads exports and left them unchanged. The browser download event did not fire, but the link saved the exact named files and the app independently verified each reselected file. No application download fallback was added.

The trial used 1280×720 and 390×844 viewports without horizontal overflow, and Lock removed previews/links and cleared the password. There were no scoped console warnings/errors. Its exact hashes and limits are in [browser evidence](../research/shielded-usability/evidence/browser.json). Later “above/below” wording corrections are outside that lifecycle trial. The final packaged host separately passed opening/verification against the selected live devnet and empty-collection/navigation checks, without a wallet or transaction.

Full and UI-only packages, root/standalone types, host/source tests and both Worker dry runs pass. Every public file and its headers was checked over loopback. Independent archive parsing and a fresh source-only tree reproduce all 154 public files and the manifest byte-for-byte, reusing frozen installed dependencies and existing proving artifacts. This does not reproduce upstream prebuilt bundles or a trusted setup.

## Hosting and remaining acceptance

The prior PR38 package was explicitly deployed to `https://devnet.zft.foo/shielded` on October 11, 2026; [activation evidence](../research/shielded-usability/evidence/pr38-activation.json) records the exact old version. Its external RPC is `https://devnet.zenon.foo/zvm/rpc`. This usability candidate has not been deployed. Publishing it requires the reviewed shielded package and the default homepage build to be updated separately; no new route or DNS change is needed.

No new live transaction or real MetaMask test occurred. The user's existing browser records and keys were not inspected. Independent review/reproduction, real MetaMask/Firefox/iOS/Android and resource budgets, second-operator disappearance and independently qualified devnet finality remain open. Old recovery/bearer copies can race. Server-side custody, migration and production/mainnet activation remain outside scope.

Reproduce the affected checks:

```sh
node --import tsx --test --test-concurrency=1 research/shielded-app/test/*.test.mjs
node research/shielded-app/check-controls.mjs
pnpm test
pnpm typecheck
node research/shielded-app/check-builds.mjs
node --test research/shielded-host/host.test.mjs research/shielded-host/source-package.test.mjs
pnpm exec tsc --noEmit --project research/shielded-host/tsconfig.json
```

Preserve existing generated host outputs before rebuilding; the builder refuses overwrite. The disposable browser fixture is `node --import tsx research/shielded-app/local-server.mjs`, after the opt-in build. It does not use a live network. Never replace an existing user journal or select a user's private export as a test fixture.
