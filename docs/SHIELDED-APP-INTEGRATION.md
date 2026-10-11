# Shielded app integration candidate

This opt-in integration connects the zft.foo browser shell to the frozen [PR31 protocol candidate](SHIELDED-ZVM-PROTOCOL.md). End users generate and hold spending secrets. The selected registry enforces spends. No PS issuer, hosted key store, sponsor, profile service or recovery administrator participates. [Current evidence](../research/shielded-app-validation.json) uses merged PR31 (`694e20f1e4668d99c6b7c7a6917eb2f54360b16a`) as its explicit baseline. The earlier [protocol evidence](../research/shielded-validation.json) is historical and unchanged.

## Scope and build boundary

`packages/shielded` composes the unchanged image, note, chain, recovery and journal modules in `research/shielded-lab`; it does not introduce new circuits or cryptographic relations. The opt-in React routes are `/shielded`, `/shielded/create`, `/shielded/claim` and `/shielded/recovery`. Navigation within them retains the selected session. Public v1 remains a separate route and uses its existing implementation.

A normal `pnpm build` excludes the shielded implementation, proof worker and recovery code. `ZFT_SHIELDED_CANDIDATE=1 pnpm build` includes the experimental routes and their navigation links. Neither command deploys. No hosted deployment configuration, production setup or artifact store is selected automatically. Root dependencies and lockfiles remain unchanged; the opt-in build uses the frozen isolated lab dependencies. This transitional source layout is not a published SDK package or approval of dependency/artifact licensing.

## Deployment selection and wallet boundary

Open a canonical JSON file (at most 16,384 UTF-8 bytes) with exactly `format`, `pins`, `rpc` and `artifacts`. The format is `zft-shielded-app-config-v1`. `pins` is the complete existing chain/genesis/contract/runtime/artifact pin structure. `rpc` must be an exact HTTPS URL without embedded credentials, query or fragment. HTTP is allowed only for a loopback page and loopback RPC with chain ID 31337.

`artifacts` contains exactly `library`, `create-wasm`, `create-key`, `create-verificationKey`, `spend-wasm`, `spend-key` and `spend-verificationKey`. Each has an absolute same-origin `/shielded-assets/…` path, exact byte count (1–32 MiB) and lowercase SHA-256. Circuit artifact hashes must match the deployment pins. The proof library hash is explicitly selected in the configuration. The existing worker fetches bounded bytes, rejects redirects and verifies hashes before executing them. A configuration digest identifies the selected file; it is not an endorsement. Users need an independently trusted source for these pins and executable artifacts.

The injected EIP-1193 wallet is used only for public creator authorization and public transaction calldata. Before signing/submitting, the adapter verifies the account, chain ID, wallet RPC genesis, pinned runtime code and contract relationships. Account/chain/disconnect events invalidate the session. Creator signatures are recovered and checked locally. These checks detect selected mismatches; the wallet and delivered application code remain trusted software. No note secret, password, recovery record, image bytes or private proof witness is sent to the wallet or RPC by this integration. Public hashes, commitments, nullifiers, transactions, fee accounts and RPC activity can still be identifying.

## Operation and recovery flow

1. Create normalizes the image and binds its exact digest into immutable metadata. Receive verifies an imported bearer and prepares a fresh destination secret. A copy of an old bearer can race until a successor spend is confirmed.
2. Preparation encrypts the original operation in a separate IndexedDB journal named from the selected deployment pins. Download recovery and select that exact saved export again. A checkbox or download click alone cannot authorize submission.
3. Generate the proof locally in a dedicated worker. The controller requires its public signals to match the selected operation. Worker completion, cancellation, error or a 60-second timer terminates that worker; this is not a whole-operation resource or latency qualification.
4. Creation has two explicit fee-wallet submissions: commitment, then reveal after two blocks and within the existing 256-block window. The app does not mine or wait for blocks on the user's behalf. Expired authorization can be renewed with the same destination authority; its new recovery record needs a new saved-file acknowledgement.
5. Every dispatch follows a durable `uncertain` transition. A rejected or lost wallet response stays uncertain until explicit observation. The contract, not this local journal, resolves competing spends. A successful receipt is followed by the existing pinned observation process.
6. Recovery/unlock retains the original destination and requires observation before proof or retry. Import into a new journal requires a freshly saved/reselected journal export. An observed operation can export its bearer; export re-observes first. A public image export contains canonical artwork only.

