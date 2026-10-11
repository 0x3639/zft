# Shielded proof feasibility — local candidate

October 10, 2026. **Groth16 is selected for the isolated local lifecycle prototype. Production selection remains conditional on setup, licensing, independent review, devices and chain operations.** The exact experimental relations are in [SHIELDED-ZVM-PROTOCOL.md](SHIELDED-ZVM-PROTOCOL.md).

## Execution evidence

The selected ZVM RPC returned chain ID `7340469` and genesis `0x2a55e0b69e552a105d559e99b12e0cae28d6e07a3c7a9f264a1543a040ef8ea4`. At block `0x206c9`, hash `0xa736c323252a919f7f5cf0d96b8134d43706fce3fe77baa4efb941f2dfad282d`, it accepted valid BN254 addition, multiplication and pairing cases and rejected the selected invalid cases. The block hash was rechecked after the calls.

All four generated verifiers (create/spend, Groth16/PLONK) accepted a real proof and returned false for a changed public domain in read-only `eth_call` with a code state override. This executed the generated verifier bytecode through the RPC without publishing a contract or transaction. Raw requests, bytecode, responses and runtime hashes are retained in the [runtime evidence](../research/shielded-evidence/runtime-2026-10-10.json).

This qualifies those selected read-only execution paths on that endpoint at that block. It does not establish deployment permission, transaction fees, consensus finality, independent derivation/submission, operator availability or censorship resistance. Local Anvil was explicitly configured for Cancun; its costs are not ZVM fee measurements.

## Same-circuit desktop comparison

Circom 2.2.3, `--O2`; snarkjs 0.7.6; Node 22.12.0 on macOS arm64. Creation has 1,105 nonlinear R1CS constraints; spend has 6,393. Both have four public inputs. Five sequential samples include witness calculation, proof generation, local verification and calldata conversion. The first sample can include initialization. This is a small desktop experiment, not a population percentile or phone benchmark.

| Circuit/system |       Proving key | Observed proof path | Encoded proof | Complete verifier calldata | Successful local verifier transaction gas |
| -------------- | ----------------: | ------------------- | ------------: | -------------------------: | ----------------------------------------: |
| Create Groth16 |   1,018,518 bytes | 149–370 ms          |     256 bytes |                  388 bytes |                                   235,758 |
| Spend Groth16  |   4,619,114 bytes | 469–702 ms          |     256 bytes |                  388 bytes |                                   236,142 |
| Create PLONK   |  33,323,232 bytes | 7.28–7.68 s         |     768 bytes |                  900 bytes |                                   297,651 |
| Spend PLONK    | 265,279,552 bytes | 54.4–58.4 s         |     768 bytes |                  900 bytes |                                   298,764 |

The create/spend WASM files are 2,307,311 and 3,252,315 bytes. Together, the two Groth16 keys and WASM total about 10.7 MiB before the library and verification keys. Peak process RSS reported by the four separate Node workers was approximately 351, 610, 537 and 1,209 MiB respectively in the row execution order create-Groth16, create-PLONK, spend-Groth16, spend-PLONK. These are process peaks across five samples, not isolated circuit memory allocations or browser measurements. See the [raw desktop measurements](../research/shielded-evidence/desktop-benchmark.json).

PLONK conversion produced 67,761 spend constraints, exceeding the first 2^15 setup artifact; the larger pinned 2^17 artifact was required. The unsuccessful setup and corrected run were retained locally. The first harness also exposed snarkjs 0.7.6's missing comma between PLONK calldata arrays; the adapter now encodes the documented field order directly and checks it against the generated verifier. Initial gas estimates were discarded: a boolean-returning verifier can return false on an early failure, so `estimateGas` alone did not measure successful verification. Final gas numbers are receipts from transactions with ample gas, paired with a successful `eth_call` using the same budget.

## Browser and lifecycle observations

An actual desktop browser worker generated and verified the public creation fixture in 572 ms and the spend fixture in 2624 ms using single-thread Groth16. Each artifact's size and SHA-256 were checked before loading. Cancelling terminated the worker. Those single observations exclude artifact retrieval/hash time and do not measure memory. [Browser trial record](../research/shielded-evidence/browser-trial.json).

The local real-proof lifecycle covers image normalization and new-format export/import; creator authorization and commit/reveal; transfer to a saved successor; changed roots/nullifiers/outputs; old and competing bearer proofs; encrypted recovery reselection before submission; fresh-process event reconstruction and spending; a selected reorg followed by the same saved-destination retry; and two competing transactions in one block with exactly one accepted spend. No hosted application index or issuer participates. This is one local operator and one local chain, not the independent disappearance drill required by SH5.

Eight temporary circuit mutations remove or alter required nullifier, asset, root, successor, path, range and nonzero constraints. Each passes its baseline adversarial rejection and fails the named assertion under the mutated R1CS. The ordinary suite also directly modifies each public witness wire and requires the original R1CS check to fail. These controls strengthen regression evidence; they are not independent cryptographic review. [Control results](../research/shielded-evidence/circuit-controls.json).

