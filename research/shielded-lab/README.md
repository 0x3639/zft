# Isolated shielded ZVM experiment

This package implements the test profile in [the protocol specification](../../docs/SHIELDED-ZVM-PROTOCOL.md). Keys stay in client notes/recovery files. A new contract verifies creation and spend proofs; no PS issuer service participates. Nothing here is an approved public deployment, production trusted setup, audited privacy system or v1 migration.

The [feasibility record](../../docs/SHIELDED-ZVM-FEASIBILITY.md) records the measured Groth16/PLONK comparison, read-only ZVM execution and conditional prototype choice. Existing PS and app acceptance totals do not count as shielded acceptance. The [current validation manifest](../shielded-validation.json) pins this candidate and its preserved baseline; it does not grant release approval.

## Reproduce locally

Use the repository's frozen root dependencies for the existing pixel codec, `tsx`, OpenZeppelin and Anvil. This isolated package has its own lockfile and never edits the root dependency graph. Node 22.12.0 and pnpm 10.14.0 were used. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir research/shielded-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
node research/shielded-lab/scripts/bootstrap.mjs
pnpm --dir research/shielded-lab --ignore-workspace build:circuits
node research/shielded-lab/scripts/setup.mjs create groth16
node research/shielded-lab/scripts/setup.mjs spend groth16
node research/shielded-lab/scripts/build-contracts.mjs --groth16-only
pnpm --dir research/shielded-lab --ignore-workspace test
node research/shielded-lab/scripts/check-circuit-controls.mjs
node research/shielded-lab/scripts/check-state-controls.mjs
```

Bootstrap verifies exact official compiler and public powers-of-tau digests before execution. Its macOS compiler is the official x86-64 binary and requires compatible execution support on arm64. Linux x86-64 is also pinned. Unsupported platforms fail explicitly. `.tools`, `build` and `node_modules` are ignored. Setup refuses to replace an existing key; preserve evidence and use a clean build directory to regenerate. Each local Groth16 contribution produces new test-only keys/verifiers. Rebuild deployment pins for those artifacts; do not reuse a manifest from another setup.

For the PLONK comparison, bootstrap with `--comparison`, generate `create plonk` and `spend plonk` with the setup script, build contracts without `--groth16-only`, then run `benchmark`. It performs five desktop samples per circuit/system and deploys verifiers only to its disposable loopback Anvil. It closes that process on completion/failure. `--reuse-proofs` on the benchmark script repeats verifier measurements using already generated public fixture proofs, without rerunning proving timings.

```sh
node research/shielded-lab/scripts/build-browser-fixture.mjs
node research/shielded-lab/scripts/browser-server.mjs
```

The latter prints a loopback URL for the browser proof trial. It serves public fixture inputs, reviewed scripts and pinned proving artifacts only, accepts no uploads and closes on Ctrl-C. The fixture secrets are explicitly public values 1/2 and 3/4. User witnesses must never be added to those fixtures or served over HTTP. The generic worker receives witnesses through local messages and returns proof/public signals; it performs no server-side proving.

The runtime probe is read-only but uses the configured remote RPC. It checks the selected devnet chain/genesis and runs code state overrides if supported. It never deploys code or submits transactions. Full comparison artifacts are required:

```sh
node research/shielded-lab/scripts/probe-runtime.mjs /private/tmp/shielded-runtime.json
```

## Current implementation

- `core.mjs`: strict canonical metadata, full-width asset digest, note and nullifier relations, incremental trees with permissionless forest rollover.
- `file-adapter.mjs`: new `zsHA` PNG envelope and unchanged canonical pixel adapter; never accepts v1/PS authority.
- `chain.mjs`: selected deployment/code checks, creator provenance and tree reconstruction from public events at a rechecked block.
- `recovery.mjs`: complete encrypted operation exports; observed/historical/conflicted/unobserved creation and transfer recovery semantics.
- `vault.mjs`: separate encrypted IndexedDB journal, export/reselection acknowledgement and an atomic uncertain-before-submit transition. Logical fake-IndexedDB tests and a desktop browser reload/reselection trial do not establish hardware durability or device coverage.
- `prover.mjs`: development Node proving and verification, with optional selected-deployment artifact pins; `browser/prover-worker.js` demonstrates browser-local proving and artifact checks.
- `contracts/shielded/`: immutable experimental registry and generated-verifier adapters. Test setup artifacts remain under ignored `build`.

A proof copied by a relayer cannot change its destination. A copied bearer file can generate a competing proof; only a confirmed spend to a fresh secret establishes exclusivity. The user must retain recovery exports and public image/metadata copies. A saved authentic record or observed receipt can become stale after a reorg. No automatic finality, key recovery service, freeze/unfreeze administrator or production setup is provided.

The test profile permits public creation/artwork provenance and hides the explicit input leaf/asset during spending. Prior bearer holders, transaction accounts, timing and small sets can still reveal links. Showing/current-ownership profile publication is not implemented. Cloudflare hosting, licensing, independent cryptographic review, actual devices, distributed chain/finality assumptions and staging remain release gates.

## Isolated browser client

After the build/setup/test sequence above:

```sh
node research/shielded-lab/scripts/build-browser-fixture.mjs
pnpm --dir research/shielded-lab --ignore-workspace build:client
pnpm --dir research/shielded-lab --ignore-workspace client:local
```

The server starts a new loopback Anvil and deploys fresh test contracts, then prints a local URL. It owns only a disposable deployment/test-funding account. The browser generates its own note secrets, recovery encryption password, creation-signing/test-fee account and proofs. The server accepts only a public address to fund and a request to mine two test blocks; it never accepts notes, recovery files, passwords, private keys or witnesses. Browser RPC calls carry public reads, proofs and signed transactions. Stop with Ctrl-C; this destroys the local chain and closes the fixture. Do not use it with real assets or a public RPC.

Prepare creation or import a new-format bearer, save the encrypted recovery through its visible link, reselect that exact file, then generate and submit a proof. A pending call is journaled as uncertain before broadcast. After reload, unlock a saved operation and observe its outcome. An observed operation becomes historical when the checked chain state shows its destination spent. No automatic finality or retry is asserted. Public-image exports contain pixels only. Export links are scoped to the selected operation and revoked when it changes or the page closes.

This is a standalone browser candidate. It does not change the hosted v1 app, route, Worker or metadata. The fixture configuration is delivered by the local operator; those initial pins are not independently authenticated. A production/alternate client must obtain reviewed deployment/artifact pins separately. Same-origin tabs share the encrypted journal; a fresh Node recovery client is separately tested. The local creation-signing/test-fee account is memory-only; an unsubmitted creation's saved signature lasts one hour, and refreshing that authorization after loss/expiry is not a qualified wallet recovery flow. End-user note recovery after a successful creation does not depend on that account. Real wallet identity/fee integration remains a release gate.

Large chain replay and image normalization can consume main-thread time, and the browser journal has no qualified storage quota/retention policy. The worker deadline bounds an individual proving job, not the whole workflow. Full-tree proofs and reduced-depth rollover state tests qualify selected semantics, not browser throughput at a mature chain size. The contract retains one final root per completed tree plus 64 recent roots; spent nullifiers and used commitments remain global and storage grows with use.

The browser build aliases only the pinned `circomlibjs` Poseidon entry, avoiding unrelated Node-only generators. The source package and dependencies still require licensing review before production distribution. The isolated CI job rebuilds disposable Groth16 setup artifacts, circuits, contracts, tests, controls and browser bundle. It does not publish those setup keys or deploy to a public chain.
