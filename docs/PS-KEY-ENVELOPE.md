# Local PS key-envelope contract

This is the next isolated experiment from the [hosting/custody proposal](PS-HOSTING-CUSTODY-DESIGN.md), based on merged PR #27 (`f69b8302ab44ab30c22c9126584f88e5718616f7`). [PsKeyEnvelope](../research/ps-lab/local/key-envelope.mjs) creates a bounded encrypted representation of long-lived PS issuer scalars and opens it through an injected wrapping transport. The [status signer experiment](PS-STATUS-SIGNER-CONTRACT.md) remains separate and unchanged.

The persistent issuer, HTTP server, status signer, browser, database and backup commands do not call this adapter. The original `private.json` and SQLite session secrets remain plaintext. No file writer, production keystore, migration, wrapping provider, cloud SDK, credentials or fallback loader is added. The record is a preparation for storage integration, not a replacement for the existing storage path or approval of production custody.

## Caller pins and scalar validation

Construct `PsKeyEnvelope` with `manifest`, `configurationId`, `keyId`, `transport` and optional `timeoutMs`. The PS manifest is copied and validated with the unchanged full public-parameter checks. `configurationId` must be 32 bytes in lowercase hex, supplied from the caller's independently pinned public configuration. This library does not derive its meaning or verify a configuration file. Never populate either pin from an incoming encrypted file.

`keyId` is an exact 1–2048-character ASCII reference using letters, digits and `: / . _ -`. A future provider adapter must resolve and check the approved immutable provider/account/key identity; this syntax alone cannot distinguish a mutable alias or establish permissions. The wrapping transport is trusted same-process JavaScript. It necessarily sees the data key and must protect it using the selected provider's reviewed semantics. An arbitrary injected function can return a raw key as an opaque wrapped blob; this library cannot prove external wrapping or enforce that provider's access policy.

`seal(secrets, { signal })` accepts exactly `x`, `yh`, `ys` as canonical nonzero PS scalars. The public manifest derived from them must equal the complete pinned manifest before wrapping begins. Caller objects are copied before asynchronous work. A fresh 32-byte random data key is generated for each seal; successful wrapping is followed by a fresh 12-byte random IV and one AES-256-GCM encryption. Neither keys nor IVs are accepted from the caller or reused deliberately. Uniqueness relies on the runtime CSPRNG; this is not a deterministic uniqueness guarantee or a randomness audit.

`open(wire, { signal })` first checks the record's exact scope and bounded encoding. After unwrap, it authenticates the entire ciphertext, strictly decodes canonical UTF-8 JSON, and repeats the exact scalar and full public-manifest validation. No `decipher.update()` plaintext is returned before `final()` authenticates it. Success returns a new plain object containing the three scalar strings; the caller then possesses plaintext authority and still needs a qualified secret-operation boundary.

## Record encoding

The serialized record is canonical JSON, at most 16384 UTF-8 bytes, with exactly these fields:

| Field | Encoding |
| --- | --- |
| `scope` | Exact public object described below |
| `wrapped_key` | 1–4096 opaque bytes, lowercase hexadecimal |
| `iv` | 12 bytes, lowercase hexadecimal |
| `ciphertext` | 1–512 bytes, lowercase hexadecimal |
| `tag` | 16 bytes, lowercase hexadecimal |

`scope` contains exactly `format: "zft-ps-key-envelope-v1"`, `algorithm: "AES-256-GCM"`, `purpose: "ps-issuer-scalars"`, the full `manifest`, `configuration_id`, and `wrapping_key_id`. Alternate JSON spellings, duplicate/extra/missing fields, wrong scope/version/algorithm/role, invalid hex and oversized fields fail before unwrap. There is no version negotiation, automatic downgrade or plaintext record fallback.

The AEAD additional authenticated data is the UTF-8 canonical JSON of `{ scope, wrapped_key, iv }`. The encrypted plaintext is the canonical JSON of `{ x, yh, ys }`. Thus the record authenticates the public scope, opaque wrapped key and IV along with the ciphertext. Including the public manifest does not make this a public key file: retained ciphertext and wrapping-provider access still require an operator policy.

The implementation uses Node's authenticated-encryption API with an explicit 16-byte tag, sets AAD before encryption/decryption, and waits for final authentication before accepting plaintext. See the primary [Node crypto documentation](https://nodejs.org/docs/latest-v22.x/api/crypto.html#ciphersetaadbuffer-options) for the API contract. Fresh data keys limit each locally generated key to one encryption; larger-volume nonce/key lifecycle and actual provider behavior need separate qualification.

## Injected wrapping transport

The transport receives a frozen request object plus frozen options containing an AbortSignal. This is a local JavaScript contract, not an AWS or network wire format:

