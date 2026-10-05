# Review agenda

Review agenda, updated 2026-10-04. The user authorized real devnet implementation; the core public ERC-721/disposable-key/vault/Cloudflare architecture is implemented. Visual direction and `zft.foo` are confirmed. The table preserves the original recommendations; it is not a request to reapprove completed work. The [complete functional specification](FUNCTIONAL-SPEC.md) now records the website requirements and [remaining decisions](FUNCTIONAL-SPEC.md#14-implementation-sequence-and-remaining-decisions). License, marketplace/private-protocol expansions, and apex promotion remain separate decisions.

## Design decisions and recommendations

| Decision | Recommendation | Consequence |
| --- | --- | --- |
| First protocol | Public ERC-721 with disposable key rotation | File-transfer UX without private/unlinkable transfers |
| Custody | Local encrypted vault; fresh item keys; mandatory initial recovery snapshot | Simple wallet-free onboarding, with visible backup updates after new keys |
| External wallet · user direction | MetaMask on ZVM alongside disposable-key file custody | Explicit wallet/file transitions; wallet keys never enter files; connection/network/balance adapter implemented; custody transfers and trading planned |
| Hosting | Cloudflare Workers Static Assets + API, R2, D1, sponsor/index DOs | One hosting provider; external ZVM RPC still required |
| Domain · confirmed | **`zft.foo`**; user reports Cloudflare setup | Verify DNS/account configuration during provisioning; ignore earlier `zvm.foo` typo |
| Mint uniqueness | One token per canonical byte hash in one deployment | Does not establish copyright or prohibit alternate encodings |
| Contract model | One non-upgradeable deployment, no owner override | Simpler trust; contract fixes require explicit migration |
| Collections | Optional off-chain groupings inside the one ZFT deployment | No factory needed; separate creator contracts can follow |
| Fees | Sponsored devnet mint/claim/cancel within visible limits | Operator funds gas; no user payment or bridge required |
| First release | Collect/gift only, devnet beta | Karum sales and mainnet stay separate release gates |
| Visual direction · confirmed | NonFungible Cash structure + digitalSloth Zenon design system | Review the themed prototype before React implementation |
| Source license | MIT recommended; confirm before adding LICENSE | Prototype/spec currently have no project license grant |

## Important behavior to accept

- Sending/download is not a completed transfer. The sender and every recipient holding the same current file can race to claim or cancel.
- On-chain ownership history is public. No Cashu compatibility or equivalent privacy is claimed.
- Server operators have no collectible key or token override, but served JavaScript remains a custody risk when a vault is unlocked.
- Recovery bundles are secret snapshots. A new random key requires an updated snapshot; a root-only backup cannot restore future independent keys.
- Mint author identity proves consent to the mint, not art copyright. Permissionless byte-hash minting permits first-registration squatting.
- A copied signature cannot redirect a claim; a copied file can authorize another claim, intentionally.
- Cloudflare art hosting supports ordinary NFT metadata consumers, while exported files preserve the canonical image/metadata independently.
- Devnet can reset. Files bind to a particular chain and contract; reset handling requires explicit reissue.

## Review the prototype

1. Explore the gallery and open an item.
2. Switch to My collection; export a sample and inspect the exported/cancel state.
3. Open Mint, preview a local JPG/PNG or use the supplied illustration, and simulate minting.
4. Open Import and use the sample scenario; simulate a claim and the stale-file scenario.
5. Open recovery; review snapshot messaging and its acknowledgment step.
6. Inspect the same flows at phone width and with keyboard navigation.

All prototype ownership and operation states are labeled simulation. It does not create valid NFTs, secrets, backups, or network transactions. Downloaded design samples explicitly say they are not transferable.

## Implementation entry point

M1/M2 and the hosted alpha are implemented; see [the runbook](DEVNET-ALPHA.md). Next work follows the functional specification's profile/proof/discovery parity sequence, then actual browser/device and operational beta acceptance. Record changes to protocol semantics before updating code. New trading, remote recovery, and privacy protocols need their own concrete review.
