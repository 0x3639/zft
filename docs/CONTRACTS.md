# Contract design

Draft 0.1. This document and `contracts/interfaces/IZFT.sol` define the proposed API. They do not constitute deployed or audited Solidity.

## 1. Required contract

Deploy **one non-upgradeable `ZFT` ERC-721 contract** for v1. Extend pinned OpenZeppelin ERC721, EIP712, and ECDSA. Use Foundry for compilation, differential signature vectors, unit/fuzz/invariant tests, and deployment scripts.

No owner/admin transfer override, upgrade proxy, emergency ownership seizure, fungible token, collection factory, blind-signing mint, or bridge is required. Sponsorship can pause off-chain without freezing already owned tokens. Do not add burning in v1; retaining the token prevents re-minting a formerly burned hash and simplifies provenance.

Recommended public parameters: name `ZFT`, symbol `ZFT`, EIP-712 name `ZFT`, domain version `1`, fixed metadata origin supplied at deployment. Verify deployed bytecode and metadata-origin configuration in the client manifest. Contract migration means a new deployment and explicit user-facing migration procedure, never silently changing the verifying contract.

## 2. State and reads

| State | Meaning |
| --- | --- |
| Standard ERC-721 owner/approval mappings | Current disposable item key address or external recipient |
| `ownershipNonce[tokenId]` | Monotonic uint256 epoch, initially 0; changes on every transfer |
| `creatorNonces[creator]` | Replay protection for creator-signed mints |
| `creatorOf[tokenId]` | Immutable address that authorized this mint |
| `metadataHashOf[tokenId]` | Immutable SHA-256 digest of canonical metadata |
| Deployment’s metadata origin | Fixed URI prefix; no mutable administrator |

The image digest is encoded in `tokenId`; `imageHashOf(tokenId)` can return `bytes32(tokenId)` for existing tokens if convenient. Existence uses ERC-721 ownership, not a nonzero hash convention alone. Reject zero image hash to keep a clear sentinel.

`tokenURI(tokenId)` returns `<metadata-origin>/metadata/<lowercase metadataHash without 0x>.json`. Unknown tokens revert. Metadata and creator values cannot change after mint. The contract verifies authorizations over digests, not the correctness, content, or availability of uploaded bytes.

The implementation inherits normal ERC-721 functions and supports ERC-165, ERC-721, and metadata interfaces. Enumeration is provided by the off-chain event index, not ERC721Enumerable. ERC-2981 royalties are deferred until marketplace policy is reviewed.

## 3. Mint authorization

Exact EIP-712 type string:

```text
Mint(bytes32 imageHash,bytes32 metadataHash,address initialOwner,address creator,uint256 creatorNonce,uint256 deadline)
```

Domain: `{ name: "ZFT", version: "1", chainId, verifyingContract }`.

`mint(authorization, signature)` can be called by anyone. Recover the creator from the domain-bound signature; require it equals the nonzero `authorization.creator`. Require current creator nonce, nonzero image/metadata hashes, nonzero initial owner, unexpired deadline (`block.timestamp <= deadline`), and unused token ID. Increment creator nonce, persist metadata/provenance, then mint.

Use ECDSA low-s and valid-v checks from OpenZeppelin. V1 signed keys are EOAs; do not silently imply ERC-1271 smart-wallet authorization support. Fresh app-owned item recipients are EOAs. Use safe mint semantics for externally supplied contract recipients and specify the nonce as 0 before the receiver hook observes the token. A receiver hook must not violate epoch consistency. Guard signed entrypoints against reentrant authorization consumption and test receiver behavior.

Creator consent binds the intended initial owner, so a front-runner can execute the same mint but cannot redirect it. A different person can permissionlessly mint a candidate image hash first; global byte-hash uniqueness cannot prove authorship or prevent that kind of squatting. The app should not expose unpublished uploads; this reduces premature exposure but does not solve provenance attribution. The default publish state is private in the gallery.

Cloudflare’s upload attestation and quotas are sponsorship policy, not contract privileges. Another relayer can submit any valid creator-signed mint. This allows independence from the hosted app and also permits unsponsored mint spam at the caller’s expense.

## 4. Ownership rotation

Exact EIP-712 type string:

```text
RotateOwnership(uint256 tokenId,address newOwner,uint256 ownershipNonce,uint256 deadline)
```

`rotateOwnership(authorization, signature)` can be called by anyone. Require the token exists, the supplied ownership nonce equals the current epoch, the deadline has not passed, and `newOwner` is nonzero and different from `ownerOf(tokenId)`. Recover the signer and require it equals the current owner. Approvals do **not** authorize this extension; standard ERC-721 functions continue to follow standard approval rules.

Transfer using internal safe-transfer behavior after validation. The shared ERC-721 `_update` override advances the ownership nonce on every transfer, including normal transfers, approved transfers, and self-transfers. Mint is the sole exception: the initial epoch is 0. Burn is unavailable. Normal transfers to contracts require the standard receiver acknowledgment when callers choose the safe-transfer method.

