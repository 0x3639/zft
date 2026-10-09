# Local PS status signer contract

This implements the first provider-neutral experiment from the [hosting/custody proposal](PS-HOSTING-CUSTODY-DESIGN.md), based on merged PR #26 (`19d4c35af70d17c9df85206c37cbed64f8e11b0c`). The new [StatusSigner](../research/ps-lab/local/status-signer.mjs) accepts an injected asynchronous transport, checks a bounded response, and verifies an Ed25519 signature against the exact original message and pinned public key.

It is an isolated library with tests. The persistent issuer, status receipt issuer, backup commands, browser Worker and HTTP server do not call it. No cloud SDK, provider request, private-key loader, network route or automatic fallback is added. The existing PS, image, vault, status and backup formats remain unchanged. This experiment qualifies selected adapter behavior, not production custody or secret execution.

## Inputs and transport contract

Construct `StatusSigner` with the caller's `psManifest`, complete status `manifest`, an exact `keyId`, `transport` function and optional `timeoutMs`. The complete manifest must match the existing `stateManifest` derivation, including realm/keyset, PS manifest hash, Ed25519 public key and status key ID. Configuration is captured privately; later edits to the caller's objects cannot replace it. No private key is accepted.

`keyId` is a bounded ASCII provider reference of 1–2048 characters from letters, digits, `: / . _ -`. It is compared exactly in each response. A future provider adapter must use an immutable full key identity and verify provider-specific metadata. The generic string check cannot distinguish an alias from a versioned key or establish account authorization. Cryptographic identity is independently pinned by the status public key.

Call `await signer.sign(message, { signal })` with a nonempty `Uint8Array` (including a Buffer view) of at most 4096 bytes, backed by an ordinary ArrayBuffer. SharedArrayBuffer-backed input, other input types and invalid signals reject. The adapter snapshots only the selected view, then gives the transport a separate copy. Caller or transport mutation cannot change the bytes used for signature verification.

The injected transport receives an immutable request object and a separate options object containing an AbortSignal:

| Request field  | Value                                                                       |
| -------------- | --------------------------------------------------------------------------- |
| `format`       | `zft-ps-status-sign-request-v1`                                             |
| `key_id`       | Exact configured provider reference                                         |
| `algorithm`    | `Ed25519`                                                                   |
| `message_type` | `RAW`                                                                       |
| `message`      | Owned copy of the original bytes; no hashing, reframing or canonicalization |

The transport resolves to a canonical JSON string of at most 4096 UTF-8 bytes with exactly `format`, `key_id`, `algorithm`, `message_type`, and `signature`. Its format is `zft-ps-status-sign-response-v1`; key, algorithm and message type must match the request. The signature is exactly 64 bytes encoded as lowercase hexadecimal. Alternate JSON encodings, duplicate/extra/missing fields, wrong metadata and bad signatures reject. Success returns only the verified signature hex.

These two format names describe a new local adapter envelope, not an AWS wire format or a credential-format revision. A future cloud transport must translate its actual API into this envelope, preserve raw-message semantics, bound network/body allocation before returning a string, and verify its own provider/account/key configuration. No such transport is implemented or tested here.

The adapter deliberately does not construct or authorize a receipt/checkpoint. The future caller must validate the request/proof, choose the exact domain-framed bytes and enforce admission, freshness, persistence and replay. A correct signature over caller-supplied bytes cannot establish any of those properties. This API must not be exposed as a general public signing service.

## Lifecycle and failures

There is at most one outstanding call per instance; a concurrent call fails immediately with `BUSY`. There is no queue or automatic retry. The deadline defaults to five seconds and may be configured from 100 to 5000 milliseconds. A monotonic deadline is checked before dispatch and before accepting a response, including after signature verification; a timer rejects a nonsettling asynchronous transport. A blocked event loop can delay rejection, but a late valid response is still discarded once execution resumes. This is not a hard real-time limit on transport code, CPU, process startup or configuration validation.