There is one controller operation at a time and no automatic retry. Errors shown by the app are fixed and omit provider details. Lock closes the controller/journal, invalidates late UI updates, terminates proving, drops secret references, clears file/password inputs (including a revealed password), and revokes prepared Blob URLs. Encrypted IndexedDB remains. This is not memory zeroization, secure erasure, hardware durability, protection against malicious delivered JavaScript or a distributed lock. Public showing/profile ownership publication stays disabled. “Observed” describes checked RPC state, not independently qualified finality or private current ownership.

## Reproduction

Use the existing frozen [lab setup instructions](../research/shielded-lab/README.md) to build the disposable circuits/verifiers once. Setup refuses overwrite. Then:

```sh
node --import tsx --test --test-concurrency=1 research/shielded-app/test/*.test.mjs
node research/shielded-app/check-controls.mjs
node research/shielded-app/check-builds.mjs
pnpm typecheck
node --import tsx research/shielded-app/local-server.mjs
```

The local server prints a loopback URL and a disposable fixture directory containing `config.json` and `picture.png`. Select that configuration in the app. Its separately built, test-only wallet generates a disposable fee key in the browser, funds only its public address through the local Anvil process, and provides an explicit two-block mining button. That wallet/mining shim is excluded from both product builds. The server receives no spending witnesses or recovery passwords. Stop it with SIGINT/SIGTERM; it removes only its temporary fixtures and local chain. It never changes Downloads originals or an existing private demo.

## Evidence and remaining acceptance

Eight integration tests use real local verifier contracts/proofs, separate IndexedDB factories and injected disposable fee wallets. They cover creation/claim/public output, old-bearer rejection, fresh-client recovery to the original destination, restore-before-observe rejection, a broadcast followed by lost wallet response, wrong saved files, altered proof signals, account/chain changes, same-chain wrong-genesis wallet RPC, late proof completion after close, and renewal without replacing authority. Eight temporary controls each fail a named assertion when acknowledgement, signal binding, uncertain-before-send, account/chain checks, wallet deployment verification, restored observation, closed-session rejection or artifact pins are removed. They add no actual SIGKILL boundaries.

The desktop browser trial reached deployment verification, disposable wallet connection, image preparation and encrypted journal/export-link creation. Its download click and two supported download APIs did not yield a saved file in the in-app browser. Therefore **integrated browser saved-file acknowledgement, proving, submission, receive and reload recovery are not claimed as passed**. The full flow passes at the controller/real-local-contract test layer. Earlier PR31 browser evidence applies only to its recorded standalone bundle. Current lock/layout observations and exact bundle hashes are recorded separately in [browser evidence](../research/shielded-app/evidence/browser.json).

Default/opt-in bundle checks require the implementation to be absent/present respectively and forbid the test fund/mining routes in both. Type checking and existing app regressions are separate from circuit qualification. The opt-in shielded chunk is approximately 2 MB before compression; mobile latency/memory/download budgets are still open.

Remaining gates: complete the integrated browser file/proof/submission trial; real MetaMask, Firefox, iOS and Android; independent protocol/circuit/contract reproduction and review; production setup/provenance/licensing; independently qualified ZVM transaction/finality and second-operator service-disappearance drills; resource budgets and explicit staging approval. Cloudflare hosting or a successful local test does not satisfy these gates. No public deployment, migration or change to the existing Worker is part of this PR.
