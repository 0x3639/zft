# ZFT product and protocol specification

Protocol design, updated 2026-10-04. Implementation is authorized and a hosted devnet alpha exists. The [complete website functional specification](FUNCTIONAL-SPEC.md) is the central product/interaction contract; the [reference action ledger](REFERENCE-AUDIT.md) records observed behavior and remaining audit gaps.

Protocol direction update (2026-10-06): [PS-CREDENTIAL-PROTOCOL.md](PS-CREDENTIAL-PROTOCOL.md) is the next design proposal for the requested PS/BLS12-381 parity. The ERC-721 design below describes the v1 baseline; its earlier deferral of all private-protocol work is superseded by C0–C6 in the roadmap. PS issuer/custody and ordinary MetaMask NFT compatibility must be resolved before integration. No deployed semantics change in this design PR.

Implementation note (2026-10-04): [DEVNET-ALPHA.md](DEVNET-ALPHA.md) is the authoritative implemented subset. Its frozen `zft-png/1` codec normalizes supported JPEG/PNG inputs to RGBA PNG and exports `zfTA` PNG envelopes. Signed profiles/social relations, public holding attestations, indexing, and unique OG images are implemented in part. Full website parity, JPEG APP15 export, and broader color-profile conversion remain planned. Aspirational fault/recovery requirements below are not claims that every beta acceptance gate has passed.

## 1. Product promise

A user turns a JPG or PNG into a collectible, keeps it in a local collection, and exports a transferable picture. A recipient imports that file and claims ownership. Once the claim finalizes, earlier copies lose transfer authority. The image remains viewable in ordinary image software.

The file contains an ownership capability, not a physically unique picture. Possession allows a claim; it is not an offline guarantee of current ownership. A sender retains the same capability until somebody rotates it. The interface states **“Whoever claims this file first gets the collectible.”**

ZVM enforces uniqueness and ownership transitions. Cloudflare hosts the app, sanitized art, metadata, discovery index, and gas sponsorship. No collectible private key reaches the server. Transfer history is public. Minting establishes provenance of the signed mint request, not copyright or originality of the depicted work.

## 2. Users and release scope

Primary users are creators giving images to friends and collectors receiving them without installing a crypto wallet. Advanced users can inspect each item and transaction in the ZVM explorer or submit a signed claim through another client.

| v1 included | Later releases |
| --- | --- |
| Local collection and encrypted recovery bundle | Encrypted backup synchronization |
| JPG/PNG mint, export, import, claim, cancel | Password-protected files and encrypted claim links |
| Sponsored operations within stated quotas | User-paid transactions and native Syrius integration |
| Public profiles/collections, follows, likes, unique OG images | Karum sales, offers, and settlement |
| Public ERC-721 ownership rotation | Private ZK transfers or blind-signing mint |
| Network/finality/error states | Mainnet after independent verification |

The first implementation does not require BLS signatures, a bridge, a fungible token, a factory, a marketplace, or a network upgrade. One public ERC-721 deployment suffices. “Collections” initially means curated off-chain groups of items from that deployment, not separately deployed contracts.

## 3. Identity, images, and metadata

`imageHash = SHA-256(canonical image bytes)`; `tokenId = uint256(imageHash)`. The contract rejects a repeated hash in that deployment. Identical pixels encoded differently can produce different hashes. Cross-chain and cross-contract duplicates remain possible. Do not market this as global visual uniqueness.

The v1 canonicalizer is deterministic and versioned. The frozen `zft-png/1` implementation decodes supported inputs with fixed limits, applies orientation, removes private/ancillary metadata, and writes through a pinned PNG encoder, preserving transparency. It rejects embedded ICC profiles and CMYK JPEG; arbitrary color-profile conversion is not implemented. See the runbook for the exact input restrictions and pinned codec settings. Do not change canonical bytes through a browser canvas encoder or silently replace the codec for existing files.

Incoming files: JPEG or PNG only, maximum 10 MiB and 24 megapixels. Reject animated PNG, malformed structure, unsupported bit depth, multiple ownership envelopes, and decompression bombs. Enforce decoded-memory and output-size limits before allocation. Accept the final normalized format only after local preview. Source photos may contain private metadata; normalization occurs locally before upload.

After minting, do not normalize or re-encode the image again. To verify an exported file, remove exactly its ZFT envelope and hash the remaining canonical image bytes. Editing, screenshots, compression, or metadata-stripping services may break transferability. The user should send the original file as an attachment.

