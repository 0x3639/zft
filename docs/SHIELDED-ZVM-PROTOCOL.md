# Experimental shielded ownership profile

This document specifies the isolated implementation candidate for SH1–SH3. It is a test profile, not an approved deployment or independent cryptographic review. It supersedes no existing v1 file, contract or historical PS evidence. The [implementation plan](SHIELDED-ZVM-IMPLEMENTATION.md) retains separate runtime, device, independent-review and staging gates.

## Authority and availability

A note's owner holds its secret and randomness locally. No mint service signs ownership, holds an issuer key, unwraps user keys or decides whether a spend is accepted. The new registry verifies proofs and consumes nullifiers atomically under the chain's consensus rules. A user-held bearer picture or recovery export contains spending authority and must be treated as a secret. Copying such a file copies authority; a recipient takes exclusive control only by confirming a spend to fresh locally generated authority.

Cloudflare can serve public application/proving artifacts, content, a derived index and optional transaction sponsorship. Those services receive no witnesses or bearer files. An alternate pinned client can reconstruct the tree from events and submit an unchanged proof using another fee account. This depends on chain access, available setup/client artifacts, and the user's image/metadata/recovery copies. Hashes do not guarantee data availability. Loss of all secret copies is permanent; loss of Cloudflare alone must not revoke authority.

## Encoding and immutable content

Integers in JSON are canonical unsigned decimal strings unless a field explicitly uses a JSON integer. Field elements must be less than

`q = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.

Hex hashes are `0x` plus 64 lowercase hexadecimal digits; addresses are `0x` plus 40 lowercase hexadecimal digits. Chain IDs are nonzero integers below 2^256. Zero registry/creator addresses are invalid. Exact schemas reject unknown fields. JSON is UTF-8, sorted by UTF-16 property order, with ECMAScript string escaping, no insignificant whitespace, duplicate keys, lone surrogates, negative zero, fractional numbers or unsafe JSON integers. Parsing requires byte-for-byte equality with re-encoding. Maximum nesting is 16. These restricted data types use the canonical encoding rules described by [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785); this is not a general-purpose implementation for arbitrary JSON numbers.

Metadata has exactly these fields:

| Field             | Encoding                                                |
| ----------------- | ------------------------------------------------------- |
| `format`          | `zft-shielded-metadata-v1`                              |
| `name`            | Nonempty string, at most 256 UTF-8 bytes                |
| `description`     | String, at most 4096 UTF-8 bytes                        |
| `imageHash`       | SHA-256 of the canonical public image bytes             |
| `canonicalizer`   | `zft-png/1`                                             |
| `mediaType`       | `image/png`                                             |
| `width`, `height` | Positive safe JSON integers, product at most 24,000,000 |
| `creator`         | Creator address                                         |
| `createdAt`       | Exact UTC `YYYY-MM-DDTHH:mm:ss.sssZ` timestamp          |

Canonical metadata is at most 8192 bytes. Use the unchanged v1 image normalizer through a new adapter; the ownership chunk is excluded from the public image hash. Imports recompute the image hash, dimensions and metadata hash. Before treating creation provenance as verified, the client also requires the matching canonical `Created` event and checks that its authorized creator equals `metadata.creator`. Offline parsing alone does not establish on-chain issuance or current control. Creation proves the digest relations described below, not the existence, artistic originality or validity of pixels. A direct caller can authorize unusable content; clients still reject inconsistent or unavailable content.

Let `H256` be SHA-256, `K256` Ethereum Keccak-256, and `ABI` Solidity `abi.encode`, with the exact types shown:

```
metadataHash = H256(canonical(metadata))
assetId = K256(ABI(bytes32 K256(UTF8("ZFT_SHIELDED_ASSET_V1")),
                  uint256 chainId, address registry,
                  bytes32 imageHash, bytes32 metadataHash))
D = uint256(K256(ABI(bytes32 K256(UTF8("ZFT_SHIELDED_LOCAL_V1")),
                      uint256 chainId, address registry))) mod q
