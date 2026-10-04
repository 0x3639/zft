# ZFT product and protocol specification

Version: draft 0.1 · 2026-10-04 · review before implementation.

Implementation note (2026-10-04): work is authorized and a first devnet slice is running. [DEVNET-ALPHA.md](DEVNET-ALPHA.md) is the authoritative implemented subset. Its frozen `zft-png/1` codec normalizes JPEG/PNG inputs to RGBA PNG and exports `zfTA` PNG envelopes. JPEG APP15 export, broader color-profile conversion, and the complete social/OG release remain planned below.

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

The v1 canonicalizer must be deterministic and versioned. It decodes with fixed limits, applies orientation, converts to the specified sRGB representation, removes private/ancillary metadata, and writes through a pinned JPEG/PNG codec. Preserve PNG transparency. Do not depend on browser canvas JPEG output for canonical consensus. Select the codec and exact encoder settings in the image-codec milestone; freeze golden vectors before issuing live files.

Incoming files: JPEG or PNG only, maximum 10 MiB and 24 megapixels. Reject animated PNG, malformed structure, unsupported bit depth, multiple ownership envelopes, and decompression bombs. Enforce decoded-memory and output-size limits before allocation. Accept the final normalized format only after local preview. Source photos may contain private metadata; normalization occurs locally before upload.

After minting, do not normalize or re-encode the image again. To verify an exported file, remove exactly its ZFT envelope and hash the remaining canonical image bytes. Editing, screenshots, compression, or metadata-stripping services may break transferability. The user should send the original file as an attachment.

Metadata is a compact, immutable JSON document serialized using RFC 8785 JCS. It includes title, description, canonical image URL/hash, canonicalizer version, dimensions, media type, creator profile address, and mint timestamp supplied in the signed metadata. Use strings for large numbers. `metadataHash = SHA-256(JCS(metadata))`. The contract stores this digest and derives a URI under the deployment’s fixed metadata origin. The browser verifies fetched metadata against the digest. Display names and collection grouping are off-chain and can change without modifying the NFT.

Art and metadata are content-addressed R2 objects. Hosting availability remains an application dependency; exported files carry image bytes and metadata so owners have an independent copy. Standard marketplace renderers rely on the metadata URI and do not automatically verify its hash.

## 4. Ownership and recovery

Generate a fresh secp256k1 key for every newly minted or claimed item using browser cryptographic randomness. A key address holds one ZFT item in the supported app flow. Do not embed a connected wallet’s private key, the vault root, the creator identity key, or the sponsor key. File export embeds only that item’s disposable current key.

A separate local profile key signs creator mints and profile operations. It is not the current owner of all items. Both profile and asset keys live in an encrypted IndexedDB vault. The vault has a random 256-bit root; derive its encryption key with domain-separated HKDF-SHA-256 and use AES-256-GCM with a fresh IV per record. Bind chain ID, contract address, record ID, and format version as authenticated data.

Persist the root locally only encrypted by a user-chosen unlock passphrase using PBKDF2-HMAC-SHA-256, random salt, 600,000 iterations, and AES-256-GCM. Measure this on supported phones and permit a versioned future KDF migration. The passphrase is never sent to Cloudflare. Close/lock clears in-memory key references on a best-effort basis; JavaScript memory cannot guarantee secure erasure.

The recovery bundle contains the random root, profile key material encrypted under that root, and a snapshot of encrypted item records. It is a **secret bearer backup**, saved locally after explicit confirmation; explain that anyone with it can recover the vault. Version it and optionally offer password encryption in a later release. Require the first bundle download and acknowledgment before the first mint/claim. After every new ownership key is finalized, mark the bundle out of date and offer an updated export. A snapshot only restores keys it contains; the root alone does not recreate independently random keys acquired later.

Do not promise automatic recovery across devices in v1. Losing all current keys and backups loses control; there is no administrator recovery. Saving an exported item file is another backup, but anyone receiving it can race the owner to claim.

## 5. Mint

1. Unlock or create the vault; confirm the recovery bundle.
2. Read the image locally, normalize it, and display the exact canonical result.
3. Generate/persist the item key and draft metadata before sending a mint request.
4. Upload sanitized canonical art and metadata. Backend verifies hashes and structure and issues a short-lived upload attestation for sponsorship policy.
5. Sign a domain-bound `Mint` authorization with the profile key. It binds the image/metadata hashes, initial item owner, creator nonce, and deadline.
6. Sponsor simulates, signs, and submits the fixed contract call through ZVM’s relayed EVM path.
7. Show submitted, included, and finalized states separately. If the transaction is lost or reorged, reconcile using token ID, mint signer nonce, and receipts before retrying.