Metadata is a compact, immutable JSON document serialized using RFC 8785 JCS. It includes title, description, canonical image URL/hash, canonicalizer version, dimensions, media type, creator profile address, and mint timestamp supplied in the signed metadata. Use strings for large numbers. `metadataHash = SHA-256(JCS(metadata))`. The contract stores this digest and derives a URI under the deployment’s fixed metadata origin. The browser verifies fetched metadata against the digest. Display names and collection grouping are off-chain and can change without modifying the NFT.

Art and metadata are content-addressed R2 objects. Hosting availability remains an application dependency; exported files carry image bytes and metadata so owners have an independent copy. Standard marketplace renderers rely on the metadata URI and do not automatically verify its hash.

## 4. Ownership and recovery

Wallet custody uses the connected MetaMask address as owner and, for wallet minting, creator. A fresh secp256k1 key is generated with browser randomness only when minting/claiming into file custody or moving a wallet-owned item into a file. Each disposable key holds one ZFT item in the supported app flow. Never embed a wallet private key, vault root, profile key or sponsor key in a picture.

A wallet identity signs its own profile operations with scoped `personal_sign`; wallet mints use EIP-712. File sessions retain a separate local profile key for legacy profiles and local mint provenance. Identity selection is explicit, with no automatic linking/merging. Local profile and item keys live either in session memory or optionally in encrypted IndexedDB. Both modes retain the v1 random 256-bit root, HKDF-SHA-256, AES-256-GCM with fresh record IVs, and deployment/record/version authenticated data.

Only the optional protected-browser mode persists the root, wrapped by a user-chosen passphrase using PBKDF2-HMAC-SHA-256 (600,000 iterations), random salt and AES-256-GCM. Session mode persists no secret and ends on reload/tab close. Protected mode locks manually or after 15 minutes of inactivity, deferring while foreground operations run. Existing encrypted vaults require unlock; they are never silently downgraded or overwritten. A session can upgrade after current recovery acknowledgment. The passphrase never goes to Cloudflare; JavaScript memory cannot guarantee secure erasure.

The v1 recovery bundle contains the random root and a snapshot of encrypted profile/item records. It is a **secret bearer backup**, not protected by the browser passphrase; anyone with it can restore included keys. Require download and acknowledgment **before submitting ownership to each new disposable key**, including mint, claim, cancel and wallet-to-file. Backup-key hashes remember which keys were acknowledged without storing them unwrapped. Status changes still mark record snapshots outdated; they do not invalidate already backed-up key coverage. A snapshot only restores its included keys; the root cannot recreate later independent keys. Wallet-only custody does not use this backup.

Do not promise automatic recovery across devices in v1. Losing all current keys and backups loses control; there is no administrator recovery. Saving an exported item file is another backup, but anyone receiving it can race the owner to claim.

## 5. Mint

1. Connect MetaMask for default wallet custody. For explicit file custody, open a session or unlock protected storage and acknowledge recovery.
2. Read the image locally, normalize it, and display the exact canonical result.
3. Persist a public wallet draft with the connected creator/owner, or prepare a fresh file key and acknowledge a snapshot containing it before sending a mint request.
4. Upload sanitized canonical art and metadata. Backend verifies hashes and structure and issues a short-lived upload attestation for sponsorship policy.
5. Sign a domain-bound `Mint` authorization with MetaMask for wallet custody or the local profile key for file custody. It binds image/metadata hashes, initial owner, creator nonce and deadline; save exact consent before submission. The current wallet path prompts for this before upload.
6. Sponsor simulates, signs, and submits the fixed contract call through ZVM’s relayed EVM path.
7. Show submitted, included, and finalized states separately. If the transaction is lost or reorged, reconcile using token ID, mint signer nonce, and receipts before retrying.

Onchain uniqueness decides a simultaneous duplicate-mint race. A duplicate response links to the existing item rather than presenting an owned mint. An uploaded object or server receipt does not prove mint success. Persist the draft key until the outcome is known.

## 6. Send, claim, and cancel

**Send:** Read current `ownerOf` and `ownershipNonce`, verify local authority, then construct an export file. Downloading does not submit a transaction. The exported envelope has the current nonce and key. Set local state to `Exported · still yours until claimed`; repeated exports share the same authority. An intentional public preview contains no envelope.

**Claim:** validate the local file, image/metadata, pinned deployment, current owner and epoch. Default the recipient to the connected wallet; authorize using the imported disposable key, store only its scoped rotation signature in the wallet journal, and authenticate sponsorship with the wallet. For explicit file custody, prepare a fresh independent key and require an acknowledged recovery snapshot before signing/submitting. The sponsor cannot change the recipient. Confirmation invalidates the old file authority.

