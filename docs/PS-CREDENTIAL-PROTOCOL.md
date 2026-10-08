# ZFT PS credential protocol proposal

Design for review · October 6, 2026 · baseline `f0a4065` after PR #10.

ZFT should prototype Pointcheval–Sanders (PS) credentials on BLS12-381 to address the requested cryptographic parity with NonFungible Cash. The proposed prototype uses an off-chain issuer and an authoritative spent-credential registry. MetaMask remains the public profile identity. ZVM continues to secure the existing ERC-721 alpha; it does not become the authority for the prototype's PS credentials.

This is an architecture and acceptance specification, not a deployed protocol or an approved cryptographic implementation. The byte-level profile, licensed implementation sources and independent review in C1–C2 below are required before integration. The current app, contract, files, data and historical OG snapshots remain usable under their existing rules. [The roadmap](IMPLEMENTATION.md) tracks both systems without treating ERC-721 tests as evidence for PS security.

## Decision for review

Recommend **option A for a local, isolated prototype**. This prioritizes the requested credential construction and exposes its custody and issuer assumptions before any product migration.

| Option | Ownership authority | MetaMask and ZVM consequence | Disposition |
| --- | --- | --- | --- |
| A. PS mint and spent registry | PS credential plus owner secret; mint reserves the asset tag, and swaps atomically consume source nullifiers | MetaMask authenticates profiles. PS items are managed in ZFT, not ordinary NFTs in MetaMask's inventory. No new contract is required. | Proposed prototype |
| B. Existing ERC-721 | ZVM contract owner and nonce | Ordinary wallet custody, public transfers, independent transaction submission | Preserve the deployed alpha; does not satisfy PS parity |
| C. PS plus an ERC-721 wrapper or on-chain spend registry | A separately designed bridge or coordinated authority | Could add wallet-visible representations, but locking, duplicate issuance, failures and privacy need a new protocol | Deferred; no automatic wrapping |
| D. ZK notes enforced by ZVM | Contract verifies a different proof/spend system | Can pursue on-chain private state, but PS credentials alone do not supply this construction | Separate research, not reference parity |

Approving a design PR records the direction; it does not approve an issuer deployment, erase old collectibles or promote the apex site. On October 8, 2026, the user confirmed that PS ZFTs do not need to appear in MetaMask yet. Continue with ZFT-managed PS credentials and MetaMask profile identity; ordinary MetaMask NFT inventory is not an initial integration requirement. This resolves that presentation tradeoff, while independent review and hosted issuer approval remain separate gates. A possible MetaMask Snap for viewing ZFTs is deferred until the core experience is complete; it is not a wrapper or a custody migration.

## Deferred MetaMask Snap

