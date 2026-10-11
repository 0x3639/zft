# Shielded ZVM implementation plan

**Current environment, October 11, 2026:** chain-backed validation is limited to `devnet.zenon.foo` and ZVM devnet. Follow the [devnet validation plan](SHIELDED-DEVNET-VALIDATION.md). Production/mainnet acceptance remains future work; no production ZVM availability is assumed. Offline tests remain local. The user authorized six isolated devnet contracts and their disposable mint/claim/recovery experiment under a 1 devnet ZNN fee cap; that lifecycle now passes. Hosted app activation and broader release acceptance are separate.

October 11, 2026. This is the executable work sequence for the accepted [shielded ownership direction](SHIELDED-ZVM-PLAN.md) and [SH0–SH7 roadmap](IMPLEMENTATION.md#roadmap-status). The protocol candidate merged in PR31. The [opt-in app integration](SHIELDED-APP-INTEGRATION.md) merged in PR32; its controller/real-contract tests and the [recorded desktop browser lifecycle](SHIELDED-BROWSER-ACCEPTANCE.md) pass. Target wallets/devices, in-app-browser downloads and production acceptance remain open. The [experimental protocol](SHIELDED-ZVM-PROTOCOL.md) and [feasibility evidence](SHIELDED-ZVM-FEASIBILITY.md) now include real local proofs, a two-client lifecycle, same-block double-spend rejection, reorg/fresh-process recovery, encrypted journal and an isolated browser mint/claim/recovery trial. Forest rollover and 16 circuit/contract controls pass locally. Public activation, independent adversarial review and external acceptance are still pending.

Build one integrated local candidate in this order: specify the asset and proof relations, qualify the execution/proving path, demonstrate two-client transfer, add durable browser recovery and replaceable services, then complete independent and release acceptance. Keep unpublished checkpoints together and batch-sign one consolidated PR. Preserve the existing public v1 app, contract, data and all historical PS evidence.

## First working milestone

The first end-to-end milestone is a disposable local demonstration with one image and two independent clients:

1. Client A normalizes the image, creates metadata containing its image hash, saves recovery authority and mints one valid note through a real proof and local verifier contract.
2. A exports a bearer picture file. B imports it, verifies the image and metadata, saves a new destination secret and claims into a successor note.
3. A's old file and a concurrent competing claim fail to spend the consumed note. Neither a copied proof nor altered metadata can redirect or redefine the asset.
4. B loses the submission response, closes its original process and recovers the same successor from its saved recovery file in a fresh client.
5. The test rebuilds the commitment tree from local chain events and repeats verification without an application index or issuer service.

This milestone uses test-only setup material and disposable keys. It must exercise the actual circuit and contract; mocked proof acceptance is useful for scaffolding but cannot satisfy the milestone. Browser polish, profiles, marketplace, remote backup and hosted deployment are outside this first slice.

## Image and metadata binding

Use the existing frozen image normalizer through an adapter; do not change v1 canonical bytes. Define a new, strict metadata schema and reuse the deterministic JSON encoding approach from v1. Canonical JSON encoding follows [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785). Reject duplicate fields, unknown schema versions and invalid numeric/string representations before hashing.

| Value                | Required meaning and checks                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imageHash`          | SHA-256 of the canonical image bytes, excluding the ownership envelope. Recompute from imported bytes; do not trust a filename, URL or thumbnail.                                                          |
| `metadata.imageHash` | The same complete 32-byte image digest inside immutable metadata, with name, description, format/canonicalizer, dimensions and the selected provenance fields. Exact fields and bounds are frozen in SH1.  |
| `metadataHash`       | SHA-256 of the canonical metadata bytes. Require the embedded image hash and dimensions to match the verified image.                                                                                       |
| Asset identity       | A domain-separated binding of both digests and the selected protocol/deployment identity. SH1 fixes the precise hash and byte encoding; a name or hosting URL is not asset identity.                       |
| Note commitment      | Commits to that asset identity and the note's spending/nullifier authority and randomness. Creation constrains the first note to the authorized asset. Transfer preserves the same asset in its successor. |

The binding is **image bytes → `imageHash` in metadata → `metadataHash` → asset identity → note commitment**. The asset identity also binds the image digest explicitly so that mint authorization, contract state, circuit inputs and client checks agree on both digests. Metadata does not contain its own digest, and image hashing excludes the appended ownership envelope, avoiding circular hashes.

A transfer changes spending authority and randomness, not the image, metadata or immutable provenance. Changing protected metadata creates a different asset description; it is not an ownership transfer. Freeze the within-deployment duplicate-image policy in SH1; the proposed starting policy retains v1's one issuance per canonical image digest in that deployment. This does not establish originality or prevent copies in other deployments.

The browser verifies image/metadata bytes. The contract and circuit verify the authorized digest/commitment relations; they do not need to hash megabytes of image pixels inside the circuit. Exact 256-bit digests must survive field encoding without modulo aliases; specify and constrain limbs where necessary. A malicious direct mint can commit unusable or unavailable content unless the protocol proves more about it, so clients must reject inconsistent imports independently of on-chain inclusion.

File and recovery exports retain the image bytes and immutable metadata. Retrieval locations are untrusted hints: resolve another copy or a user-held file and verify its hashes when Cloudflare is unavailable. If a URL is included in the immutable metadata, changing the retrieval endpoint must not require rewriting that metadata. Public copies remove all spending and recovery material.

## Protocol and privacy baseline to test

Use a new shielded namespace/deployment. Propose public artwork and creation metadata with a shared commitment tree across assets; subsequent transfers should not publish the hidden input commitment, its leaf index, asset identity or owner. Their public data should be limited to the reviewed proof inputs, such as an admissible root, deterministic spend nullifier and successor commitment, plus explicitly authorized fee/transaction fields. SH1 must analyze what mint events, timing and selected showings still reveal. A shared tree does not by itself prove a useful anonymity set.

Write exact creation, spend and showing relations before freezing the circuits. Creation must bind the declared image and metadata digests, creator authorization and first output. Spending must prove membership, authority, a unique bound nullifier and one-output conservation. A leaf index, if used by the nullifier derivation, must be constrained to the membership path. Keep root history, nullifier uniqueness and output publication in one atomic state transition.

Specify current-ownership showing separately from spend proofs. Decide whether showing reveals a spend identifier or proves unspentness another way, and record the resulting linkability. Bind voluntary profile publication to the intended profile, challenge and identified chain state. Until this is complete, the UI can verify artwork integrity and historical proof statements but must not label them current ownership.

The protocol must define how a relayer can be replaced without permitting output or fee substitution. A browser worker is a responsiveness boundary, not a security sandbox against compromised application JavaScript. No server-side proving with user witnesses is part of the initial implementation.

## SH1 and SH2 work package

| Task                           | Concrete output                                                                                                                        | Acceptance                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SH1.1 Asset and file schemas   | Proposed `docs/SHIELDED-ZVM-PROTOCOL.md`; exact canonical metadata, asset binding, domain, note and recovery formats; disclosure table | Positive fixtures and one-field mutations cover image/metadata substitution, duplicate fields, format confusion and full-width digest encoding.                                                   |
| SH1.2 State machine and proofs | Creation/spend/showing relations, public/private input list, nullifier derivation, root retention/capacity and failure rules           | Every public input has a documented constraint and contract check; every private authority input is bound to the spent note. Include mint front-running and duplicate issuance analysis.          |
| SH1.3 Recovery and access      | Operation journal and recovery state machine; witness reconstruction and direct submission procedure                                   | A saved record contains enough authority and operation identity to resolve lost responses; no server account or decryption key is required.                                                       |
| SH2.1 Runtime qualification    | New dated report with chain/genesis/runtime pins, raw calls and execution limits; independent derivation/submission assessment         | Valid and invalid precompile/verifier cases behave as specified. An inaccessible RPC is recorded as unavailable, not a passing result. Historical BLS probes are not substituted for this report. |
| SH2.2 Prover comparison        | Representative create/spend circuit, generated Solidity verifiers and browser worker harness                                           | Measure proving time/memory, cold artifact download, proof/calldata size and verifier gas on the same circuit and devices. Record p50/p95 where repeatable and all failures.                      |
| SH2.3 Selection record         | Proof-system, hash suite, encodings, tree parameters, dependency/build pins and setup rationale                                        | Choose from measured results and reviewability; define resource budgets before freezing SH1. Verify license compatibility and setup provenance.                                                   |

For a bounded first comparison, use Circom/snarkjs with Groth16 and PLONK over a qualified BN254 verifier path. The same tooling supports browser proving and Solidity verifier export. Groth16 needs circuit-specific setup; PLONK still depends on universal setup. This is a feasibility shortlist, not an approved production dependency or ceremony. [snarkjs documentation](https://github.com/iden3/snarkjs#15-setup), [verifier export](https://github.com/iden3/snarkjs#25-turn-the-verifier-into-a-smart-contract).

Qualify BN254 addition/multiplication and pairing behavior against [EIP-196](https://eips.ethereum.org/EIPS/eip-196) and [EIP-197](https://eips.ethereum.org/EIPS/eip-197), then test the entire generated verifier with altered inputs and invalid proofs. Do not infer support or fees from EVM branding or the older BLS12-381 probe. A local EVM result is not a live ZVM result. If the shortlist fails runtime, license, resource or trust requirements, record the reason before evaluating another family; do not silently move proving or ownership authority to a service.

Read-only runtime probes and local execution can precede staging. Public contract deployments and transactions still require authorization. SH2 may report a conditional local result while a required live/independent path is unavailable; it cannot close that gate until actual evidence exists.

## SH3 and SH4 work package

| Task                            | Concrete output                                                                                              | Acceptance                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SH3.1 Isolated SDK and vectors  | Strict parsers, hashes, note/witness/state logic, minimal CLI file and saved-operation adapters, and vectors | Independent expected-value vectors, wrong-domain rejection and parity between SDK inputs and circuit encoding.                                                                                                      |
| SH3.2 Circuits and contract     | Creation/spend circuits, pinned generated verifier, registry/tree/nullifier contract and events              | Real proofs drive the first working milestone. Double-spend races, changed nullifier keys, substituted metadata/outputs, invalid paths and aliases reject atomically.                                               |
| SH3.3 Adversarial qualification | Circuit and contract mutation controls, stateful/fuzz sequences and reorg/replay tests                       | Removing a named constraint/check causes a named assertion failure. Witness generation success alone does not demonstrate sound circuit constraints.                                                                |
| SH4.1 Files and recovery        | New file discriminator and codec adapter, encrypted local vault and operation journal                        | Recovery acknowledgment precedes submission. Crash before/after each durable boundary, lost response and fresh-client import recover the same destination. Password changes do not falsely revoke old bearer files. |
| SH4.2 Browser experience        | Local proving worker, import/verify/mint/export/claim/cancel/recover routes and protocol-specific inventory  | Distinct prepared/pending/uncertain/finalized/historical/unavailable states; v1 routing and files continue to work. Public downloads and previews contain no secrets.                                               |
| SH4.3 Replaceable services      | Rebuildable index, content retrieval and optional public-transaction sponsorship                             | Client verifies chain/artifact pins and content hashes; service replies never grant authority. A separate client can derive witnesses and submit without ZFT services.                                              |
| SH4.4 Optional public showing   | Reviewed showing circuit and profile-bound display, if its acceptance requirements are met                   | Showings state exactly which chain state they cover and what identifiers they disclose. No claim of current control from historical membership alone.                                                               |

Start the lifecycle with command-line clients so contract/circuit failures are visible without UI dependencies. SH3 includes the minimal versioned picture file and saved-operation implementation needed for its recovery milestone; SH4 adds the encrypted browser vault and full download/reselection experience. Build browser file/recovery handling once those invariants pass. Prefer reusing independently callable image normalization and UI elements; do not adapt the legacy PS issuer or service into the new ownership authority. Any later shared-code extraction must preserve the existing formats and pass their compatibility fixtures.

## Proposed repository layout

The circuits, isolated registry and research harness now exist. The production SDK/app/service paths below remain integration targets; the first client/file/recovery implementation currently lives in the isolated lab. Keep dependencies in an isolated package until the selection record is complete; add production workspace integration only in the same reviewed candidate that uses it.

| Proposed location                                   | Responsibility                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `research/shielded-lab/`                            | Frozen experimental dependencies, circuit/prover benchmarks, runtime probes, vectors, scripts and disposable lifecycle harness             |
| `circuits/shielded/`                                | Selected source circuits, compiler settings, constraint inspection and provenance for generated artifacts                                  |
| `contracts/shielded/`                               | New registry, generated verifier and dedicated tests/build configuration; do not replace `contracts/src/ZFT.sol`                           |
| `packages/shielded/`                                | Protocol schemas, canonical asset binding, proof adapter, witness reconstruction, file/vault/journal adapters and independent verifier CLI |
| `apps/web/src/shielded/`                            | Worker-based local proving, inventory and recovery UI with explicit v1/shielded dispatch                                                   |
| `apps/api/shielded/`                                | Optional derived views and sponsorship over public, authorized transactions; no spending keys, bearer files or private witnesses           |
| `research/shielded-*/` and new validation manifests | Reproducible result bundles for each pinned candidate; no edits to historical PS manifests                                                 |

The existing build script targets only `contracts/src/ZFT.sol`; add a separate shielded build target and artifact directory. The existing CI has app/v1 and PS suites; add isolated circuit/SDK/contract jobs, then browser integration checks. Keep generated witnesses and secret fixture material out of public CI artifacts. Test-only keys must be clearly separated from user state.

## SH5 and SH6 acceptance

Run independent protocol/circuit/contract review against the exact code and setup artifacts. Resolve findings, and have a separate verifier reproduce the vectors and artifact hashes. Bot review and same-author tests are useful checks, not substitutes for independent cryptographic review.

Qualify actual Firefox, iOS and Android proving, file download/reselection, recovery, storage loss and applicable MetaMask identity/fee flows. Set device/resource budgets from SH2 measurements; do not present a desktop benchmark as mobile acceptance. Exercise key/witness leakage checks across HTTP, logs, exceptions, public APIs, analytics and rendered previews.

The disappearance drill disables the hosted frontend, index, sponsor and backup together. Using only public chain data, a pinned alternate client and user-held recovery files, a second operator must reconstruct state, resolve a pending claim and spend through an independent fee/submission path. Record the remaining chain/operator availability assumptions. Content hashes prove integrity, not that anyone will keep serving a file.

Only then prepare the exact signed release candidate, verifier/circuit/setup and dependency manifests, separate devnet deployment configuration, operational monitoring and failure procedures for explicit staging approval. Monitoring may observe public chain progress, index lag and service health; it cannot restore custody, issue replacements or override spent state. Existing v1 resources and apex routing remain unchanged. Mainnet, marketplace, wrappers/migration and Snap stay outside this candidate.

## Execution order and completion tracking

The integrated work sequence is:

1. Write SH1.1–SH1.3 as precise schemas and proof/state-machine requirements, including the full image/metadata binding and disclosure table.
2. Build the isolated SH2 harness with pinned dependencies and a representative circuit, then run read-only runtime probes and local/browser measurements.
3. Produce the SH2.3 selection record. Freeze encodings, circuits' public inputs and resource budgets only after comparing the evidence.
4. Implement SH3.1–SH3.2 and complete the two-client milestone with actual proofs.
5. Add adversarial controls, browser recovery, replaceable services and qualified showing in SH3.3/SH4.
6. Complete SH5 evidence and prepare the SH6 candidate for approval.

Track progress under the existing SH identifiers. Mark code complete only with implementation and its required tests; record external acceptance separately. Continue independent local work when a live endpoint or reviewer is unavailable, but never mark its dependent gate passed. Estimate remaining time after SH2 measurements; this plan does not assign unsupported completion dates.

Keep one development history with unsigned local checkpoints, preserve an unsigned backup before batch signing, and publish one consolidated signed PR. Do not publish a new PR for each row. The initial planning update was documentation only. Current implementation/evidence is recorded separately in the feasibility report; it includes read-only live probes and local contracts, but no public deployment or v1 switch.