**Cancel:** The sender rotates the exported item to a freshly generated local key using the same on-chain operation. Previously sent files stop working after finality. Cancel and claim can race; whichever valid transition the chain orders first wins. No refund/reversal or guarantee of sender priority is implied.

**Concurrent claim:** Two different recipients can make individually valid signatures from the same copied key. Exactly one transition succeeds for the current nonce. The loser sees `Already claimed`; preserve their pending record until reconciliation proves it has no authority.

**Reorg/retry:** Never delete the previous key or pending new key merely because one confirmation appeared. Keep a bounded transition journal through finality and a documented retention window. If a receipt disappears, re-read owner and nonce, reconcile against the same authorization digest, and retain keys for both outcomes until resolved. Do not assume a server job’s `finalized` label is authoritative when the node is unavailable.

## 7. File envelope v1

The implemented v1 uses one PNG private ancillary chunk `zfTA` (unsafe to copy after image editing). Payload is UTF-8 canonical JSON, maximum 16 KiB. Validate PNG chunk bounds/CRC; unsupported versions fail closed. JPEG APP15 export is a future format extension, not currently accepted as a ZFT transfer file.

```json
{
  "format": "zft",
  "version": 1,
  "canonicalizer": "zft-png/1",
  "chainId": "7340469",
  "contract": "0x<approved-deployment>",
  "tokenId": "<uint256-decimal>",
  "imageHash": "0x<32-byte-sha256>",
  "metadataHash": "0x<32-byte-sha256>",
  "metadata": { "name": "Example", "...": "..." },
  "authority": {
    "scheme": "secp256k1",
    "privateKey": "0x<item-key-only>",
    "ownershipNonce": "0"
  }
}
```

This is a schema illustration, not a valid token. The client independently checks every redundant identity field. Never follow an RPC URL or execute content from a file. Approved deployment manifests pin chain ID, contract address, deployment block, expected bytecode hash, and metadata origin. Reject keys outside the curve scalar range.

## 8. Public collection and availability

Publishing a holding under a profile or grouping it into a collection is optional. The implemented index currently discovers all mint provenance automatically; a gallery-discovery opt-out is a future application feature and would not make on-chain metadata or public art confidential. A profile operation must be signed by the profile key. Display current ownership only after live contract verification. A public card can show a fresh possession attestation signed by the item key and bound to profile ID, token ID, owner address, ownership nonce, and expiry. A copied or stale attestation cannot establish current control.

Replicate the reference public profile surface: cover/avatar, name/bio, shortened copyable identity, share control, collected/sent/likes/followers/following counts, and Collection/Sent/Activity tabs. Follows and collection/item likes are signed off-chain relations with unique actor-target pairs and idempotent add/remove; they do not change NFT ownership. Followers/following lists paginate and reflect actual relations. Profile unlock restores/unlocks only the local matching identity; there is no server-side password recovery. A profile’s sent history represents observed transfers and previous public possession, not current authority.

Every public profile, collection, and selected artwork has server-rendered page-specific metadata and a unique, versioned 1200×630 OG image. Full behavior, publication controls, and cache semantics are in `PAGES-AND-SHARING.md`. Social previews contain only sanitized public art/profile data and never a transfer key or recovery material.

The D1 gallery is a discovery index. Contract state resolves ownership and conflicts. When the RPC fails, show `Ownership unavailable`; local images remain viewable and export is disabled until a fresh ownership check. A gallery outage must not prevent file verification or an independently submitted claim.

## 9. Product limits and success criteria

Free means sponsored within visible quotas. Show quota exhaustion before signing; retries never become silent paid operations. Proposed devnet limits: 10 mints and 50 rotations per profile/device per day, supplemented by global gas budget and abuse controls. These are policy defaults for review, not deployed promises or sufficient Sybil protection by themselves.

Release acceptance: two clean browsers complete mint → file export → claim → re-export → claim, with old-copy rejection; cancel races behave correctly; pending-key persistence survives closing the browser; updated recovery restores current authority; sanitized gallery assets contain no transfer keys; operation state survives reorgs; a phone can complete the same flow with keyboard/screen-reader accessible controls.

Independent source/spec verification of ZVM, finality semantics, relay/deployment compatibility, and reset policy precede a public beta. The devnet can reset. Users must see the network beside consequential actions. Mainnet and asset sales require their own review gates.
