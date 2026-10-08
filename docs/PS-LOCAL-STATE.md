# PS local signed state observations

This local C1/C3 increment adds an issuer-signed report about a PS credential's spent status. The profile was delivered in PR #15; observer recovery, parser qualification, the separate image adapter and encrypted export vault now extend merged PR #18 (`96ed208`) without changing the [local PS credential profile](PS-LOCAL-ENGINE.md), credential stores or frozen reference fixtures. It is an original research protocol named **`zft-ps-local-state-v1`**, implemented in [state.mjs](../research/ps-lab/local/state.mjs). No HTTP listener, wallet endorsement or hosted issuer is implemented. The separate [offline image adapter](PS-IMAGE-ENVELOPE.md) does not change this observation protocol. Public PS fixture keys and plaintext lab databases remain unsuitable for real assets.

A valid signature establishes what the pinned issuer reported at `observed_at`. It does not reserve the credential, prove continuous ownership, prevent issuer equivocation or make the issuer trustworthy. The holder may spend immediately after the observation. Wallet bytes remain proof context, with **`walletAuthenticated:false`**. [Current validation](../research/ps-vault-validation.json) records source hashes and the [roadmap](IMPLEMENTATION.md) retains independent review and integration gates.

## Run locally

```sh
pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
pnpm --dir research/ps-lab --ignore-workspace test:local
node research/ps-lab/local/check-controls.mjs
pnpm --dir research/ps-lab --ignore-workspace demo:state
```

The demo generates a separate Ed25519 key in memory, creates disposable issuer/client/observer databases and issues a test credential. It checks an unspent report, replaces the credential, then checks a spent report for the original credential. Reusing either accepted response is rejected. Only outcomes are printed and temporary stores are removed. ZVM and other network services are not used.

## Keys, scope and encoding

The caller pins both the complete `zft-ps-local-v1` PS manifest and the separate state manifest out of band. No received proof or receipt can replace them. There is no automatic key discovery, rotation, retirement or trust-distribution protocol. The state signing key is an Ed25519 private `KeyObject` supplied to `StateIssuer`; the constructor checks that its public key exactly matches the pinned manifest. The wrapper does not persist the key.

Let `J(x)` be the local PS canonical JSON encoding, `U(x)` its UTF-8 bytes and `H(x)` SHA-256 bytes rendered as lowercase hex. Define:

```text
F(purpose, x) = U("ZFT_PS_Local_State_v1/" || purpose || "\0" || J(x))
```

Here `\0` denotes one zero byte, not two printable characters. Canonical JSON has lexically sorted object keys, JavaScript JSON string escaping, exact field sets, no arrays, and only nonnegative safe integer numbers other than negative zero. Parsing requires byte-for-byte reserialization equality; duplicate keys, whitespace and alternate encodings reject. The inherited depth limit is less than eight at every value. All byte encodings are lowercase hex without a prefix.

The state manifest is exactly:

| Field | Required value |
| --- | --- |
| `protocol` | `zft-ps-local-state-v1` |
| `realm`, `keyset_id` | Exact values from the pinned PS manifest |
| `ps_manifest_hash` | `H(U(J(full_PS_manifest)))` |
| `algorithm` | `Ed25519` |
| `public_key` | 32-byte canonical compressed Ed25519 public key |
| `status_key_id` | `H(F("key", public_key))` |

In the key-ID expression, `public_key` is a JSON string, including its JSON quotes within `J`. The manifest is bounded to 2,048 UTF-8 bytes. Key decoding requires canonical encoding, a torsion-free point and rejection of small-order points. This stricter key policy is a lab choice. Node imports the raw key with canonical SPKI prefix `302a300506032b6570032100`.