Onchain uniqueness decides a simultaneous duplicate-mint race. A duplicate response links to the existing item rather than presenting an owned mint. An uploaded object or server receipt does not prove mint success. Persist the draft key until the outcome is known.

## 6. Send, claim, and cancel

**Send:** Read current `ownerOf` and `ownershipNonce`, verify local authority, then construct an export file. Downloading does not submit a transaction. The exported envelope has the current nonce and key. Set local state to `Exported · still yours until claimed`; repeated exports share the same authority. An intentional public preview contains no envelope.

**Claim:** Parse locally; validate file/hash/metadata; require an allowlisted network and contract deployment; verify the key derives to the current owner and the embedded nonce matches the chain. The browser creates a fresh recipient key and persists it as a pending record **before signing or submitting**. Sign a `RotateOwnership` message with the imported key, binding token ID, current epoch, fresh address, and expiry. Sponsor can forward but cannot change the recipient. Once finalized, the imported old key is stale and the fresh key is the recipient’s authority. Exporting again produces a new file.

**Cancel:** The sender rotates the exported item to a freshly generated local key using the same on-chain operation. Previously sent files stop working after finality. Cancel and claim can race; whichever valid transition the chain orders first wins. No refund/reversal or guarantee of sender priority is implied.

**Concurrent claim:** Two different recipients can make individually valid signatures from the same copied key. Exactly one transition succeeds for the current nonce. The loser sees `Already claimed`; preserve their pending record until reconciliation proves it has no authority.

**Reorg/retry:** Never delete the previous key or pending new key merely because one confirmation appeared. Keep a bounded transition journal through finality and a documented retention window. If a receipt disappears, re-read owner and nonce, reconcile against the same authorization digest, and retain keys for both outcomes until resolved. Do not assume a server job’s `finalized` label is authoritative when the node is unavailable.

## 7. File envelope v1

Use one JPEG APP15 segment beginning with `ZFT\0`, or one PNG private ancillary chunk `zfTA` (unsafe to copy after image editing). Payload is UTF-8 canonical JSON, maximum 16 KiB. Validate JPEG segment bounds and PNG chunk bounds/CRC. Unsupported versions fail closed.

```json
{
  "format": "zft",
  "version": 1,
  "canonicalizer": "zft-image/1",
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

Publishing a card or grouping it into a collection is optional. A profile operation must be signed by the profile key. Display current ownership only after live contract verification. A public card can show a fresh possession attestation signed by the item key and bound to profile ID, token ID, owner address, ownership nonce, and expiry. A copied or stale attestation cannot establish current control.

Replicate the reference public profile surface: cover/avatar, name/bio, shortened copyable identity, share control, collected/sent/likes/followers/following counts, and Collection/Sent/Activity tabs. Follows and collection/item likes are signed off-chain relations with unique actor-target pairs and idempotent add/remove; they do not change NFT ownership. Followers/following lists paginate and reflect actual relations. Profile unlock restores/unlocks only the local matching identity; there is no server-side password recovery. A profile’s sent history represents observed transfers and previous public possession, not current authority.

Every public profile, collection, and selected artwork has server-rendered page-specific metadata and a unique, versioned 1200×630 OG image. Full behavior, publication controls, and cache semantics are in `PAGES-AND-SHARING.md`. Social previews contain only sanitized public art/profile data and never a transfer key or recovery material.

The D1 gallery is a discovery index. Contract state resolves ownership and conflicts. When the RPC fails, show `Ownership unavailable`; local images remain viewable and export is disabled until a fresh ownership check. A gallery outage must not prevent file verification or an independently submitted claim.

## 9. Product limits and success criteria

Free means sponsored within visible quotas. Show quota exhaustion before signing; retries never become silent paid operations. Proposed devnet limits: 10 mints and 50 rotations per profile/device per day, supplemented by global gas budget and abuse controls. These are policy defaults for review, not deployed promises or sufficient Sybil protection by themselves.

Release acceptance: two clean browsers complete mint → file export → claim → re-export → claim, with old-copy rejection; cancel races behave correctly; pending-key persistence survives closing the browser; updated recovery restores current authority; sanitized gallery assets contain no transfer keys; operation state survives reorgs; a phone can complete the same flow with keyboard/screen-reader accessible controls.

Independent source/spec verification of ZVM, finality semantics, relay/deployment compatibility, and reset policy precede a public beta. The devnet can reset. Users must see the network beside consequential actions. Mainnet and asset sales require their own review gates.