assetHi = uint256(assetId) >> 128
assetLo = uint256(assetId) & (2^128 - 1)
```

The full asset digest is represented by two range-constrained 128-bit limbs, never reduced modulo q. D is deliberately a hash-to-field deployment separator; collision resistance is a cryptographic assumption, not an injective encoding of arbitrary deployments. The contract computes D using its own address and chain ID. Client deployment selection additionally pins genesis and deployed code; these are network-selection checks, not private circuit inputs.

Transfers preserve the exact assetId, including imageHash, metadataHash, creator and creation timestamp. Metadata has no mutable URL. Alternate retrieval locations are separate untrusted hints. The registry permits at most one successful creation for an imageHash within that deployment. This does not prohibit a visually similar encoding, another deployment or unauthorized reuse of an artist's image.

## Note and proof relations

Use the BN254 scalar field and the pinned circomlib Poseidon instances of arity 2, 4 and 6. Compiler, dependency, source, R1CS, WASM and setup hashes must accompany the selected candidate. Poseidon tags are field integers 1 for notes and 2 for nullifiers. Merkle internal nodes use the arity-2 instance. Leaves are arity-6 commitments, not arbitrary internal nodes.

A client samples each secret and randomness independently from nonzero 248-bit integers using its cryptographic RNG. Rejection sampling of 31 random bytes is uniform over 1 through 2^248−1. Test vectors may use explicitly public deterministic values.

```
C = Poseidon6(1, D, assetHi, assetLo, secret, randomness)
N = Poseidon4(2, D, secret, C)
```

The exact note schema is `{format, deployment, metadata, imageHash, metadataHash, assetId, secret, randomness, commitment}`. Format is `zft-shielded-note-v1`; deployment is exactly `{chainId, registry}`. Commitments and authority integers use decimal strings. Every derived field is recomputed when importing a note. Public exports omit the entire note and any recovery material.

Creation circuit public inputs, in order: `[D, assetHi, assetLo, C]`. Private inputs: `[secret, randomness]`. It constrains both limbs to 128 bits, both authority values to nonzero 248-bit integers, and computes C from all of them. The registry independently computes assetId and its limbs from the authorized hashes. The registry rejects a zero or previously published C.

Spend circuit public inputs, in order: `[D, root, N, Cout]`. Private inputs: `[assetHi, assetLo, secret, randomness, nextSecret, nextRandomness, siblings[16], bits[16]]`. It:

1. Constrains both asset limbs and old/new authority values as above.
2. Derives the old C from the old authority and asset.
3. Derives N from that same old C and secret. There is no independently selectable nullifier secret or unconstrained leaf position.
4. Proves C membership in root with exactly 16 Poseidon2 levels and Boolean direction bits, least-significant position bit first.
5. Derives Cout from the same asset and fresh destination authority and requires Cout != C.

The contract accepts only its D, a retained root, an unused N, a nonzero unpublished Cout and a valid proof. It consumes N, records N→Cout and appends Cout in one transaction. Any failure reverts all writes. Repeating the same transaction can be observed as already completed through N→Cout; it is not executed twice. An old bearer copy cannot select a different N for the same note or redefine the asset in its successor without breaking these relations.

The circuit does not require a fee-paying address, relayer or recipient account. A copied valid proof has the same destination commitment; it cannot redirect the destination. Anyone with the old bearer secret can generate a competing valid spend to their own new secret. First consensus acceptance wins. Export/import alone never establishes exclusive control.

## Tree and registry state

Each test-profile tree has depth 16 and capacity 65,536 leaves. The registry maintains an append-only forest of such trees. Zero leaf is 0 and each higher empty subtree is Poseidon2 of the lower zero with itself. Appends publish the commitment, global index, tree ID and resulting root. Tree ID is `floor(globalIndex / 65536)`; the private membership position is `globalIndex mod 65536`. Indices are public append positions; the private spend witness chooses a valid membership path without disclosing its input index.

Keep the latest 64 roots, including the initial empty root until displaced. When a tree fills, its final root is also retained permanently. The next valid creation or spend opens the next empty tree during its atomic append; no administrator or keeper action is required. An unused note in an older tree remains spendable by rebuilding a path to that tree’s permanent final root. Nullifiers, image uniqueness and commitment uniqueness are global across all trees and are never cleared during rollover. N deliberately excludes tree ID/index, so rollover cannot give an old note a fresh spend identifier. There is no emergency override, upgrade key or hidden mint path. Closed roots grow by one storage entry per 65,536 appends; all spent nullifiers and commitment-uniqueness entries also continue to grow. Storage costs, history reconstruction and root parameters require workload review before staging.

A replay client reads ordered registry events from the deployment block, verifies contiguous append indices, recomputes every root, and compares reconstructed state with chain reads at the selected block. An index cannot authorize a spend. The current client checks consistency against its configured RPC; it is not an independent consensus light client. A dishonest RPC can fabricate a self-consistent view. Independent chain access/derivation remains a release gate. Reorg handling must rewind to a common canonical block and replay; a past valid root/event receipt is not finality evidence. Store deployment genesis, address, code hashes, block identity and candidate artifact hashes separately from a portable note.

## Creation authorization and front-running

Creation uses commit/reveal plus creator authorization. The EIP-712 domain is `name="ZFT Shielded Registry", version="1", chainId, verifyingContract`. Typed data is:

```
Create(bytes32 imageHash,bytes32 metadataHash,uint256 commitment,
       address creator,uint256 nonce,uint256 deadline)