Receipts use pure Ed25519 over the framed message, with `crypto.sign(null, ...)` and `crypto.verify(null, ...)`, as specified for Ed25519 by [Node 22.12 crypto](https://nodejs.org/download/release/v22.12.0/docs/api/crypto.html#cryptosignalgorithm-data-key-callback). They do not use Ed25519ph or sign only an unframed digest. PS credential signing and its BLS12-381 keys remain separate.

## Challenge, proof and receipt

`StateObserver.prepare(wallet, h, audience)` durably saves a fresh challenge before returning its context. `audience` is a caller-pinned 32-byte opaque application/context identifier, not a URL or proof of browser origin. `wallet` is 20 bytes and `h` is the expected canonical PS asset scalar. The observer stores public proofs and observations in a separate database bound permanently to both manifests and the `state-observer` role; it stores no credential owner secret.

The context has exactly these fields:

```text
protocol realm keyset_id ps_manifest_hash status_key_id purpose
 audience challenge wallet h created_at expires_at min_sequence
```

`purpose` is `credential-state`; `challenge` is 32 random bytes. Time values are nonnegative safe integer seconds. `expires_at = created_at + 60`; `min_sequence` is the observer's highest accepted issuer operation sequence. The protocol has no clock-skew allowance: freshness requires `created_at <= now < expires_at`. These strict clock and lifetime settings are local policies requiring review before deployment.

The holder builds the existing PS showing with nonce `H(F("show", context))`, expected wallet and expected h. This binds every observation context field through the unchanged PS showing transcript. The request consists of all context fields plus `showing`, which is the exact canonical PS showing string. `StateObserver.request` verifies the proof and saves the exact request before submission. Retrying must reuse the same bytes; substituting another randomized proof for that challenge rejects.

`StateIssuer.observe` verifies the request, expected scope and PS proof, then starts a [BEGIN IMMEDIATE transaction](https://www.sqlite.org/lang_transaction.html). It rechecks time and reads the spent-nullifier row and maximum committed operation sequence from one serialized snapshot. A sequence below the request's `min_sequence` rejects. It makes no registry mutation and remains available during local mint suspension. After the snapshot transaction, it signs a body containing every context field plus:

| Field | Meaning |
| --- | --- |
| `request_hash` | SHA-256 of the exact UTF-8 request string |
| `showing_hash` | SHA-256 of the exact UTF-8 showing string |
| `nullifier` | Nullifier obtained by verifying that showing |
| `state` | Exactly `spent` or `unspent` from the snapshot |
| `sequence` | Maximum committed issuer operation sequence, or zero for an empty operation journal |
| `observed_at` | Issuer clock sampled inside the snapshot transaction |

The wire receipt is exactly `J({body, signature})`, with a 64-byte signature over `F("receipt", body)`. Requests and receipts are each limited to 8,192 UTF-8 bytes. The receipt identifies a particular proof and context; a correct signature on a different challenge, audience, asset, wallet or request is rejected.

## Acceptance and persistence

`StateObserver.accept` first requires a saved, unconsumed request. It independently re-verifies the saved PS showing, verifies the pinned Ed25519 signature, compares every context field, request/showing digest and nullifier, and validates state, sequence and observation time. Inside one database transaction it rechecks the pending request, consumption, clock and expiry. `observed_at` must be within the challenge interval and no later than the observer's current time. The sequence must be at least both the saved challenge floor and the highest sequence accepted since preparation.

That transaction updates the remembered sequence/time, consumes the challenge and stores the exact receipt together. Concurrent acceptors cannot both succeed. A kill before commit rolls back all three changes; a kill after commit leaves the receipt and consumed challenge durable. A lost return after commit does not make the challenge reusable: callers can inspect the retained receipt as historical evidence and prepare a fresh challenge for a new observation.

Successful acceptance returns `issuerReported`, `observedAt`, `expiresAt`, `sequence`, `proofValid:true` and `walletAuthenticated:false`. A malformed receipt, invalid signature, unavailable/closed issuer or expired challenge produces an error, never a fabricated unspent result. The saved request is retained. At most 100 unconsumed, unexpired challenges can be active; consumed/expired entries do not occupy that quota. Historical rows are retained without a total retention limit.

## Freshness and trust limits

The 60-second interval bounds acceptance age; it does not prevent a spend after `observed_at`. A regression deliberately accepts a previously signed unspent observation after a subsequent spend within that interval, then obtains a spent observation using a new challenge. Applications must describe the timestamped issuer report accurately. Spending still requires the issuer's atomic claim path.

The persisted sequence detects a response or rolled-back issuer snapshot below a sequence that this observer already accepted. It provides no global consistency proof. A new observer with no remembered sequence can accept an older registry snapshot, as an explicit test demonstrates. A fork at the same or a higher sequence, a dishonest issuer, restoration of an old observer database, manipulated clocks or replacement of pinned trust are outside this guarantee. The observer also rejects local clock readings below its greatest persisted sampled time, but this is not a secure time source. The increment does not halt the issuer after restore or implement rollback-resistant checkpoints.

State signatures neither hide the showing's public asset attribute/nullifier nor authenticate the wallet. Showing reuse is linkable. The demo's random Ed25519 key does not make public-key PS fixtures safe for real assets. Secret PS BigInt operations remain unqualified for production side channels. Storage faults, retention, key lifecycle, trusted distribution, real devices and hosted availability still need separate qualification.

## Validation

The combined local suite contains **148 tests**: 47 credential/recovery cases, 29 original observation cases, 12 observer recovery regressions, 13 parser cases, 25 image cases and 22 vault cases. The original observation slice added two actual SIGKILL boundaries and a two-process acceptance race; the recovery slice below adds five more locations, for 21 process-kill locations overall. Tests cover separate-key and full-manifest pinning, wrong and weak keys, signature mutation/noncanonical signatures, every context field, bounded canonical parsing, durable exact retries, replay after restart, expiry and clock rollback, sequence ordering, an actual older issuer database snapshot, outage errors and historical observation semantics.

The [RFC 8032 section 7.1 first Ed25519 vector](https://www.rfc-editor.org/rfc/rfc8032.html#section-7.1) checks Node's exact public key and empty-message signature, with noble verification as well. Noble also verifies the exact framed bytes of a generated local receipt. These checks validate primitive/backend agreement; the new protocol composition and tests share an author and are not independent transcript review or external protocol vectors.

Thirty-five temporary mutation controls must fail their named regressions. The six original observation controls remove signature validation, omit audience from the showing challenge, leave accepted challenges reusable, permit older sequences, split acceptance writes across commits, or skip freshness. The prior eight credential/recovery controls remain intact, with three further observer recovery controls below, four [parser controls](PS-LOCAL-ENGINE.md#parser-boundary-qualification), seven [image controls](PS-IMAGE-ENVELOPE.md#evidence-and-remaining-work) and seven [vault controls](PS-LOCAL-VAULT.md#run-and-evidence). Source files are not mutated. The reference lab retains 43 tests, three controls and exact unchanged Python fixture reproduction. C1/C3 remain partial; independent C4 review and C5/C6 wallet/file/vault/hosting work remain open.

The [bounded parser corpus](PS-LOCAL-ENGINE.md#parser-boundary-qualification) includes 66 malformed state-request variants and 47 malformed receipt variants. Rejection must preserve issuer/client rows and the observer's exact challenge, saved request, consumption and clock rows. Valid observation/acceptance succeeds afterward. These are selected same-author schema/encoding cases; they do not qualify all hostile inputs or supply independent protocol review.

## Observer recovery qualification

The [observer recovery suite](../research/ps-lab/local/state-recovery.test.mjs) adds 12 tests after PR #15. Five new callback locations permit actual process kills; the callbacks do nothing by default and do not change transaction ordering or protocol bytes. On reopening, tests inspect both the challenge rows and sequence/time memory, then retry the exact saved request or receipt.

| Process interruption | Required persisted result |
| --- | --- |
| After challenge insert, before time update/commit | Neither new challenge nor time change survives. |
| After challenge commit, before return | The entire unconsumed challenge/context and sampled time survive, even though the caller received no return. A showing can be built for that saved context. |
| After exact request write, before time update/commit | Original challenge remains unbound; acceptance rejects an unsaved request. |
| After request commit, before return | Exact wire bytes and sampled time survive. Exact retry succeeds; a different randomized proof cannot replace the bound request. |
| After receipt/consumption write, before commit | Original pending request, sequence and sampled time survive; the exact receipt remains retryable. |

Six storage cases produce real SQLite error results within disposable databases:

- Three bounded `SQLITE_FULL` cases target the preparation time update, request time update and receipt/consumption write. The existing helper was moved unchanged into [fault-support.mjs](../research/ps-lab/local/fault-support.mjs). A named trigger ABORT proves the selected statement is reached before a temporary trigger allocates less than 2 MiB under a page limit. Earlier writes roll back together; reopening and retrying after removing the fault succeeds.
- `PRAGMA query_only` makes acceptance return `SQLITE_READONLY` with the saved request and replay memory intact. This is not a filesystem permission test.
- A separate writer connection makes acceptance return `SQLITE_BUSY` at transaction entry. A separate reader connection makes COMMIT return `SQLITE_BUSY` after the receipt and replay writes have all executed. Explicit rollback leaves the request retryable; releasing the lock and retrying succeeds. Test connections use a one-millisecond timeout instead of the ordinary five seconds.

The remaining regression retries after a persistence fault at the original challenge deadline. Neither retry nor issuer observation extends that deadline; the old request remains saved and unconsumed, and a new challenge is required. Successful retries check exact receipt retention, one-use acceptance, unchanged issuer operation count and SQLite integrity.

Three additional mutations commit the challenge before the preparation time update, commit the request before its time update, or omit explicit rollback after a failed COMMIT. Each must fail its named recovery assertion in a temporary copy. The tests confirm the existing transaction design; no transaction correction was required. [PR #15 evidence](../research/ps-state-validation.json) remains historical; [historical PR #16 evidence](../research/ps-observer-recovery-validation.json) records these tests and their source hashes. The current vault manifest is linked above.

These cases do not qualify power loss, real host-disk exhaustion, journal/fsync failure, arbitrary I/O errors, database corruption, malicious restore, every constructor/write boundary or browser/phone behavior. Sequence memory still cannot protect a fresh observer, a rolled-back observer store or same/higher-sequence issuer forks. C3 remains partial, and independent review, key lifecycle, retention/availability and integration remain open.
