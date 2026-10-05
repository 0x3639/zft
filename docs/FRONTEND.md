# Frontend design

Visual design guide, updated 2026-10-04. Open `design/index.html` through the local preview server for the dependency-free prototype with simulated actions. The real alpha is at [devnet.zft.foo](https://devnet.zft.foo/). Use the [complete functional specification](FUNCTIONAL-SPEC.md) for current route spellings, every page's behavior, ownership/proof states, and acceptance criteria; use the [action audit](REFERENCE-AUDIT.md) for reference evidence. Prototype descriptions below do not imply parity is already implemented.

## 1. Direction

Use **NonFungible Cash’s page structure and interaction patterns**, themed with the user-selected [digitalSloth Zenon design system](https://github.com/digitalSloth/zenon-design-system). Keep the top navigation, split hero with overlapping preview cards, popular collection rows, fresh-mint gallery, activity feed, feature explanation, and bottom collection CTA. The prototype includes Market, Explore, Activity, How it works, and My collection. Market explicitly previews the planned trading expansion; beta navigation must distinguish live features from planned pages. The ZVM devnet label remains visible.

Brand: `zft.` in lowercase alongside the supplied Zenon mark. Product headline: **“The NFT is the file.”** Supporting copy explains that a JPG/PNG carries the collectible and claiming changes ownership. Avoid crypto jargon in the main flow; put contract address, token ID, epoch, hash, and explorer links in an expandable `Proof & details` area.

The prototype uses authored SVG illustrations as sample artwork. They are visual placeholders; SVG uploads are not a supported product feature. Theme tokens and primitives are copied from Zenon commit `8d2f76d74a286bd722f1fb62f280d89740ca29a8`, with its MIT license retained. Use Space Grotesk for UI, JetBrains Mono/tabular numbers for data, near-black dark surfaces, green brand/success, blue information, crimson errors, tight token-based corners, and theme-aware shadows. Reserve the plasma gradient for primary actions. Adapt the reference layout rather than copying its cartoon palette/borders. Support both dark and light themes. Self-host fonts for production; prototype font imports follow the supplied theme.

## 2. Screens and navigation

| Screen | Main action and content |
| --- | --- |
| Home `/` and discovery `/explore`, `/explore/nfts` | Hero, art grid, public collections, explanation, mint/import actions; collection directory and full sorting remain planned |
| My collection `/collection` | Local owned items; filters `Owned`, `Exported`, `Sent`; network/backup status |
| Mint `/mint` | JPG/PNG dropzone, canonical preview, title/description, publish opt-in, mint summary |
| Item `/item/:tokenId` | Large artwork, ownership state, creator, `Send this picture`, proof/details |
| Import `/claim` | Local file validation, recipient key preparation, explicit claim, outcome |
| Export item | File confirmation, download, “still yours until claimed,” cancel exported copies |
| Recovery `/recovery` | Unlock/backup status, latest snapshot export/import, lock collection |
| How it works `/about` | File semantics, copy/claim behavior, public transfer history, recovery |
| Public profile `/p/:profile` | Cover/avatar, identity, five counts, follow/like/share/unlock, Collection/Sent/Activity tabs |
| Selected artwork `/p/:profile?nft=:id` | Deep-linked public artwork/proof dialog, sanitized public downloads, item-specific share card |
| Marketplace `/market` | Sample listing grid and planned purchase custody/fee flow; settlement deferred |

The route/status table in `FUNCTIONAL-SPEC.md` distinguishes existing routes from additions. `/about` remains a compatibility help alias. Older `/import` and `/settings/recovery` proposals are not the current implemented routes.

Prototype navigation uses hash routes; production uses real routes and deep-link fallback. Marketplace prices are explicitly labeled design samples. The prototype displays no live trading volume or purported market statistics.

## 3. Explore and collection

Explore has a hero with a framed sample image/file motif, followed by a gallery of large square artworks. Card details: title, creator, and an accurately sourced state. Prefer `Creator mint`, `In your collection`, or `Ownership checked` with an observed time over an unsourced permanent “verified owner” badge. Public browsing does not expose any item key.

My collection prioritizes the current local items. An item can be locally known but no longer owned. Retain sent items in history and show when the source is unavailable. Exported items are still current until rotated. Backup status is actionable: `Backup current` or `New keys need a backup`, with a single export action. Local deletion is separate from on-chain transfer and must never imply a burn.

Empty states are concrete: “Your collection starts with one picture” and “Import the original JPG or PNG someone sent you.” Unsupported files get a direct explanation rather than a generic upload failure.

## 4. Mint flow

1. Choose a picture locally. Validate type/dimensions/size and show canonicalization progress in a worker.
2. Preview the exact canonical image and fill title/description. Explain removed photo metadata and public mint provenance. Default **profile holding association** off. The existing index discovers minted items; a future gallery visibility option does not make the underlying art or on-chain metadata private.
3. Default to wallet custody and connect MetaMask without a ZFT password. Choosing file custody offers session-only local keys or optional password-protected browser storage. Prepare and acknowledge a recovery snapshot containing the new key before submission; retain legacy encrypted-vault unlock.
4. Show `Sponsored on ZVM devnet`, expected confirmation policy, and sponsor availability. Never silently request wallet payment.
5. Persist exact consent before submission and show resumable progress in Wallet or My files. A wallet mint uses its connected address as creator/owner. File minting resumes only after its new key is backed up; after confirmation, update the snapshot reminder for changed records.

The prototype uses a demo image and allows a local JPG/PNG preview. Its “mint” updates sample collection state only. It explicitly labels the action as simulated. It does not pretend to validate canonical bytes or create a cryptographic key.

## 5. Import and claim flow

Parsing is local. Separate results: **Picture matches** (hash), **Transfer key is current** (chain), **Ready to claim** (connected wallet selected, or fresh file key prepared and backed up). In production, a stale file, unknown deployment, RPC outage, or missing backup blocks the corresponding dependent action.

Claim confirmation copy: “Claim this collectible into your collection. After confirmation, older copies of this file cannot claim it.” Main button: `Claim collectible`; secondary action: `Keep viewing`.

Persist the recipient key before enabling submission. A pending screen says “Claim submitted. Keep this browser data until the result is confirmed.” Restoring or reopening resumes the same operation. During a reorg, explain that the result is being checked rather than creating another key automatically.

The review prototype has an explicitly labeled sample-file scenario. It offers normal claim and an `Already claimed` scenario for reviewing the error state. It accepts real pictures only for local preview and does not call them verified transferable files.

## 6. Export and cancellation

Only current-authority items can be exported. The dialog shows art/title, supported network, and one concise instruction: **“Send the original file. Whoever claims it first gets the collectible.”** A preview screenshot cannot claim it.

After download, show `Exported · still yours until claimed` and a `Cancel exported copies` action. Cancellation explains that all existing copies become stale if the sender’s key rotation succeeds first. When someone claims, move the item to sent history and disable export/cancel.

The real alpha generates a PNG with the v1 `zfTA` envelope, even from a supported JPG input. JPEG export is deferred. The prototype downloads a `.txt` design sample that says it is not transferable. This distinction must remain prominent in review screenshots.

## 7. States and copy

| Technical state | User-facing copy |
| --- | --- |
| Local parse/normalize | Checking your picture… |
| Chain ownership lookup | Checking transfer authority… |
| Request accepted | Waiting to submit… |
| Broadcast | Submitted to ZVM |
| Successful receipt | Included · waiting for confirmation |
| Six subsequent EVM blocks under the app policy | Collectible claimed / Mint complete · confirmed under the app policy, not a protocol-finality guarantee |
| Nonce stale | This copy has already been claimed or canceled |
| RPC unavailable | Ownership could not be checked. Try again when the network responds |
| Sponsor disabled | Free claims are temporarily unavailable |
| Quota exceeded | Today’s free allowance is used. Your collection is still yours |
| Hash mismatch | This picture changed. Ask for the original file |
| Reset/deployment mismatch | This file belongs to an earlier devnet deployment |

Do not show a success checkmark for an upload alone. Do not mark a file unowned merely because Cloudflare or the RPC is down. User-facing “free” always has sponsor availability/quota context.

## 8. Accessibility and responsive behavior

Support desktop, tablet, and 360px mobile, with a 320px minimum stress test. Navigation wraps or collapses cleanly; artwork grid moves from three columns to two to one. Dialogs fit the viewport and scroll internally if necessary. Main touch targets are at least 44px. Titles and image labels remain visible without hover.

Use semantic buttons/links, labeled forms, meaningful image descriptions, and reduced-motion support. Dialogs have native focus behavior, close buttons, and Escape support. Announce operation status with a polite live region and failures with an alert. Error text includes a next action. Every primary flow works without drag/drop, hover, or a mouse.

Acceptance includes visual checks at 1440px, 768px, and 360px; keyboard navigation; accessible contrast and focus; large text; long titles; slow network; empty collections; and all operation states. Run automated accessibility checks in implementation, then manual screen-reader checks of mint/claim/export/recovery.