```

A creator signs the typed-data digest. Nonce is per creator; deadline is an absolute chain timestamp. A prior commitment is

```
K256(ABI(bytes32 K256(UTF8("ZFT_SHIELDED_CREATE_COMMIT_V1")),
          bytes32 typedDataDigest, bytes32 randomSalt))
```

Anyone can publish this opaque value. Reveal is valid from 2 through 256 blocks after the first recorded commitment, inclusive. The deployment-specific typed digest binds both content hashes, destination C, creator, nonce and deadline. A copier can submit the same reveal but cannot substitute metadata or destination. Reveals without a matured matching commitment reject. The delay is a test-profile anti-preemption measure, not a finality or censorship guarantee. Previously committed competing creations and censorship remain possible. Creator authorization establishes an address's statement, not copyright ownership.

## Submission and recovery

Before mint or claim submission, save the destination note and exact intended operation to a user-controlled recovery record, then require acknowledgement of a durable export/reselection. Local storage alone is not a recoverable backup. A claim's saved operation binds the old N, old and successor notes, selected deployment and artifact pins. Rebuilding a witness/proof for a newer root may change the proof but must not replace the saved successor.

The local state machine distinguishes prepared, submitted, uncertain, observed, finalized, conflicted and unavailable. No response or a timeout is uncertain. Inspect N→Cout and canonical events: expected Cout resolves to the saved destination; a different Cout means a competing spend; absent N means still unobserved at that chain state, not guaranteed never broadcast. Retain old and new authority through reorg risk. Exact finality policy depends on actual ZVM derivation/consensus evidence and is not inferred from an EVM receipt or fixed block count.

Restore from a user-held record in a fresh client and rebuild witnesses from public events. No provider account, backup server decryption key or trusted mint is required. Locally encrypted vault/backup records protect at-rest copies under a user-held password/key; they do not revoke older exported bearer files. Compromised application JavaScript can read secrets while unlocked. A Web Worker protects responsiveness, not authority from the application itself.

## Disclosure and deferred showing

| Surface                        | Visible data                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Creation                       | Creator, image/metadata digests, first C, transaction sender/timing, commit/reveal timing |
| Spend                          | Root, N, Cout, proof, transaction sender/timing; no explicit assetId, old C or index      |
| Chain events/index             | All appended commitments, roots and nullifier-to-output mappings                          |
| Bearer picture/recovery record | Image/metadata, asset identity and spending secrets; must remain private                  |
| Proving worker                 | Full private witness in client memory                                                     |
| Public image download          | Verified canonical pixels only                                                            |

The initial C is linked to creation. A previous bearer holder knows the old secret and therefore its N, so they can identify that note's successor when it is spent. They do not learn the successor secret from the proof. Transaction accounts, timing, tiny sets, off-chain file sharing and voluntary disclosure can correlate activity. No production privacy or anonymity-set claim follows from a shared tree or passing proofs.

A historical membership proof is not a proof of current unspent control. Current-ownership showing and public profile publication remain disabled until an explicit relation binds a profile/challenge and identified chain state and accounts for unspentness and resulting linkability. This does not block the private creation/spend/recovery milestone.

## Setup and qualification boundaries

The harness compares Groth16 and PLONK using the same circuits. Groth16 development keys include only a local disposable phase-2 contribution, and are never approved production setup. The public universal powers-of-tau file is checked against a pinned BLAKE2b digest; this detects artifact mismatch, not malicious setup participants. PLONK's universal setup does not eliminate setup assumptions. Record exact verifier code hashes and proof/resource measurements before selecting a release profile.

Tests must execute real proofs and both positive and negative verifier cases; witness-generation failure alone cannot demonstrate all R1CS constraints. Mutation controls must show named assertions fail when a required relation/check is removed. Local EVM results do not qualify live ZVM gas, runtime or finality. A read-only live primitive/verifier probe is narrower than a deployment transaction or independent operator reproduction.

Independent protocol/circuit/contract review, compatible dependency licensing, actual target devices, independent chain access, setup acceptance and explicit staging approval remain required. Existing PS and v1 test totals are historical evidence and cannot be counted as shielded proof acceptance.
