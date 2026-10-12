# Save draft feedback

A Save draft failure could leave the button unchanged while the only error appeared above the viewport. In a disposable browser reproduction of merged PR40 (`0d6825a6114ac1711d02b8323bb0a2b337293aea`), the missing-file alert ended 447 pixels above the screen while Save draft remained visible. Missing collection/password/wallet prerequisites also disabled the button, preventing a click from explaining the required step. The user's original image, journal and wallet were not inspected; their exact failure cause remains unconfirmed.

The form now accepts a Save draft click to explain missing prerequisites beside the button. It checks collection, password length, fee-wallet connection, file size, required name and the existing UTF-8 metadata limits before requesting client work. Blank descriptions remain valid; receipt does not require a fee wallet or creation metadata. These checks supplement the existing client validation.

During preparation the button says “Saving draft…” and the nearby status explains the MetaMask signature. Errors receive focus and scroll into view without clearing the file or text. Success continues to the existing saved-picture and recovery-download step. Unrelated notices stay beside the original controls. No automatic retry, proof, transaction, publication, format change or migration is added.

## Verification

[Validation manifest](../research/shielded-draft-feedback-validation.json) and [browser evidence](../research/shielded-draft-feedback/evidence/browser.json) record the scope and exact hashes. Four new regressions bring the app suite to 305 passing tests. The reachable Save draft regression fails the deployed baseline because the incomplete form disables that button. Seven focused experience tests, both type checks, 16 host/source tests, default/opt-in build boundaries, full/UI packages and the shielded Worker dry run pass.

An actual Chromium trial checked missing prerequisites, a generated JPEG with an empty description, a paused wallet signature, rejection with retained inputs, explicit retry and successful recovery-download readiness. It checked mobile error visibility, no horizontal overflow, and Lock clearing password/download links. The final standalone package separately checked the notice-routing adjustment. No live wallet, transaction, public upload or user data was used. No new recovery export was downloaded; the existing recovery-file verification protocol is unchanged.

All 154 packaged assets, MIME types and security headers passed local HTTP checks, including six HEAD and six negative-path checks. Archive parsing verified 70 project sources and 53 dependency archives (15,570 files). Source-only reconstruction reproduced every public asset and the manifest byte-for-byte using frozen dependencies, upstream supplements and existing proving artifacts. This does not reproduce upstream bundles or a trusted setup.

Reproduce the affected checks:

```sh
node --experimental-sqlite node_modules/vitest/vitest.mjs run tests/shielded-experience.test.ts
pnpm test
pnpm typecheck
pnpm exec tsc --noEmit --project research/shielded-host/tsconfig.json
node --test research/shielded-host/host.test.mjs research/shielded-host/source-package.test.mjs
node research/shielded-app/check-builds.mjs
```

For the disposable browser trial, run `node --import tsx research/shielded-app/local-server.mjs` after the opt-in build. Its Pause test signatures, Approve test signature and Reject test signature controls are fixture-only and excluded from production. Use generated fixtures on its fresh loopback origin, never user recovery files. Preserve existing generated host packages before rebuilding.

The correction is tested but not deployed. Independent device/MetaMask qualification and the existing finality/recovery acceptance gates remain open.
