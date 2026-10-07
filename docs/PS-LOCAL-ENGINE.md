# PS local issuer and client stores

This is the isolated C2 research engine and a targeted C3 recovery harness, on the PR #12 baseline `9f85c11`. It runs locally without ZVM, an HTTP server, a wallet, Cloudflare or a reference mint. The demo uses deliberately public issuer test keys. **Do not issue real assets with it.** The [roadmap](IMPLEMENTATION.md) keeps independent C1/C4 review and product/hosting C5/C6 acceptance open.

[Source and validation evidence](../research/ps-local-engine-validation.json) records the tested implementation. The [frozen reference profile](PS-CRYPTOGRAPHIC-PROFILE.md), its Python generator, JavaScript verifier and deterministic vectors remain unchanged. The profile below is a separate, original `zft-ps-local-v1` experiment, with different asset attributes and proof contexts. It does not claim reference wire compatibility or independent cryptographic validation.

## Run locally

Use Node 22.12+, including its experimental SQLite flag, and the lab's existing isolated lock:

```sh
pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
pnpm --dir research/ps-lab --ignore-workspace test:local
node research/ps-lab/local/check-controls.mjs
pnpm --dir research/ps-lab --ignore-workspace demo:local
```

The demo creates an issuer, Alice, Bob and a recovery client in a private temporary directory. Alice issues and exports a local bearer envelope; Bob claims it; the issuer commits while the response is discarded. The recovery client restores Bob's saved snapshot, retrieves and verifies the original result, then cancels to another fresh secret. Old copies fail to spend. A final public showing is checked against the local spent registry. Only outcomes are printed; temporary stores are removed. The tests exercise separate processes and actual SIGKILL boundaries as well as in-process validation.

## Versioned local profile

The [implementation](../research/ps-lab/local/profile.mjs) uses the reference BLS12-381 generators, canonical compressed points, subgroup checks, keyset encoding, scalar encoding, generic linear/DLEQ proofs and PS equations. Public parameters are `X2=xG2`, `Yh2=yhG2`, `Ys2=ysG2`, `Yh1=yhG1`; the additional cross-group parameter consistency check remains lab policy. Signing and proving are original lab behavior, not inspected reference-server code.

A caller pins the complete manifest `{protocol, realm, keyset_id, public_key}` out of band. `protocol` is exactly `zft-ps-local-v1`; realm is 32 bytes; the 33-byte keyset ID is recomputed from the 336-byte public parameters. Files cannot replace the configured manifest. Each database is permanently bound to its exact manifest and issuer/client role. There is one keyset per local issuer store; rotation or retirement is not implemented.

Let `J` mean UTF-8 canonical JSON below, `F` the reference two-byte big-endian length prefix, `H` SHA-256 interpreted as a big-endian integer, and `I32` canonical 32-byte big-endian scalar encoding. Define the credential's asset attribute as:

```text
scope = J({protocol, realm, keyset_id})
reference_h = reference_hashAsset(raw_asset_bytes)
h = H(UTF8("ZFT_PS_Local_v1/asset") || F(scope) || reference_h) mod q
```

Here `reference_h` is already a 32-byte scalar encoding. This second hash makes the signed attribute specific to the local protocol, realm and keyset. Binding only the envelope and proof transcript would allow a bearer holder to relabel a credential if two realms reused the same issuer key. A regression rejects both relabeling and replacing h without a matching signature. The reduced h is not a public blob-storage identifier. Assets are arbitrary nonempty raw bytes up to 65,536 bytes: the frozen ZFT PNG normalizer and production JPEG/file adapters are intentionally outside this slice.

Owner secrets, session signing scalars, proof nonces and blinding scalars use OS cryptographic randomness with rejection sampling in `1..q-1`. IDs and recovery capabilities use random bytes. These BigInt/group secret operations are not qualified for production side channels, browser entropy or key erasure. Tests and the demo intentionally use the public fixture issuer keys; a random destination secret does not make those credentials secure assets.

### Canonical transport and limits

Every wire artifact is one compact canonical JSON object. Keys sort lexically; values are plain objects, strings, booleans, null or nonnegative safe integers other than negative zero. Arrays are unsupported. Strings use JavaScript `JSON.stringify` escaping. Parsing requires byte-for-byte equality with reserialization, so duplicate keys, whitespace and alternate encodings reject. Depth must be less than eight at every value. Exact schemas reject missing or extra fields. All encoded cryptographic bytes use lowercase hex with no prefix. Scalar, point and proof checks use the frozen reference parser; noncanonical or non-subgroup points reject.