| Code suffix   | Result                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG`      | Invalid constructor configuration; transport was not called                                                                       |
| `INPUT`       | Invalid message or signal; no dispatch                                                                                            |
| `BUSY`        | Existing call must finish first; no queued work                                                                                   |
| `UNAVAILABLE` | Synchronous throw or rejected transport promise; provider diagnostics are discarded                                               |
| `RESPONSE`    | Malformed envelope, substituted metadata or invalid signature                                                                     |
| `TIMEOUT`     | Deadline exceeded; result discarded and adapter permanently closed                                                                |
| `CANCELLED`   | Caller aborted; an active call closes the adapter; an already-aborted signal never dispatches and leaves an idle adapter reusable |
| `CLOSED`      | Explicitly closed, or previously interrupted adapter; no further dispatch                                                         |

Errors have fixed messages and `ERR_PS_STATUS_SIGNER_` code prefixes, with no provider error, payload or cause attached. An unavailable or invalid response permits a later explicit call, with the same pinned configuration. That permission is not authorization to regenerate an issuer operation; a future integration must first resolve ambiguous durable state.

`close()` is permanent and idempotent. Timeout, active cancellation and close request transport abort and prevent late resolve/reject from producing a signature. They do not prove that an external signer stopped or that a signature was never generated. The experiment includes transports that ignore abort. Creating a new adapter does not cancel old provider work; future integration needs process-wide concurrency/resource controls and provider-specific cancellation policy. The injected JavaScript function is trusted code in the same process, not a sandbox boundary.

## Existing transcript compatibility

Tests create a real local PS credential and observation using the unchanged `StateIssuer` and `StateObserver`. The adapter signs the original `ZFT_PS_Local_State_v1/receipt` domain, NUL separator and canonical body with an ephemeral test Ed25519 key. Its signature exactly matches the existing signer and the unchanged observer accepts the resulting receipt, still reporting `walletAuthenticated: false`.

A separate disposable persistent issuer creates an actual stopped backup. The adapter signs the original `zft-ps-local-backup-v1/checkpoint` domain, NUL separator and canonical body with that fixture's generated status key. The resulting signature and complete snapshot bytes match; the unchanged restore verifier accepts the original checkpoint and keeps the restored issuer suspended for review. No user state or downloads are involved. An initial fixture referenced the wrong status-pin field; it was corrected to the existing `pins.status` before the passing run.

These are selected same-author compatibility cases, not a proof that every allowed receipt or backup fits a future provider API. The adapter rejects messages above its explicit bound. Complete transcript-size analysis and actual provider interoperability remain required. No new actual SIGKILL, hardware, power-loss, browser or remote-signing acceptance is claimed.

## Checks and remaining work

[Current evidence](../research/ps-status-signer-validation.json) records 20 focused tests, including exact 1/4096-byte inputs, rejected oversized/shared-memory inputs, caller/transport mutation, pinned identity, malformed envelopes, wrong-message/key/prehash signatures, provider failure redaction, concurrency, deadline/blockage, cancellation, close and the two existing-transcript cases. Five temporary mutations remove signature verification, key-reference comparison, memory separation, input bounds or the absolute deadline; each must fail its named assertion.

The combined local suite passes 286 cases; the five new controls bring the mutation total to 83. Final run outputs are hashed in the evidence manifest. Earlier JSON manifests, frozen reference and core local profile/client/issuer/store/state/image/png/vault files remain historical and byte-identical to the baseline. Standard PR CI reruns app/reference checks; this increment adds no device acceptance.

The release checker now starts after merged PR #26 and pins the new current source manifest. The pending evidence template still has no real approvals. This only keeps exact-candidate source/signature checking usable after the new baseline; it does not satisfy independent review, custody, operations, device or staging gates.

Next engineering increments remain: versioned protected-key storage and unwrap failures; a qualified PS secret-operation backend; actual managed status-signing integration; and the asynchronous durable-state boundary before live server use. The current issuer still holds plaintext local keys and session secrets. PS-OWN-01 and independent C1/C4 review remain open, as do provider selection, real-device acceptance, fencing/retention and explicit staging approval. Do not describe this adapter as non-exportable PS custody, an audited backend or hosted readiness.
