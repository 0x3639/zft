# PS reference-core profile and differential fixtures

Status: **C1 in progress**, local research profile `nfc-reference-core-2026-10-06-lab-v1`. PR #11's [architecture proposal](PS-CREDENTIAL-PROTOCOL.md) is merged. This increment supplies executable encodings, transcripts and deterministic vectors for its next step. It is not a production wire protocol, a deployed issuer, or independent cryptographic approval.

## Scope and provenance

The reference is the frozen [2026-10-06 browser artifact inventory](../research/ps-reference-2026-10-06.json). Its active wallet calls committed issuance **v3** and blind transfer. Static inspection of the pinned PS module established the client equations, proof inputs and serialization; the main app established keyset derivation and showing verification. The server implementation and admission/spend enforcement were not available. The issuer response equations below are **derived for this lab**, not observations of that server. We neither ran reference transactions nor copied its JavaScript into this repository. A reusable upstream source license has not been established.

[Pointcheval and Sanders](https://eprint.iacr.org/2015/525) specify the randomizable signature primitive; the website's application transcripts and state machine require their own review. The lab contains original Python generation/equation code using py_ecc and a separately written JavaScript verifier using noble. These are distinct curve backends, but the same author prepared both transcript interpretations. Agreement is not independent authorship, an external test oracle, proof of compatibility, or a security audit.

The frozen deliverables are [vectors.json](../research/ps-lab/vectors.json), [Python generator](../research/ps-lab/generate.py), [JavaScript verifier](../research/ps-lab/verify.mjs), [tampering tests](../research/ps-lab/verify.test.mjs), and [dependency inventory](../research/ps-lab/dependencies.json). Every secret and nonce in these fixtures is deliberately public. The fixture image input is a short raw byte string; JPEG normalization is outside this test.

## Scalars, groups and framing

Use BLS12-381 prime-order subgroups G1 and G2, additive notation, pairing `e: G1 × G2 → GT`, and standard generators `G1`, `G2`. The scalar order is:

```text
q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001
```

`I_w(n)` is unsigned, fixed-width, big-endian encoding in `w` bytes; out-of-range values are rejected. `F_w(b) = I_w(len(b)) || b`, where lengths count bytes. `F` means `F_2`; scalar encoding is `I_32`. Labels are UTF-8 without an implicit terminator. Wire hex is lowercase, even-length, without `0x`. Scalars must be exactly 32 bytes and strictly below q; owner secrets must also be nonzero. Challenges may be zero. `H(b) = OS2IP(SHA256(b)) mod q`; this reduction is not a claim of perfectly uniform sampling.

`P(point)` is canonical compressed encoding: G1 48 bytes, G2 96 bytes. G2 stores the imaginary x component first. Accept only on-curve points in the prime-order subgroup, with exact length and re-encoding equality. Public key elements, credential bases/signatures, owner commitments and presentation points must be nonidentity. Derived issue asset/attribute commitments may be identity when h is zero. The lab is not an exhaustive edge-case implementation of all possible degenerate statements; the complete production parser policy remains a C1 review item.

The two application generators use the BLS12-381 G1 XMD/SHA-256 SSWU random-oracle hash-to-curve construction with cofactor clearing, as exposed by both pinned libraries. [RFC 9380](https://www.rfc-editor.org/rfc/rfc9380.html#section-8.8.1) defines that construction; these are the reference's custom domain separation tags:

| Point | UTF-8 message | DST |
| --- | --- | --- |
| `G_N` | `ps_nullifier_base` | `CASHU_PS_GNULL_XMD:SHA-256_SSWU_RO_` |
| `G_A` | `ps_asset_tag_base` | `CASHU_PS_ASSET_TAG_XMD:SHA-256_SSWU_RO_` |

For exact asset bytes `a`, `h = H(UTF8("Cashu_PS_Asset_v1") || F_4(a))`. The ownership nullifier is `N = s G_N`. Both generator bytes and h are cross-checked between backends.

## Parameters and credentials

Issuer scalar secrets are `(x, yh, ys)`. Public parameters serialize as:

```text
public_key = P(X2) || P(Yh2) || P(Ys2) || P(Yh1)       # 336 bytes
X2 = x G2; Yh2 = yh G2; Ys2 = ys G2; Yh1 = yh G1
keyset_id = 0x03 || SHA256(F_4(P(X2)) || F_4(P(Yh2)) ||
                          F_4(P(Ys2)) || F_4(P(Yh1)) || F_4(UTF8("psnft")))
```

The keyset ID is 33 bytes. Computing it establishes consistency, not trust in an issuer. A verifier must receive trusted parameters from an authenticated configuration. The lab additionally checks `e(Yh1, G2) = e(G1, Yh2)`; this check was not seen in the reference's inspected `g_` parameter validator. Treat it as an explicit lab policy rather than claiming identical validation behavior.

A two-attribute credential is `(u, v, h, s, keyset_id)`, where `v = (x + yh h + ys s) u`. Verify:

```text
e(v, G2) = e(u, X2 + h Yh2 + s Ys2)
```

The reference bearer token is `psnft1` followed by lowercase hex of `keyset_id || P(u) || P(v) || I_32(h) || I_32(s)` (193 bytes, 386 hex characters, plus prefix). Syntactic token decoding does not verify the signature or current spendability. This lab does not add a ZFT file adapter or change existing v1 files.

## Proof transcripts

For a DLEQ proof with ordered bases `B_i`, ordered statements `D_i = w B_i`, nonce r, domain label L and context C:

```text
R_i = r B_i
transcript = UTF8(L) || F(C) || F(P(B_0)) || ... || F(P(B_n)) ||
             F(P(D_0)) || ... || F(P(D_n)) || F(P(R_0)) || ... || F(P(R_n))
c = H(transcript); z = r + c w mod q
proof = I_32(c) || I_32(z)                              # 64 bytes
```

Verification reconstructs `R_i = z B_i - c D_i`. No counts are inserted; the operation fixes the ordered arrays.

For linear relations, each ordered equation is `D_j = sum(B_ji w_index_ji)`. Choose one nonce `r_i` per witness. For every equation, in order, append:

```text
R_j = sum(B_ji r_index_ji)
transcript starts with UTF8(L) || F(C)
append F(P(D_j)) || F(P(R_j))
for each ordered term append F(P(B_ji)) || I_2(index_ji)
c = H(transcript)
proof = I_32(c) || I_32(r_0 + c w_0 mod q) || ...
```

Verification reconstructs `R_j = sum(B_ji z_index_ji) - c D_j`. The fixed operation determines equation/term/witness counts and group assignment. Mixed G1/G2 relations use the same scalar challenge. Every complete transcript is included in the fixture, so field order, indices and nested length prefixes are observable.

## Committed issuance v3

For a 16-byte session identifier, form `D = h G_A`, `B = h Yh1`, `S = s G1`. Prove these three equations in that order with witnesses `[h, s]`, terms `[(G_A,0)]`, `[(Yh1,0)]`, `[(G1,1)]` respectively. Use label `Cashu_PS_CommittedIssue_v3`, context `keyset_id || session`, and a 96-byte proof. The request fields are `version: 3`, `session`, `asset_tag: P(D)`, `b: P(B)`, `owner_commitment: P(S)`, and `proof`.

This active request has no issuance blinding scalar t. The older blind-issuance helpers are not substituted for it. The lab's derived issuer response chooses k and returns `u = k G1`, `v = k (x G1 + B + ys S)`. The client verifies the resulting credential under the expected keyset. Server-side asset reservation, session admission and response persistence are not implemented here.

## Public showing

Randomize the signature with nonzero rho: `U = rho u`, `V = rho v`; form `T = s U`, `N = s G_N`. Prove owner knowledge using DLEQ bases `[G_N,U]`, statements `[N,T]`, and label `Cashu_PS_Present_v1`.

The reference's profile is **32 bytes**, not an Ethereum address. The text context is exactly four lines, with no final newline:

```text
Cashu_NFT_Portfolio_Show_v1
<64 lowercase hex characters of profile>
<64 lowercase hex characters of h>
<66 lowercase hex characters of keyset_id>
```

The DLEQ context is `UTF8("Cashu_PS_Showing_v1") || F(UTF8(text))`, itself framed by the DLEQ transcript. Wire form is `pshow1` plus lowercase hex of:

```text
F(UTF8(text)) || keyset_id || I_32(h) || P(U) || P(V) || P(T) || P(N) || proof
```

The presentation after text is exactly 321 bytes. The verifier checks the expected profile, asset and keyset, the owner proof, and `e(V,G2) = e(U,X2+hYh2) e(T,Ys2)`. The reference additionally uses an outer profile signature and live issuer state. Those are not in this lab. Consequently a valid fixture showing does not establish a ZFT wallet endorsement or an unspent holding.

## Blind transfer and unblinding

The destination owner commitment is `S_new = s_new G1`, with an owner DLEQ under `Cashu_PS_Issue_v1`, empty context, base `[G1]`, statement `[S_new]`. Randomize the source credential as above; its owner DLEQ uses context `P(S_new)` instead of showing text.

Given issuer session base `U_new = k_new G1`, blind with o and t:

```text
K = h Yh2 + o G2
V_hidden = V + o U
B_new = h U_new + t G1
```

Use linear witnesses `[h,o,t]`, equations `K` with terms `[(Yh2,0),(G2,1)]`, then `B_new` with terms `[(U_new,0),(G1,2)]`. Label is `Cashu_PS_CommitEq_v1`, context `P(S_new)`, proof length 128 bytes. The request contains `b`, `proof`, `new_owner_commitment`, `new_proof` and the following presentation (385 bytes):

```text
keyset_id || P(U) || P(V_hidden) || P(K) || P(T) || P(N) || source_owner_proof
```

Verify both owner proofs, the mixed-group equality proof and `e(V_hidden,G2) = e(U,X2+K) e(T,Ys2)`. The session base participates as a proof base; do not infer that a full session identifier, issuer origin, operation purpose or ZFT wallet address is included where the inspected transcript does not contain it.

The derived lab response is `v_blind = x U_new + yh B_new + k_new ys S_new`. Require the expected response base and keyset, then compute `v_new = v_blind - t Yh1`. Verify the new credential with h and `s_new`; its new nullifier is `s_new G_N`. Losing t prevents this unblinding. Atomic old-nullifier consumption, idempotent response recovery and cancellation are C2/C3 state-machine work, not properties established by these algebra tests.

## Versions, licenses and validation

The isolated [lab README](../research/ps-lab/README.md) gives reproducible commands. Its own pnpm lock pins **noble-curves 2.4.0** and **noble-hashes 2.4.0** (MIT); the Python requirements pin **py_ecc 8.0.0** (MIT) and its full dependency closure with wheel hashes. The [inventory](../research/ps-lab/dependencies.json) records registry metadata, artifacts and retained license-notice hashes. Transitive notices include MIT, BSD-3-Clause and PSF-2.0 terms. This records provenance and notices, not a legal conclusion about upstream website code.

The selected versions are not an audited PS implementation. [py_ecc explicitly warns that its code has not been audited](https://github.com/ethereum/py_ecc#py_ecc). Noble documents audits of earlier releases/components; their existence does not establish audit coverage of this pinned release, PS equations or application transcripts. The lab does not qualify either backend for production timing behavior, browser randomness, side channels or Cloudflare CPU budgets.

Recorded local checks: 42 JavaScript verifier tests plus a checkout-path portability regression (43 total), exact Python vector regeneration with pairing checks, and three deliberately broken controls (pairing, linear challenge and DLEQ challenge removed) that the negative tests reject. Tests cover changed attributes/signatures, bad subgroup points, malformed scalar/point/proof encodings, changed domains/order/index/context, wrong profile/session/keyset, transfer tampering and incorrect unblinding. They do not prove all protocol attacks are covered. [Validation evidence](../research/ps-profile-validation.json) records the source hashes and scope.

## Remaining C1 decisions

- Obtain independent review of the equations, transcript interpretation and fixtures, or properly licensed reference vectors from a separate implementation. Both local paths can share a conceptual mistake.
- Define a separately versioned ZFT profile: trusted issuer realm/parameter distribution, wallet endorsement, purpose/session/replay bindings and metadata provenance. Preserve this reference fixture instead of silently changing its domain labels.
- Freeze bounded request/response schemas, parser edge cases, entropy and rejection rules, operation lifetimes, authenticated state observations and issuer key rotation behavior before hosting.
- Resolve reference source licensing before any reuse. Exact reference interoperability, server enforcement and a security claim remain unverified.

C1 remains open. C2 may build a local state-machine harness from reviewed lab interfaces, while C4 independent review and C5 custody/integration approval remain required before a hosted experiment or public product integration. The ERC-721 devnet Worker, its root dependencies, original branding, vault files and historical OG snapshots are unchanged.