| Artifact | Exact top-level fields | Maximum UTF-8 bytes |
| --- | --- | --- |
| Manifest | `protocol realm keyset_id public_key` | 12,288 |
| Session | `protocol realm keyset_id kind session expires u` | 12,288 when serialized |
| Issue request | session fields plus `recovery_hash b s asset_tag proof` | 12,288 |
| Swap request | session fields plus `recovery_hash b s presentation owner_proof proof` | 12,288 |
| Response | `protocol realm keyset_id digest u v` | 12,288 |
| Showing | `protocol realm keyset_id purpose wallet nonce h u v t n proof` | 12,288 |
| Bearer envelope | manifest fields plus `type asset credential` | 140,000 |
| Pending snapshot | manifest fields plus `type wire asset h secret t capability source` | 300,000 |

A credential has exactly `keyset_id u v h s`. Points in G1/G2 are 48/96 bytes; scalars and request digests are 32 bytes. Session IDs are 16 bytes, capabilities 32 bytes, wallets 20 bytes and showing challenges 32 bytes. `kind` is `issue` or `swap`; `type` is `bearer` or `pending` as applicable. These are local string/object interfaces, not final HTTP schemas. Session objects are generated by the local issuer and validated before use; no public object-transport endpoint is exposed.

### Issuance and swap transcripts

The issuer saves a fresh session scalar k and returns `u=kG1` with a five-minute expiry. At most 100 unexpired, unused sessions may coexist. The client prepares and durably saves the request and recovery material before submission. Requests include `recovery_hash=SHA256(raw_capability)`.

For every request, remove `proof` and `owner_proof`. For swaps, truncate `presentation` to its first 321 bytes, removing the source owner proof. The canonical JSON of the remaining request is the **context for every proof in that request**. It binds protocol, realm, keyset, purpose, session ID, expiry, issuer base, destination commitment, asset commitment, recovery hash, and all public source-presentation fields. The proof transcripts themselves retain the reference framing, equation ordering and scalar challenge reduction.

Issuance uses `D=hG_A`, `B=hYh1`, `S=sG1`. Prove the three reference committed-v3 equations with witnesses `[h,s]` and label `ZFT_PS_Local_v1/issue`. The proof is 96 bytes. The derived local response is `v=k(xG1+B+ysS)`.

A swap randomizes the old signature to `(U,V)`, with `T=sU`, `N=sG_N`, then hides h with `K=hYh2+oG2` and `V_hidden=V+oU`. Its destination has fresh nonzero `s_new`, `S_new=s_newG1`, and `B_new=hU_new+tG1`. The wire presentation is:

```text
keyset_id || P(U) || P(V_hidden) || P(K) || P(T) || P(N) || source_owner_proof
```

It is exactly 385 bytes. Source DLEQ uses bases `[G_N,U]`, statements `[N,T]`, label `ZFT_PS_Local_v1/spend`. Destination DLEQ uses `[G1]`, `[S_new]`, label `ZFT_PS_Local_v1/destination`; both proofs are 64 bytes. The 128-byte asset-equality proof uses `[h,o,t]`, the reference K/B equations and label `ZFT_PS_Local_v1/asset-equality`. Verify all three proofs and `e(V_hidden,G2)=e(U,X2+K)e(T,Ys2)` before registry mutation.

The response is `v_blind=xU_new+yhB_new+k_new ys S_new`. The client checks the exact request digest, issuer manifest and session base, unblinds `v_new=v_blind-tYh1`, then verifies the credential for its expected h and `s_new`. Cancellation is an ordinary swap to the holder's own fresh secret; it races other holders of the same copied bearer under the same rules.

### Public showing

The showing JSON binds the full public statement, excluding only its proof, under `ZFT_PS_Local_v1/show`. It uses the randomized signature and reference owner DLEQ, with expected wallet bytes, nonce and scoped h supplied by the verifier. A caller must provide a fresh challenge and manage challenge acceptance; the lab does not maintain a wallet authentication or nonce-issuance service.

`verifyShowing` proves credential possession for that context. `Issuer.checkShowing` additionally queries its local registry after verification and reports `spent` or `unspent`. It always reports `walletAuthenticated:false`: entering wallet bytes does not prove control of that wallet. This local call has no signed status receipt, durable publication or unavailable-network state. Production authenticated observations and wallet endorsements remain C1/C5 work. Public showings expose h and N and are linkable when repeated; they are not bearer files and contain no owner secret.