## Integrated local follow-up

The fixed-depth commitment tree now rolls over permissionlessly. Completed tree roots remain admissible after the recent-root ring evicts them, and nullifiers and commitments remain global. A full 65,536-leaf client tree generated a real proof spending an old leaf after rollover. A separate depth-three EVM state fixture performs 73 appends across multiple trees and tests root eviction, old-root acceptance and global uniqueness. Its deliberately accepting verifier is only a state-machine test; it is never used for cryptographic acceptance or shipped in the generated artifacts.

Eight additional contract controls remove closed-root retention, nullifier writes, commitment uniqueness, root recognition, creator signatures, image uniqueness, minimum reveal delay or maximum commit age. Each causes a named test assertion to fail. [State control results](../research/shielded-evidence/state-controls.json).

The isolated browser client subsequently created an image with a fresh browser-owned secret, saved and reselected its encrypted recovery, proved locally in 0.67 seconds and submitted to disposable local contracts. A separate Node client reopened that approved recovery and recreated the bearer. A second browser tab imported it, prepared fresh authority, saved/reselected its own recovery, proved in 2.53 seconds and claimed successfully. The old file was rejected on a new claim attempt; a full page reload unlocked and re-observed the same recipient from IndexedDB. These are desktop observations, not independent operators, real MetaMask/mobile acceptance or a completed disappearance drill. The two tabs shared an origin and encrypted journal.

The first browser bundle pulled in an unrelated Node-only dependency and failed on an undefined Buffer. The build now selects the pinned Poseidon browser entry explicitly. The browser automation download event and temporary-artifact download API timed out even though ordinary download links worked. Explicit user approval permitted creation/reselection of only the disposable test exports; no pre-existing Downloads files were altered. The initial additional lifecycle test reused a variable name and failed to load; it was corrected before the passing rerun. A later regression found that observing a prepared creation before recovery acknowledgement left its journal in `unobserved`, which the acknowledgement transition incorrectly rejected. Acknowledgement now accepts both prepared and unobserved records after exact saved-file verification; the complete 21-test suite passes. A separate blocked-IndexedDB-open regression confirms a late successful connection is closed after abandonment. [Browser lifecycle evidence](../research/shielded-evidence/browser-lifecycle.json).

## Prototype decision and open gates

Use Groth16 for continued local work because this measured implementation has materially smaller artifacts and faster proving. Retain the PLONK comparison and failure history. This comparison does not rule out optimized PLONK circuits or other proof families; it evaluates the current pinned circuit/compiler pipeline only.

For the browser prototype, use a separate worker per proof, a 60-second user-visible cancellation deadline and a 32 MiB per-artifact download bound. The current Groth16 artifacts fit that bound. These are implemented resource/cancellation controls, not assurances that a phone will finish within a fixed latency or memory limit. Decide actual target-device acceptance budgets from measurements on those devices before release; do not silently move a slow proof to a server.

The public powers-of-tau files are checked against the [snarkjs published digests](https://github.com/iden3/snarkjs#7-prepare-phase-2). Groth16 phase-2 keys were produced with only a local disposable contribution. They are test keys, and must not authorize a public release. [Exact development setup record](../research/shielded-evidence/development-setup.json).

Circom/circomlib/circomlibjs/snarkjs distribution and derivative-artifact licensing must be resolved for the shipped application; the installed package declarations include GPL-3.0. This experiment does not change the repository's license or assert compatibility for a production bundle. Reproducing the public setup transcript, choosing an acceptable production phase-2 process and reviewing generated verifier/artifact provenance remain separate from checksum checks.

Independent protocol/circuit/contract review, actual Firefox/iOS/Android and applicable wallet flows, independent chain access/finality, full hosted-service disappearance, and explicit isolated-devnet staging approval remain open. Public showing remains disabled because historical membership does not prove current unspent control. Existing v1 resources and all historical PS evidence are unchanged.

## PR31 review follow-up

Review of signed `639d0dc` found stale PS/SH1–SH2 milestone wording, a manifest typo, and an outdated PBKDF2 work factor. The active documentation now identifies the local SH3/SH4 candidate and ties future release acceptance to exact signed source, setup/verifier artifacts and deployment configuration. Historical PS gates remain historical.

Recovery now uses exactly 600,000 PBKDF2-HMAC-SHA256 iterations through one shared constant. A regression first failed on the reviewed implementation with a named assertion; it then independently decrypted the new export through Node's separate crypto API and rejected authentic records using 310,000 or 600,001 iterations. The current parser does not accept a downgrade range. The earlier disposable browser exports and trial are preserved as historical evidence, not reclassified as acceptance of the new work factor. Actual target-device KDF performance remains open.