After the core ZFT experience and release qualification, investigate a display-first Snap that shows a user’s ZFT collection inside MetaMask. The [official Snaps documentation](https://docs.metamask.io/snaps/) supports a dedicated Snap home page and [custom UI](https://docs.metamask.io/snaps/features/custom-ui/). That makes a custom ZFT view plausible; it is not evidence that PS credentials can appear in the standard NFT inventory. Verify artwork support, target extension/mobile availability, permissions, data provenance and review/distribution requirements at implementation time. Start with public artwork and verified, timestamped status; do not move bearer secrets into a Snap by implication. Any later signing, custody or recovery role requires a separate design and review. No Snap dependency or implementation is part of the local browser increment.

## Reference baseline and parity boundary

The [reference technical page](https://nonfungible.cash/how-it-works?view=cryptography) describes PS signatures, owner-secret nullifiers, randomized showings and private transfer. Its currently served wallet selects **committed issuance version 3**, while its PS module also exports older blind-issuance variants. The current transfer path calls `blindTransfer`; the help page still illustrates the older session-base issuance construction. Server behavior has not been independently verified.

[Snapshot evidence](../research/ps-reference-2026-10-06.json) records the current HTML → app → wallet → PS import chain, hashes and inspected call sites. Pin that profile during C1 rather than silently following a changing website. The PS paper supplies the signature primitive, not a security proof for this entire website protocol. [Pointcheval and Sanders](https://eprint.iacr.org/2015/525).

| Layer | Proposed parity or intentional difference |
| --- | --- |
| Credential mathematics | Same PS family on BLS12-381, two attributes, randomizable signatures, owner-secret proofs and nullifier spending; exact transcripts require C1 vectors |
| Issuance and transfer | Compare current committed-issuance v3 and blind-transfer behavior separately; an exported older helper is not evidence of the active path |
| Image identity | PS asset scalar over explicit canonical bytes; retain ZFT's frozen PNG normalizer, so arbitrary source-image normalization is not reference-byte-compatible |
| Profile identity | Keep ZFT wallet-address profiles and wallet signatures; reference profile signatures are a different layer, not PS ownership authority |
| Secret storage and recovery | ZFT retains session-only or optional password-protected storage and acknowledged recovery; a wallet signature is not a credential backup |
| Transport | New ZFT protocol discriminator and issuer namespace; no Cashu payment-token or cross-mint interoperability claim |

“Same cryptography” requires a named version, matching mathematical relations and independently checked test vectors. It does not mean the same mint, signature keys, metadata format, wallet adapter, anonymity guarantees or compatibility with ordinary Cashu wallets.

## Credential and proof requirements

For notation, let `G1` and `G2` be prime-order BLS12-381 groups, `q` their scalar order, and `e` the pairing. Let `h` identify the normalized asset and let the holder alone retain nonzero scalar `s`. An issuer has secret scalars `x, y_h, y_s` and the corresponding public parameters. A PS credential has two `G1` points:

```text
credential = (issuer, keyset, h, s, u, v)
v = (x + y_h*h + y_s*s) * u
e(v, G2) = e(u, X2 + h*Yh2 + s*Ys2)
```

These equations describe the credential, not a complete issuance or proof transcript. Verification rejects infinity credentials, invalid encodings, points outside the prime-order subgroup, invalid scalars and unknown parameters before pairings. A boolean pairing result on malformed or degenerate inputs is insufficient.

The prototype must implement these separate operations:

- **Committed issuance:** prove knowledge and consistency of the asset and fresh owner commitments under the pinned current issuance profile. Never send `s`. Verify the returned credential locally before considering minting complete. Older blind issuance also needs saved unblinding material; do not silently fall back between versions.
- **Showing:** randomize the signature and prove possession without exporting `s`. Bind the presentation to its purpose, exact asset, issuer/keyset and public-profile context. Sign the complete public statement with the selected wallet separately. Replaying it on another profile, origin, purpose or issuer must fail.
- **Private transfer:** prove knowledge of a valid unspent credential, equality of its hidden asset with the new issuance commitment, and knowledge of the new owner secret. Bind the new owner commitment, issuance session/base and every dependent commitment into the reviewed transcript. Merely verifying an old showing is not transfer authorization.
- **Nullifier:** derive `N = s * G_null` using the pinned domain-separated base. A new custody epoch uses an independent nonzero `s_new`, hence a new nullifier. Spend state is keyed by issuer realm, source keyset and canonical nullifier; it is never inferred from a profile row.

C1 must freeze field order, framing, scalar endianness, compressed point encoding, keyset derivation, generators, hash-to-field/hash-to-curve suites, domain labels, Fiat–Shamir challenge inputs, proof lengths and all verification equations. Use [RFC 9380](https://www.rfc-editor.org/rfc/rfc9380) suites where the selected profile specifies them. Changing a domain, encoding or profile binding creates a versioned difference that needs new vectors and review. Do not improvise a transcript from these high-level equations.

Validate issuer public parameters as well as credential points, including required nonzero parameters and consistency of the same coefficient represented in both groups. Select a backend suitable for secret-scalar operations; public-verification benchmarks and an audit of a curve library do not establish side-channel safety of a new signing/proof implementation.

Use fresh cryptographic randomness for owner secrets, proof nonces and blinding. Deterministic public fixtures are test-only. A repeated proof nonce can reveal a witness. ZFT proposes fresh per-operation secrets rather than relying on the reference's seed/counter recovery scheme; the corresponding recovery requirements are explicit below.

## Issuer identity and trust

A release-pinned manifest identifies the protocol profile, issuer realm, allowed HTTPS endpoints, keyset digest, full public parameters and status-signing key. Keyset IDs must be recomputed from the specified parameter encoding. Files cannot nominate arbitrary RPCs, mints, keys or URLs. Reject a changed manifest/keyset until the user follows an explicit reviewed migration; a server response cannot approve its own replacement identity.

The first prototype has one issuance keyset and no cross-keyset transfers. New issuance can be disabled independently of validation and response recovery. Retiring a keyset must not discard its spent set or committed responses. Key compromise requires an incident and explicit reissuance design; rotating a key does not repair forged credentials or prove which copy is legitimate.

The mint can censor requests, lie about spent state, roll back its database or issue conflicting credentials. It need not know an existing holder's `s` to undermine uniqueness by issuing another credential for the asset. There is no autonomous contract exit in option A. A valid signature is not a proof of issuer honesty or availability.

Malicious application JavaScript can steal unlocked credentials. Public artwork, wallet authentication, IP addresses, timing, deterministic duplicate tags, reused nullifiers and optional profile publication can reveal or link activity. A randomized showing does not make the surrounding website anonymous. In particular, the same credential's nullifier links its repeated showings; candidate artwork can be tested against a deterministic asset tag. No stronger privacy claim may ship without a scoped analysis.

## Wallet identity and credential custody

Keep `/p/:walletAddress`, explicit MetaMask connection, account/network invalidation, profile editing, follows and likes. Ordinary wallet signing authenticates these actions; it does not produce PS credentials. [MetaMask's signing interface](https://docs.metamask.io/metamask-connect/evm/guides/sign-data/) remains separate from the new credential engine.

Do not request a wallet private key, derive a PS secret or vault root from a public wallet signature, or assume identical signatures across devices. No Snap, seed extraction or wallet encryption extension is required for the prototype. Generate the PS secrets in the browser. A wallet seed alone cannot restore them.

The proposed PS flow requires connected identity for new mint admission and public-profile actions, while possession of the bearer file authorizes claiming it. Do not require recipient wallet identity inside the cryptographic transfer statement just to associate a private claim with an account. Publishing the received holding is a separate signed opt-in action. The local lab may omit wallet admission entirely; it must label that difference from the product.

The interface should distinguish **wallet identity**, **ZVM token holdings**, and **PS credentials** by protocol labels, without restoring the retired wallet/local-profile selector. “Return to MetaMask” is unavailable for PS items until a wrapper is independently designed. “Cancel exported copies” means a credential swap to a fresh local secret. The issuer and the need for a credential recovery download must appear before the first PS mint.

## Mint claim and cancellation flows

### Mint

1. Normalize the image using the pinned ZFT codec. Compute the PS asset scalar and a separate full image digest. Display a local preview. Do not use the reduced scalar alone as the public blob storage key.
2. Pin issuer/parameters and obtain a bounded issuance session. Generate `s`, the request proof and any required blinding material. Store the entire pending operation and acknowledge a recovery snapshot before submission.
3. Submit the exact saved request. The issuer verifies it and atomically reserves the deterministic duplicate tag, consumes the session/admission and stores the complete credential response.
4. Recover the same response after a lost connection. Verify the credential, the asset binding and issuer identity locally. Save the completed credential before deleting pending recovery material. Publication and sanitized artwork upload remain distinct operations.

Duplicate detection is issuer-scoped byte identity. Stable duplicate tags must not reset when an issuance keyset changes. New code must not imply global pixel uniqueness or copyright. A malicious issuer can bypass its own duplicate policy.

### Export and claim

Export the credential and its current `s` in a versioned bearer envelope within the normalized image. Sending it is not a completed transfer; sender and recipients retain competing authority until redemption. No server upload is needed to export.

On import, parse with fixed size limits, remove exactly one recognized envelope, verify image identity, pin the issuer and verify the credential locally. Preserve the original file. An unspent response is an observation, not a reservation. Prepare a fresh destination secret and the full proof-bound request; persist and back it up before spending. The issuer performs the atomic transition below. Only a verified, saved replacement credential completes the client claim.

A copied request cannot redirect the response to another owner secret. A party possessing the whole original credential can create a competing valid request: that is bearer authority. Exactly one request may consume the old nullifier; identical retries recover the winning response. Local browser locks supplement, but never replace, issuer serialization.

### Cancel and recover

Cancel is the same transition as claim, directed to a new locally controlled secret. It races fairly with a recipient; there is no sender privilege and no “unspend.” The old artwork remains viewable, but old bearer authority and old public-current-holding status become stale.

Recovery must include issuer manifest/version, asset bytes or their separately preserved source, current credentials and every unresolved operation: destination secret, session/base, blinding scalars when applicable, exact serialized proof/request, request digest and response-retrieval capability. Backing up only `s_new` cannot recover a lost blinded response without its other material. Session-only mode requires an updated download for each new operation before submission; a password protects remembered storage, not an unencrypted downloaded recovery bundle.

Restore into the same issuer realm; reconcile a saved request before generating anything new. Report an unavailable issuer as unavailable, never as unspent or failed. Keep source and destination recovery material after ambiguous outcomes. Encrypted remote backup and encrypted sharing links remain separate E1 work.

## Atomic issuer state and recovery

Use a dedicated SQLite-backed Durable Object per issuer realm for the initial prototype, separate from the existing Sponsor and its transaction queue. Keep all keysets for that realm behind this single authority. Cloudflare documents transactional storage, but a multi-step application transition still requires an explicit atomic transaction. [Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

| Record | Required invariant |
| --- | --- |
| Issuer manifest and keysets | Pinned parameter digest and active/disabled state; no automatic key replacement |
| Issuance sessions | Random identifier, bounded expiry, immutable parameters/base and allowed operation; one committed use |
| Asset reservations | Unique `(issuerRealm, assetTag)` across supported issuance keysets |
| Spent credentials | Unique `(issuerRealm, sourceKeyset, nullifier)` permanently associated with the winning request digest |
| Operations | Request digest, session, durable complete response, protocol version, monotonic commit sequence and retrieval-capability verifier |
| Admission and quotas | Checked and consumed with the winning transition; a replay cannot spend quota twice |

Validate bounded inputs and expensive proofs before entering the short commit boundary. Recheck session expiry, keyset policy, quota, duplicate/spent state and request identity inside the transaction. If another operation wins meanwhile, no second response is returned. Treat the signer and durable authority as one logical operation; never release a usable issuance response before its registry state is durable.

For a swap, atomically consume the session, insert the old nullifier, debit admission, and store the complete replacement response. For mint, substitute the asset reservation. Precomputed response material that loses the transaction must never leave the issuer. On success return only the stored committed response. A retry with the same digest and valid retrieval capability returns those exact bytes even after session expiry or new-issuance suspension. A different digest cannot reuse a consumed session or nullifier. Unknown requests return a distinct outcome, not a fresh authorization.

```text
prepared locally -> submitted -> committed at issuer -> verified and saved locally
                         |
                         +-> unknown transport outcome -> retry exact saved request

competing valid request -> rejected as already spent; preserve local evidence
invalid proof/session  -> rejected without consuming asset, nullifier or quota
```

Response retrieval must work from the operation recovery bundle without depending on the old wallet session. A random high-entropy retrieval capability belongs only in request bodies/headers and the private recovery journal, not URLs, logs or public profile tables. Final wire/schema work must specify its digest and exact request binding. Response retention lasts for the issuer realm's supported recovery lifetime; no TTL may delete an unresolved committed response. Quota and retention costs must be measured before hosting.

Do not implement state authority by writing a spent flag in one database and a response in another, by eventual KV replication, or by assuming an async handler cannot interleave. Do not shard issuance/spends across independently committing objects until there is a reviewed coordination protocol. The initial capacity limit is an intentional prototype constraint.

Database rollback is a protocol incident: restoring a snapshot can resurrect spent credentials. Halt minting and transfers, retain current data and reconcile against a complete durable operation journal before resuming. A signature or monotonic sequence does not itself prove freshness to a new client. External checkpoints may detect some equivocation later; they do not guarantee atomic recovery or remove trust in the issuer.

## Cloudflare boundaries and proposed API

The prototype starts locally with test keys, independent storage and no live wallet, payment or reference-mint mutation. A hosted experiment requires a distinct Worker, DO namespace, issuer realm and keyset. It must not inherit production bindings or the ERC-721 sponsor key. The PS signing key is issuer custody material: keep it out of the browser, public Worker configuration, R2, D1 and logs. Separating a mint Worker from the public application is an operational boundary, not protection against the hosting account's administrator.

The browser verifier can run in a Web Worker; serving Workers must be benchmarked for pairing/proof CPU and memory before selecting a production crypto backend. [noble-curves](https://github.com/paulmillr/noble-curves) is a candidate group implementation, not an audited PS protocol supplied by this design. Freeze an explicit version, license and relevant audit scope in C1. The design PR added no dependencies. The subsequent isolated [C1 lab](PS-CRYPTOGRAPHIC-PROFILE.md) pins research-only noble and py_ecc backends with retained license notices; app dependencies are unchanged.

Proposed isolated service paths, not existing endpoints:

| Endpoint | Purpose and limits |
| --- | --- |
| `GET /ps/v1/manifest` | Pinned public protocol and issuer parameters, no signing secret |
| `POST /ps/v1/sessions` | Bounded issuance/swap session and expiry; session creation alone cannot spend a credential |
| `POST /ps/v1/issue` | Exact committed-issuance request and admission; atomically reserve the asset and response |
| `POST /ps/v1/swap` | Exact blind-transfer request; atomically consume the old nullifier and commit response |
| `POST /ps/v1/recover` | Request digest and retrieval capability; return the exact committed result without a new signature |
| `POST /ps/v1/states` | Bounded canonical nullifiers; authenticated issuer observation including realm, keyset and observation context; `unknown/unavailable` distinct from `unspent` |

Final schemas, maximum proof/request sizes, rate limits, observation-signature format and session lifetime are C1 artifacts. Do not invent accepted defaults from the reference bundle. An absent nullifier means only that this registry has not recorded a spend; it does not establish that an arbitrary submitted credential was ever valid. The client must separately verify its PS proof. State observations are never publicly cacheable as permanent ownership facts. No API accepts caller-provided issuer URLs or arbitrary signer operations.

D1 remains a public projection. R2 serves sanitized images/metadata and existing immutable OG snapshots. Neither receives owner secrets or bearer envelopes. PS events in the public activity feed come from consented publications, not guesses about private transfers. A wallet-authenticated admission proxy and public artwork host can correlate traffic with issuer operations; do not describe that deployment as unlinkable.

## Public proofs files and sharing

Retain the three independent checks in the item dialog: credential proof valid, publication endorsed by this wallet, and issuer currently reports the nullifier unspent. A missing endorsement or issuer outage must not display all three as verified. The exact wallet signature covers the showing bytes/digest, protocol/issuer/keyset, profile address, asset identity, origin and expiry. Copying a showing to another wallet profile must fail even if its PS equation is valid.

The two PS attributes bind the image and owner secret, not every title, creator label or metadata field. Keep metadata content-addressed and distinguish a separately wallet-signed provenance statement from the credential itself. C1/C5 must define that statement and avoid presenting unsigned metadata as issuer-certified provenance.

Use a new versioned ZFT file discriminator and protocol-discriminated inventory IDs. Never reinterpret a v1 secp256k1 private key as a PS scalar or derive a PS asset ID by assuming its field scalar equals the existing ERC-721 token ID. Reject multiple envelopes, cross-protocol nesting, oversized bodies and noncanonical group/scalar encodings. PS bearer exports contain `s`; public proofs, thumbnails, source-art downloads and OG snapshots must not.

Keep the supplied logo/theme, profile and selected-artwork composition, and immutable historical OG URLs. New PS routes and cache keys must include protocol plus issuer scope; they cannot collide with `/item/:tokenId` or old publication epochs. Before integration, specify a new route namespace such as `/credential/:issuerId/:assetDigest` and add bounded server-rendered metadata. A static OG image may show published art and historical context; it must not promise indefinitely current ownership.

Public statements are voluntary disclosures of artwork, wallet identity and the current nullifier. An old published statement can remain mathematically valid after transfer, while its nullifier is spent. Unpublishing removes discovery eligibility under the established retention policy; it cannot recall cached third-party images or make a disclosed link private again.

## ZVM contracts and migration

**No new Solidity contract is required for option A.** BLS12-381 precompiles provide group arithmetic and pairing checks; they do not store an issuer secret privately or implement atomic blind minting. [EIP-2537](https://eips.ethereum.org/EIPS/eip-2537). The existing [read-only probes](../research/bls-probe.json) tested several operations, not complete proof verification, map-to-curve compliance, gas feasibility or finality.

Potential later contracts have distinct purposes:

- An issuer/keyset registry or signed state checkpoint can publish parameters or commitments. It cannot enforce an honest mint's supply or recover omitted spends by itself.
- An authoritative on-chain nullifier registry requires a protocol that couples spend finality to usable issuance responses without stranding the receiver; asynchronous blind signing is not made atomic by submitting a transaction.
- An ERC-721 wrapper requires one authoritative locking/redemption path, duplicate prevention across both systems, reorg handling and an explicit confidentiality policy. Concurrently circulating ERC-721 and PS claims cannot both be advertised as the unique asset.

Keep the deployed ERC-721 contract and v1 ownership/recovery paths unchanged. The prototype issues separate lab assets only; there is no automatic conversion, dual mint of an existing token, burn or lock. A future migration must establish authority, exclusive backing, recovery after every partial step and user consent in its own reviewed specification. Until then, a PS prototype proves feasibility, not that ZFT's native ZVM NFT requirement is fulfilled by PS.

## Delivery and acceptance

| Work | Deliverable and evidence required |
| --- | --- |
| C0 Design review | Review this trust/custody choice, the native-NFT tradeoff and frozen reference baseline; no runtime change |
| C1 Profile and vectors | Publish exact transcripts/encodings, version and license inventory, source attribution, deterministic positive/negative vectors and a second verification path; explain all differences from the reference |
| C2 Local credential engine | Local issuer and two independent client stores demonstrate issue → export → claim → stale-copy rejection → cancel → public showing; no hosted secrets or assets |
| C3 Atomicity and recovery | Kill/restart at every durable/response boundary, concurrent claims, ambiguous responses, expiry and response replay; restore pending operations in another client |
| C4 Independent review | Review protocol composition, issuer behavior, randomness, secret handling, implementation/backend and stated privacy limits; close findings before a hosted experiment |
| C5 Product integration | After the custody decision, add protocol-discriminated UI/files/proofs, wallet endorsement and new routes; real MetaMask/phone and OG checks |
| C6 Hosted qualification | Isolated resources, measured proof limits, admission/retention budgets, key ceremony, compromise/restore drill and rollback procedure; separate apex/mainnet approval |

Required regression groups for C1–C3:

| Group | Must demonstrate |
| --- | --- |
| Math and encoding | Reject zero/infinity signatures, wrong-subgroup/off-curve points, noncanonical fields/scalars, truncation, extra fields and wrong lengths; mutated attributes or issuer keys fail |
| Proof binding | Mutate purpose, session/base, issuer/keyset, profile, asset, old nullifier, new owner commitment and equality-proof commitments independently; every unauthorized substitution fails |
| Conservation | One credential in produces one valid replacement for the same asset; different-asset substitution, arbitrary issuance from a showing and duplicate initial issuance fail |
| Races | Two clients with the same file yield exactly one committed swap; identical request retries yield byte-identical results; a changed request cannot recover another claimant's result |
| Crash recovery | Crash before commit leaves no spend; crash after commit/before reply recovers the original result; crash after unblinding/before local save is recoverable from the saved journal |
| Expiry and suspension | Expired uncommitted sessions reject safely; an already committed response remains recoverable after expiry, keyset retirement or mint admission shutdown |
| Identity and backup | Wallet/account changes cannot publish another wallet's statement; missing recovery material blocks submission; restore does not depend on replaying a wallet signature |
| Public boundaries | Public art/proof/OG output contains no owner secret or bearer envelope; spent and unavailable state are distinct; repeated nullifier linkability is documented |
| Isolation | v1 files, contract tests, immutable OG bytes and deployed bindings remain unchanged; unknown protocol/keyset cannot fall through to v1 |
| Operator incident | A restored or conflicting registry cannot silently resume; compromise and lack of a trustless exit are reflected in the runbook and UI |

Negative tests must fail against a deliberately broken control, not merely mirror the implementation. Differential vectors need an independently reviewed equation/transcript implementation or a licensed reference artifact; two adapters around the same library are insufficient. No claim of compatibility, cryptographic audit or production privacy follows from the current 229 ERC-721 app tests.

## Review outcome to record

The October 8 direction accepts ZFT-managed PS credentials without initial MetaMask inventory display; an optional later Snap is recorded above. Record the selected issuance profile and any deviation requiring review. Resolve issuer custody/availability expectations before hosting. C1 must determine usable source licenses and independent review ownership; public JavaScript availability is not a source-code license. The prototype's new tests and evidence belong under a separate PS namespace. Trading, mainnet, remote backup, bridge settlement and production migration remain separately scoped work.


C1 progress after PR #11: the [reference-core profile and fixtures](PS-CRYPTOGRAPHIC-PROFILE.md) now define exact bytes for the observed active issuance, showing and transfer paths. Two different curve libraries agree on deterministic examples; independent transcript review, an external oracle, ZFT-specific bindings and final API policies remain required. This is local research, not hosted integration.


C2/C3 progress after PR #12: the [separate local profile and engine](PS-LOCAL-ENGINE.md) implement local issuer/client stores, scoped asset attributes, complete session/recovery proof contexts and selected crash/race qualification. It uses raw bounded asset bytes rather than the production PNG/file adapters. Wallet bytes are proof context only; wallet endorsement, independent validation and hosted integration remain open. The original reference fixtures are preserved, and no live ZVM endpoint is required for this local work.

Local C1/C3 progress after PR #14: the [signed state observation profile](PS-LOCAL-STATE.md) adds a separate pinned Ed25519 key, bound showing challenges and atomic observer replay/sequence persistence. Its receipt is a timestamped issuer assertion, not a reservation or global consistency proof; fresh observers cannot detect an older snapshot from its sequence alone. Production trust distribution, wallet endorsement, independent review and hosting remain open.