## Atomic registry and recovery

The [issuer](../research/ps-lab/local/issuer.mjs) stores sessions, unique asset tags, spent nullifiers and operation responses in a dedicated SQLite file. [BEGIN IMMEDIATE](https://www.sqlite.org/lang_transaction.html) serializes writers. A transaction rechecks suspension, session expiry, exact session fields, session consumption and registry uniqueness. It atomically writes the asset reservation or source spend together with a unique request digest, session, recovery hash and exact response. The response is read from the committed row before being returned. No signature response is exposed before commit.

Repeated identical requests return the same stored bytes, even after expiry or admission suspension. A changed request cannot reuse a consumed session. Recovery requires the original request digest and 32-byte capability; a wrong capability rejects and an unknown digest returns no result, without issuing anything. There is no recovery TTL or pruning. A retrieval capability alone cannot reconstruct a credential without the destination secret and, for swaps, t.

Each [client](../research/ps-lab/local/client.mjs) uses its own SQLite file. The pending snapshot saves the exact request, asset, h, fresh secret, capability, t and source credential. Submission and acceptance require acknowledgment of the exact snapshot hash. Restoring an independently supplied matching snapshot also acknowledges it. This is a local API gate, not proof of safe external backup storage or an enforcement mechanism against arbitrary callers of the issuer API.

The client verifies before committing its new credential, completed operation and locally known source-spent flag in one transaction. It retains pending/source recovery material after success as well as uncertain outcomes; no erasure or pruning policy is claimed. An invalid response does not discard the journal. If an operation is unknown, preserve the existing request and retry/reconcile rather than generate a new destination. An exported old file or a different client store may remain locally unaware of a remote spend; only the authoritative issuer registry decides which claim wins.

Stores use rollback journals, `synchronous=FULL`, foreign keys and a five-second busy timeout. Files are created with mode 0600, reject broader group/other access or a nonregular file, and are used inside a private temporary directory in the harness. They are **plaintext bearer and issuer-session storage**, not browser vaults. The private directory and trusted local process environment are assumptions; this is not hardened against malicious filesystem replacement, database tampering or registry rollback. Never point the lab at application data.

## Validation and remaining gates

Twenty-eight local tests cover the full lifecycle; capability, realm, session, purpose, wallet, asset and destination binding; canonical input limits; duplicate issuance; exact retries; suspension/expiry; backup and restore; bad responses; real multiprocess claim/issuance races; and three actual process-kill locations:

- After the spend write but before the operation response write/commit: restart has neither spend nor response, and the saved request can complete.
- After issuer commit but before reply: restart recovers the exact committed result.
- After client verification/unblinding but before its transaction: restart completes from the saved pending snapshot.

Four controls mutate temporary copies, then require the corresponding named test to fail with an assertion: omit recovery hash from proof context, accept duplicate nullifiers, commit a spend before saving the response, and omit scope from the signed asset attribute. Copies use paths containing spaces, Unicode and `#`; the original modules remain intact. The realm regression also failed on the earlier unscoped implementation with “Missing expected exception.”

The reference lab separately retains 43 passing tests, exact Python fixture reproduction, inventory checks and three broken-verifier controls. None supplies an independent oracle for this new local profile. [SQLite's atomic commit model](https://www.sqlite.org/atomiccommit.html) depends on filesystem/hardware behavior; SIGKILL tests are not power-loss, disk-full, corruption, backup-rollback or all-boundary qualification. Recovery into a third local store is not phone/browser cross-device acceptance.

C2 is complete for this local harness. C3 remains partial: additional client transaction interruption, storage faults, retention/availability policy and real device recovery remain. C1 still needs independent equations/transcripts/vectors, reviewed entropy/backend decisions, complete malformed-input policies, trusted manifest distribution, signed state observations and key rotation. C4 independent review is required before a hosted experiment. Admission abuse, key custody, operator compromise, censorship, equivocation, quotas and Cloudflare storage/CPU qualification remain open. C5 must decide custody and implement wallet endorsement, image/file/vault adapters and UI before any integration. C6 requires separately approved hosted resources and incident recovery.

The deployed ERC-721 app, root dependencies, Worker bindings, contract, data, v1 files, branding and historical OG snapshots are unchanged. No issuer is deployed and no collectible is migrated. The ZVM maintenance outage does not block these local checks; chain integration and live devnet acceptance must wait for the endpoint to return.