| Request field | Value |
| --- | --- |
| `format` | `zft-ps-key-wrap-request-v1` |
| `operation` | `wrap` or `unwrap` |
| `key_id` | Exact configured wrapping-key reference |
| `context` | Canonical JSON of the complete public `scope` |
| `material` | Owned Uint8Array: 32-byte data key for wrap, opaque wrapped bytes for unwrap |

The provider must bind its wrap/unwrap operation to `context`. Future provider-specific context conversion, immutable key resolution, network bounds and access controls are not implemented here. The envelope's own AEAD binding remains required even when the provider promises context checking.

The response is a plain object with exactly `format: "zft-ps-key-wrap-response-v1"`, matching `operation`, matching `key_id`, and `material`. Response material must be an ordinary ArrayBuffer-backed Uint8Array/Buffer: 1–4096 bytes for wrap or exactly 32 bytes for unwrap. Shared memory, strings, wrong metadata and malformed material reject. The adapter copies the selected byte view without invoking a custom iterator before using it. Transport storage is separate from the encryption key retained by the adapter. A transport that mutates and wraps its request's key copy produces an unusable record that fails authentication; it cannot replace the actual encryption key.

Request material is best-effort cleared when the call settles, and owned key/plaintext buffers are cleared on completion/failure. The transport must consume its copy during the operation and cannot rely on it after settlement. Its returned buffers remain its responsibility. Scalar strings, copies made by the provider, crypto/runtime memory, swapped pages and core dumps are not zeroized by this code. Garbage-collected JavaScript and an injected function are not a secure enclave or a zeroization guarantee.

## Lifecycle and failure behavior

Only one wrap or unwrap may be outstanding per instance. Concurrent calls reject with `BUSY`; no queue or automatic retry exists. A monotonic deadline, default 5000 ms and configurable 100–5000 ms, starts at transport request construction and is checked before dispatch, before response use and after encryption/decryption/validation. A timer rejects a nonsettling asynchronous operation. Constructor and input validation precede this deadline. Blocking JavaScript can delay error delivery; late valid results reject after the loop resumes. No CPU, allocation or hard real-time bound is claimed for injected transport code.

Errors contain only `ERR_PS_KEY_ENVELOPE_` plus a fixed code and a fixed message. `CONFIG` rejects constructor pins; `INPUT` rejects caller data before transport; `RESPONSE` rejects metadata, AEAD or decrypted-key validation; `UNAVAILABLE` replaces a synchronous throw or rejected provider promise. No provider message or cause is propagated. `TIMEOUT`, active `CANCELLED`, or `CLOSED` permanently closes the instance, requests transport abort and discards late results. A pre-aborted input never dispatches and leaves an idle instance usable. A later explicit call after `RESPONSE`/`UNAVAILABLE` is permitted, without implying that a future issuer may safely retry an ambiguous transaction.

Abort cannot prove remote work stopped. A replacement adapter does not cancel an old provider request. No issuer identity is generated on an open failure, no decrypted `private.json` is written, and no input file is modified. The library does not read or write files at all; filesystem ownership, atomic publication, synchronization, locks and crash cleanup remain storage-integration work.

## Evidence and remaining work

[Focused tests](../research/ps-lab/local/key-envelope.test.mjs) cover 22 cases: identity/encoding/bounds, fresh key/IV sampling, caller and transport memory separation, denied/malformed/wrong-key responses, authenticated tampering, authenticated but wrong inner scalars, concurrency, deadlines, cancellation and close. A disposable ciphertext file is opened in a new child process using a public test wrapping key; its recovered keys drive the unchanged issuer/client mint and showing path. The showing result remains `walletAuthenticated: false`. The original issuer creates its usual plaintext test databases; this is selected compatibility, not serving-issuer integration or protected session-state evidence.

Eight temporary mutation controls separately remove scope pinning, inner-key validation, authenticated header binding, final authentication, request-memory separation, provider identity, byte bounds or the deadline. Each must fail its named assertion. The full affected suite, preflight and current source/output hashes are recorded in [current evidence](../research/ps-key-envelope-validation.json). All earlier manifests remain historical; no new actual SIGKILL location, hardware durability, provider, browser or phone acceptance is added.

The envelope authenticates bytes and pinned identity, not freshness, authorization or writer exclusion. An old authentic record with the same scope can still reopen. Configuration/key rotation, retention, revocation and rollback policy need external authority and approved procedures; changing configuration IDs alone is not a rollback defense. Wrapping-key retirement must account for retained ciphertext/backups. This record protects only the three long-lived scalars when paired with a genuine wrapping provider; per-session `k`, Ed25519 keys, journals and backups need separate treatment.

Next work remains a qualified PS backend, actual wrapping/status provider integration, durable asynchronous commit/recovery, whole-state protection and hosted operations. Independent C1/C4 and [PS-OWN-01](PS-REVIEW-PACKET.md#open-review-item-former-holder-and-cross-asset-forgery) remain open. No non-exportable custody, constant-time execution, audit, production privacy, independent cryptographic validation, migration, staging or deployment approval follows from this experiment.