The same signed method implements recipient claims and sender cancellation. Cancellation’s `newOwner` is a fresh key retained by the sender. The contract does not pretend to know which human is a friend, sender, or recipient. Any label distinguishing claim/cancel is local application context, not a security property.

Recipient binding defeats transaction copying: copying a signature can accelerate the same transfer, but cannot choose another address. Possession of the *embedded key* intentionally permits a new valid signature for a different recipient. Do not confuse these two threat models.

Front-running analysis: an observer with only a signed request cannot steal. An observer with the original transferable file has the same bearer authority and can race the recipient. Private file delivery and immediate claim remain necessary. Lack of a public mempool does not remove risks from relayers, RPC providers, NoM transaction publication, or file leaks.

## 5. Events and indexing

Use standard `Transfer`, `Approval`, and `ApprovalForAll`. Additional events:

```text
Minted(tokenId indexed, creator indexed, initialOwner indexed, imageHash, metadataHash)
OwnershipRotated(tokenId indexed, previousOwner indexed, newOwner indexed, ownershipNonce)
```

Emit `OwnershipRotated` for every ownership transfer, not just sponsored extension calls. Its nonce is the **new** nonce after the transition; the authorization carries the **old** nonce. Mint emits `Transfer(0, initialOwner, tokenId)` and `Minted`, with initial epoch 0 and no rotation event. Index by chain ID, contract, block hash, transaction hash, and log index. Track parent block hashes and rewind unfinalized effects on reorg.

Only finalize indexed state when the configured ZVM finality signal covers the containing block; see architecture. RPC receipt success alone is inclusion, not finality.

## 6. Approvals and interoperability

Standard ERC-721 transfer and approval behavior is retained for future tooling. Every transfer invalidates the old bearer epoch. Per-token approval clears under ERC-721 rules; an old owner’s operator approvals do not apply to the newly generated owner address.

The supported v1 app never requests marketplace approvals. Export checks token approval and any known operator approvals for the current owner and refuses an export when it detects active authorization. A fresh-key rotation clears per-token approval and leaves old-owner operator approvals behind. An event index cannot guarantee absence of unknown operator approvals when unavailable: require the current key to be app-created with no approvals, or rotate to a fresh known key first. Do not advertise marketplace compatibility as tested merely because ERC-165 returns true.

External normal transfer to a wallet changes owner and nonce. The application can show that wallet-owned NFT, but cannot export a bearer file without a disposable key it controls. A later “return to file custody” flow needs an explicit wallet transaction and fresh key; it is outside v1 onboarding.

## 7. Errors

Use typed custom errors for expired authorization, nonce mismatch, duplicate image, invalid signer, zero hash/address, same owner, and unavailable bearer export authority. The inherited ERC-721 contract supplies its standard ownership errors. Application error messages must map selectors, not parse arbitrary RPC strings as product instructions.

Expiry bounds sponsored request lifetime but does not revoke a bearer file. Recommended app authorization TTL is 10 minutes. A lost sponsor job reuses the exact authorization until it expires; a newly signed request must first reconcile token owner/nonce. Bound `deadline` to uint256 and reject invalid numeric serialization in the client.

## 8. Required invariants and verification

1. At most one minted token exists per image hash per deployment; no burn/re-mint path.
2. Every live token has one nonzero owner; provenance/metadata digest are immutable.
3. No sponsored transaction can transfer ownership without the current item key’s valid signature.
4. Every ownership-changing path advances the epoch exactly once; stale signatures fail even if a token returns to a previously used address.
5. Domain, token, new owner, nonce, or deadline substitution invalidates the signature.
6. Two concurrent rotations for the same epoch yield exactly one success.
7. A copied signed request cannot redirect the token; a copied key can race, by design.
8. Receiver reentrancy cannot consume the same authorization twice, bypass nonce rules, or corrupt initialization.
9. Standard owner, approved, and operator transfers preserve ERC-721 approval and receiver semantics and advance the epoch.
10. Relayer or app operators have no special owner override, upgrade, or metadata mutation path.

Run unit tests for all above, fuzz nonce/recipient/domain mutations, and a stateful invariant suite over direct and signed transfers. Use fixed EIP-712 vectors shared with the TypeScript SDK, including large token IDs beyond JS safe integer range. Deploy a canary on devnet, verify source/bytecode, then run mint/claim/cancel from independent clients. No production deployment follows solely from this interface review.

## 9. Future contract work

Karum integration may only need client signing and transfer flows; review its deployed exchange/API/source first. A bearer vault wrapper is an alternative if the exchange cannot interact with the chosen ownership pattern, but is not required for the proposed v1 contract.

Private transfers require a separate protocol and deployment. BLS precompiles being available does not allow a contract to keep a blind-signing mint secret. Choose either an off-chain issuer trust model or a ZK note/commitment/nullifier design with reviewed mint constraints, recipient binding, and metadata privacy. Do not retrofit privacy marketing onto the public rotation contract.

References: [ERC-721](https://eips.ethereum.org/EIPS/eip-721), [EIP-712](https://eips.ethereum.org/EIPS/eip-712), [OpenZeppelin ERC-721](https://docs.openzeppelin.com/contracts/5.x/erc721), [OpenZeppelin cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography).
