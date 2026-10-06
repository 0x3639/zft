# Reference page parity and social sharing

Draft 0.1 · required by the user on 2026-10-04. Match NonFungible Cash’s page composition and flows while applying the pinned Zenon theme. Public profile/social/OG features are included in the first beta; live trading is a separately reviewed expansion.

Updated audit and route status: the [complete functional specification](FUNCTIONAL-SPEC.md) is the central website contract, and the [action ledger](REFERENCE-AUDIT.md) records the expanded click-through results, download inspection, and owner-only gaps. This document retains detailed OG/cache and screenshot requirements. Its requirements are not a claim of completed parity; [DEVNET-ALPHA.md](DEVNET-ALPHA.md) identifies the deployed subset.

## 1. Direct reference observations

The supplied [MK Curator profile](https://nonfungible.cash/p/ebb88e60451df894c0510b1476d4f5ef367105ae7f5acad64ecb7a06fb6ccfa5) has cover art, avatar, name, shortened/copyable public identity, collection like, follow, share, unlock, five counts, Collection/Sent/Activity tabs, a re-verification action, and artwork cards. Selecting artwork opens a detail dialog and adds `?nft=<id>` to the profile URL. The detail has artwork/proof views, asset hash, collector identity, ownership-check states, save-image and public-proof controls. Public image/proof downloads contain no transfer credential.

Fetched initial HTML demonstrated **distinct profile and selected-artwork metadata**, before any browser JavaScript:

| Public URL | Observed share behavior |
| --- | --- |
| `/` | Brand homepage title/description and default image `/assets/og-2.png` |
| `/p/<profile-id>` | Profile-specific title/description and `/api/og/p/<profile-id>.jpg?v=<revision>` |
| `/p/<profile-id>?nft=<item-id>` | Artwork-specific title/description/`og:url` and `/api/og/p/<profile-id>/<item-id>.jpg?v=<revision>` |

The observed images are 1200×630 and include `og:image:alt`, dimensions, and Twitter `summary_large_image`. The inspected profile card contains its avatar/name, counts, and overlapping featured artwork cards. ZFT should reproduce this semantic behavior with its own branding and public art. This is a verified behavior for the inspected routes, not a claim that every possible reference URL uses unique metadata.

The expanded HTTP/visual audit in §10 confirms the actual NFT pixels are composited into these images. Initial reference HTML supplied `og:url`; a `link rel="canonical"` element was absent on all seven pages fetched in that pass. ZFT still requires both fields. Reference revision hashes and their invalidation algorithm have not been reverse-engineered.

## 2. Route and page inventory

| Reference surface | ZFT production route and behavior |
| --- | --- |
| Homepage | `/`: split hero, preview cards, collections, fresh mints, activity, explanations, CTA |
| Explore | `/explore`: public collection discovery; `/explore/nfts`: artwork discovery; bounded filters and pagination |
| Activity | `/activity`: actual indexed mint/transfers and signed social activity; filtering/pagination |
| How it works | `/how-it-works`: product basics plus honest technical/protocol view |
| Public profile / default collection | `/p/:profileAddress`: cover/avatar, identity, bio, counters, likes/follows/share, tabs |
| Profile-selected artwork | `/p/:profileAddress?nft=:tokenId`: same profile background with deep-linked artwork/proof dialog and item-specific OG |
| Standalone artwork | `/item/:tokenId`: canonical detail/share page; client can render full-page mobile view |
| Additional curated collection | `/c/:collectionId`: public collection name/cover/curator/item set; default profile is not another on-chain contract |
| My local collection | `/collection`: local owned/exported/sent states and backup status; generic safe share metadata only |
| Mint/create | `/mint`: local image normalization, metadata, publication choice, recovery gate, signed mint |
| Import | `/claim`: implemented local file parse/verify/claim; no secrets in URL or server-rendered content |
| Recovery/unlock | `/recovery` and local collection unlock: encrypted local vault, backup import/export, matching profile unlock |
| Market | `/market`: designed now; actual listing/offer/purchase integration ships after marketplace review |
| Encrypted claim link | `/claim/:id#<key>`: later release, separately reviewed capability/link protocol |

The table includes implemented and planned surfaces; see the functional specification's status column. Prototype hash routes are a temporary navigation mechanism. They cannot provide real per-route crawler metadata because fragments are not transmitted in HTTP requests. Production uses path/query routes intercepted by the Worker. Profile IDs are EVM profile addresses rather than Cashu profile keys; token IDs are deterministic image-hash integers rather than reference-specific opaque IDs. Earlier `/import` and `/settings/recovery` proposals may become compatibility redirects; they are not current implemented routes.

## 3. Profile and social requirements

Cover and avatar uploads follow sanitized image constraints; default them to public art or a deterministic avatar when absent. Collection counts use published/current possession attestations plus live indexed ownership; sent history comes from observed past transitions. Likes/follows use unique signed actor-target relations, are reversible, and update counts consistently. Followers/following open paginated lists. Re-verify refreshes current owner/nonce and attestation status; an outage produces `Could not check`, never a false invalidation.

Only a locally unlocked matching profile can edit its identity fields. A public visitor sees Follow/Like/Share; an owner sees Edit/Manage plus local unlock/backup context. A user can have local items without a public profile. Do not publish an imported NFT or identify its recipient profile without opt-in.

Artwork detail preserves the reference’s distinction between public art/proof and transferable files. `Save image` exports a sanitized preview only. `Public proof` exports the non-secret attestation, image/metadata digests, chain/deployment, observed owner/epoch/block, and verification instructions. It is evidence at a stated observation point, not a perpetual current-owner certificate. `Send collectible` is available only in the local owner context and contains secret authority.

Implemented alpha parity includes signed profile text/featured-item editing, social relations, follower directories, paginated public lists, and unique profile/item/static PNG sharing. The next implementation adds the proof-card/Network dialogs, historical epoch context, and public-observation JSON v2 containing the signed item-owner possession statement. Independent cover/avatar uploads, portable profile-key endorsements, complete activity/discovery parity, and market settlement remain incomplete. Public-proof JSON remains a labeled RPC observation, with independently verifiable signatures where present. The standalone prototype's simulated actions must not be confused with these real services.

## 4. Unique Open Graph images

Templates:

- **Homepage/static public page:** page-specific headline, short description, Zenon/ZFT mark, sample or curated public artwork; root, explore, activity, how-it-works, and market have distinct identities.
- **Profile:** avatar/name, public item count, selected public follower/like count, two or three featured art cards, `zft.foo`, and network label.
- **Collection:** cover/name, curator, public piece count, representative art cards, network.
- **Artwork:** title, creator/collection, one large art card, edition/network, ZFT branding. No private key or ephemeral assertion of current ownership in a cached image.

Output: PNG, exactly 1200×630, sRGB, target under 1 MiB. Use a fixed dark Zenon theme for predictable previews; the site’s visitor theme does not alter the shared image. Supply actual Space Grotesk/JetBrains Mono font bytes to the renderer, with licenses bundled. Never rely on Google Fonts requests during generation.

Use a small deterministic Satori template → SVG → resvg-WASM PNG pipeline in a Worker, contingent on a runtime/CPU canary. Satori only supports a CSS subset, so port the approved HTML composition to supported flexbox styles and resolve semantic tokens before rendering. Treat `design/og-preview.html` as a browser design reference, not code that can be passed unchanged into Satori. If runtime limits fail, use a bounded queued Cloudflare Browser Run renderer as the documented fallback; account for its separate service cost before enabling it.

Read sanitized images from bound R2 objects, resize to known limits, and embed bytes. Resolve at most three public artwork images plus an avatar. Do not fetch arbitrary URLs from a metadata document. Bound title/bio lengths and glyph handling; escape text; truncate with tested line limits. Reject unknown page IDs and oversized inputs before invoking a renderer. Failed generation gets a page-specific safe text card, not an unbounded browser retry.

## 5. Revisions, caching, and publication

`revision = SHA-256(JCS({templateVersion, themeVersion, public page id, profile/metadata version, selected art hashes, displayed counts, network}))`.

On publication and relevant profile changes, generate and store the immutable PNG at `og/<kind>/<pageId>/<revision>.png` in R2. A queue/DO coalesces regeneration bursts from likes/follows. Share head resolves the latest ready revision. Example public endpoints mirror the reference pattern:

```text
https://zft.foo/api/og/p/<profile>.png?v=<revision>
https://zft.foo/api/og/p/<profile>/<tokenId>.png?v=<revision>
https://zft.foo/api/og/c/<collection>.png?v=<revision>
https://zft.foo/api/og/item/<tokenId>.png?v=<revision>
```

Known immutable revisions can be cached long-term. Mutable HTML heads use a short TTL and purge/revalidation on publication/profile changes. The cache key must include page kind, validated ID, selected token query, revision, and deployment/network. Never let a profile-selected item receive the profile-only cached image. ETags and content digests identify snapshots. Unknown `v` values are rejected rather than causing attacker-controlled unbounded generation.

Private profiles/items receive generic safe metadata or a 404, with no private name/art/count leak. Unpublishing removes the public page/image mapping and invalidates Cloudflare caches, but external social platforms may retain already scraped public images; state this in publication settings. Previously public on-chain art/metadata remain public, regardless of gallery unpublishing. No recovery bundle, browser collection contents, claim-link fragment, or item secret enters OG data.

## 6. Initial HTML and metadata

The Worker selects the public page snapshot, obtains the matching ready OG revision, and rewrites the SPA shell’s head before returning it. Emit one title, canonical URL, description, `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`, width/height/type/alt, and corresponding Twitter tags. Use absolute HTTPS URLs under the configured `zft.foo` origin, never the client-supplied Host header. Validate the `nft` query belongs to the requested public profile context; if invalid, return a safe not-found state, not another person’s unpublished item.

Render the same metadata for browsers and crawlers. Do not depend on React effects, hash routes, or JavaScript execution by social bots. Query canonicalization strips unrelated tracking parameters while preserving the selected artwork identity. A public bootstrap JSON payload must escape script-closing text and contain only public, bounded fields.

## 7. Acceptance

Fetch HTTP HTML with JavaScript disabled for home, two different profiles, two artworks under one profile, an additional collection, and a private/nonexistent route. Verify correct canonical/OG/Twitter fields and no duplicate generic tags. Fetch each image unauthenticated: image/png, 1200×630, unique expected content, font rendering, title bounds, correct selected artwork, and no credentials.

After a profile changes cover/name/featured art, its head changes to a new image revision without mutating the old snapshot. Repeated image requests hit cached R2 content. Test cache isolation between profiles and query-selected items, long titles, missing art, unsupported characters, private publication toggles, malformed IDs, and renderer failures. Inspect actual previews with the target platforms before beta; their recrawl timing remains external behavior.

Primary technical references: [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/), [Satori](https://github.com/vercel/satori), [resvg](https://github.com/thx/resvg-js), [Cloudflare OG tutorial](https://developers.cloudflare.com/browser-run/how-to/og-images-astro/).

## 8. Action-by-action reference audit

Inspected 2026-10-04 against ZFT implementation commit `53eb78b`. This is a public/visitor-session audit of the supplied [MK Curator profile](https://nonfungible.cash/p/ebb88e60451df894c0510b1476d4f5ef367105ae7f5acad64ecb7a06fb6ccfa5), its collected and sent item dialogs, follower network, onboarding/unlock dialogs, and linked discovery, activity, market, homepage, and help pages. The follow-up pass exercised the guest like/follow gates, sorting/pagination, profile lookup, and actual image/proof downloads; details are in [REFERENCE-AUDIT.md](REFERENCE-AUDIT.md). No collection was created, existing private key entered, authenticated follow/like created, or offer funded. Owner-only menus remain unverified; the help page provides separate evidence for some owner flows. Visible controls are not evidence that their eventual mutations succeeded.

### Public profile

| Action or state | Reference observation | ZFT at the audited commit | Required parity work |
| --- | --- | --- | --- |
| Copy public identity | Short identity button exposes the full public key as its copy target | Copyable profile address exists | Preserve feedback and accessible full address |
| Like/unlike | Guest heart click opened onboarding; authenticated toggle not tested | Signed reversible relation exists | Display the count with the action; preserve guest intent through unlock |
| Follow/unfollow | Guest follow click opened onboarding; authenticated toggle not tested | Signed reversible relation exists | Preserve target/action through unlock instead of sending visitors to a generic collection screen |
| Share profile | Click produced profile-link-copied feedback | Copies profile URL | Existing behavior; retain profile-specific OG metadata |
| Unlock | Dialog accepts an existing collection key and explains local storage | Unlock/recovery is on the local collection screen | Add a profile-context entry that checks the unlocked identity; adapt to ZFT vault/recovery semantics |
| Collected / Sent / Likes counts | Three summary values; Followers and Following are separate buttons | Six counts including Created; all currently rendered as links, including Likes linking to Created | Distinguish informative counts from actionable controls; remove misleading Likes navigation |
| Followers / Following | One Network dialog with two tabs; each entry opens another profile; Following had an empty state | Separate in-profile directory views | Match dialog, tabs, profile navigation, empty states, keyboard dismissal, and focus return |
| Collection tab | Default view; two current holdings on inspected profile | Default is Created, with Collection as a separate tab | Make public collector profiles collection-first; keep creation provenance as an additional view |
| Sent tab | Historical item stays visible and is labeled transferred | Published holdings with a changed epoch appear; opening goes to generic item route | Preserve historical collector context and distinguish transfer from self-rotation/cancellation |
| Activity tab | Mint, like, and collection-creation entries with relative times; profiles and items are clickable | Profile feed is creation-related chain transfers, linking to explorer transactions | Add public social/profile events and app navigation; retain explorer as a secondary proof link |
| Re-verify | Profile-level action is present and clickable; no lasting visible feedback was observed in this session | Refresh reloads indexed profile data; item detail separately checks live chain state | Verify the displayed holdings with bounded live reads and show per-item checking/current/transferred/unavailable results |
| Cover / avatar | Custom images visible; editing controls not accessible as a visitor | Featured-item cover and initial avatar | Independent sanitized image uploads are still needed; owner editing flow is not verified on the reference |

### Collected and sent artwork dialogs

| Action or state | Reference observation | ZFT at the audited commit | Required parity work |
| --- | --- | --- | --- |
| Open artwork | Modal over the profile; adds `?nft=<id>` | Implemented for current profile membership | Keep deep-link and browser-back behavior; add explicit historical context |
| Close | Returns to the profile and removes selected-item query | Implemented with close button and Escape | Preserve selected tab and focus the originating card |
| Flip / show front | Switches between artwork and a compact ownership-proof face | Static art beside expanded on-chain data | Add an accessible two-face card, including reduced-motion behavior |
| Current holding status | Separate checks for credential validity, collector signature, and unspent/current ownership | Metadata digest verified and live on-chain owner/epoch displayed | Show separate ZFT-appropriate checks: content/metadata integrity, signed profile possession binding, current contract owner/epoch, and observation block |
| Transferred status | Sent item retains valid historical proof and collector signature, but clearly says it is no longer held here | Generic detail shows current owner without the prior collector's context | Historical proof must remain labeled historical; a valid signature alone must never imply current ownership |
| Copy asset / collector | Both values have copy controls | Public detail shows full hashes; creator is a navigation link | Add copy controls for asset digest, profile, owner, and token where appropriate |
| Save image | Download action and explicit non-transferable disclosure | Sanitized public image download exists | Preserve disclosure; do not attach item secrets |
| Public proof | Downloaded JSON parsed: public showing, profile signature, status, asset/collector IDs, mint public verification material; reference cryptography not independently verified | Downloads a JSON chain observation, not a cryptographic ownership certificate | Include the public signed possession attestation where available, verification instructions, expiry, and observed block; label absent attestation honestly |
| Selected-item sharing | Opening the modal changes the shareable URL; existing research verifies unique initial HTML/OG for that context | Unique selected-item OG and an additional Share button exist | Keep share context correct for current versus historical holdings |

The inspected sent example was [MK1](https://nonfungible.cash/p/ebb88e60451df894c0510b1476d4f5ef367105ae7f5acad64ecb7a06fb6ccfa5?nft=a85ec604d7454d7cb3bca695936fbd85). Its retained proof motivated the now-implemented explicit historical-epoch context. Do not implement this by simply relaxing the current-membership guard: a historical page must validate its retained publication, clearly label the old epoch, respect unpublishing, and have a distinct sharing snapshot. Existing profile OG checks intentionally reject artwork removed from the profile context.

### Shared navigation and linked pages

| Surface | Observed actions | ZFT gap or mapping |
| --- | --- | --- |
| Header/menu | Home link, Market, menu links to Explore/Activity/How it works, onboarding button | Add a usable compact navigation menu; the live mobile header currently hides the main navigation and leaves footer links |
| Theme menu | System, light, and dark choices | Live app has a two-state theme toggle; add a persistent system option |
| Profile lookup | Dialog accepts a public key or full profile link; submitting the supplied public link returned to that profile | Add address-or-link lookup using ZFT address validation |
| Create collection | Name input, locally generated key, copy/download actions, explicit saved-key acknowledgement before creation | ZFT has encrypted vault creation and recovery-file acknowledgement; keep that model while making entry points consistent |
| Homepage | Start/import/help entry points; ranked collections with like controls; fresh-art cards; activity links; browse-all actions | Live home has the core create/import/explore flow; ranked collection discovery and embedded social activity remain incomplete |
| Collection discovery | Collections/NFTs tabs, search, popularity/newest/size sorting | Add collection directory, bounded search, sort options, and pagination; current app primarily lists artwork |
| NFT discovery | Search, newest/oldest/name sorting, item dialogs, load more | Pagination exists; search and sort are missing |
| Global activity | Everyone/Following views; guest Following state explains how to populate it | Add followed-profile filter and social events; current global feed is on-chain transfers |
| Help | Basic/technical tabs; technical view has `?view=cryptography`; buttons link between explanations and onboarding | Expand existing short explanation into ZFT-specific product and technical views |
| Market discovery | Listing search, newest and price sorting; listing cards include price and bid summary | Designed separately; no live ZFT marketplace |
| Market listing | Back action, seller/bidder profile links, bids and expiry, guest onboarding before an offer | Settlement remains a separate reviewed project; no trade was initiated during this audit |

The linked [MK3 market listing](https://nonfungible.cash/market/2a4e293ef8821d05c48a45f1c8a3b342) was inspected without entering an offer. Its Cashu payment mechanism is not a drop-in ZVM contract feature.

### Owner flows described by the reference, not exercised

The [technical help page](https://nonfungible.cash/how-it-works?view=cryptography) describes bearer-file export/claim, cancellation by rotating ownership, encrypted sharing links with an optional password, and encrypted remote backups recoverable with the collection key. The first two have working ZFT equivalents. Encrypted links and remote recovery remain deferred. ZFT's profile key alone cannot restore independent disposable item keys; do not copy a one-key recovery promise without implementing and validating the necessary encrypted backup service.

### Implementation order

Steps 1–2, mobile navigation, three-way themes, profile lookup, and the OG thumbnail/history work are implemented in the public-parity milestone. The tables above preserve the earlier audited-commit comparison; consult [the current functional specification](FUNCTIONAL-SPEC.md#15-public-parity-milestone-acceptance) for status.

1. Correct public profile semantics: collection-first navigation, informative versus clickable counts, contextual unlock, and the follower dialog. Preserve local publication consent.
2. Add the proof-card face and explicit integrity/profile-binding/current-ownership states; add historical sent dialogs and profile-wide re-verification. Include outage and self-rotation cases in the behavior contract.
3. Add search/sort discovery and social activity with meaningful app links and Everyone/Following views. This needs persisted public events; the current `relations` table records current state only.
4. Add independent avatar/cover media and finish mobile navigation, theme options, and technical help.
5. Review encrypted links/cloud recovery and marketplace settlement separately. Complete actual multi-browser/phone and operational acceptance before promoting the apex homepage.

These are gaps and acceptance targets, not features completed by this audit. The ZVM proof view must describe on-chain EVM ownership and signed possession messages; it must not claim the reference's Cashu zero-knowledge privacy properties.

## 9. Image-click modal: screenshot acceptance reference

The user's supplied 2026-10-04 screenshot of the MK1 transferred-item dialog is the visual and interaction reference for opening artwork from a profile. Apply the Zenon design system to this composition:

- Keep the profile visible behind a dimmed backdrop. Open a large rounded dialog with a prominent close control at the upper right, visible keyboard focus, Escape dismissal, and focus returned to the originating artwork.
- Use two columns on desktop. The left column is a framed collectible card: large artwork, title, shortened asset hash, and ownership-state badge. Put the Flip card action below it; the reverse shows the public proof details. Stack the columns on mobile.
- The right column starts with an ownership-state badge, title, and a dated state explanation. Show an actual recorded transition date only when available; never substitute mint time for transfer time.
- Follow with three separately evaluated verification rows: asset/metadata integrity, a signed possession attestation binding the item to this profile, and whether that attestation's owner/epoch is still current. A historical attestation may remain authentic while current ownership has changed. Missing, expired, invalid, and temporarily unverifiable proofs require distinct honest states; they do not receive a success mark.
- In the transferred state, retain the historical collector context and clearly mark that the item is no longer held under that recorded ownership epoch. Do not describe cancellation or self-rotation as a proven gift to another person.
- Below the checks, show labeled, shortened, copyable asset-hash and collector-identity values. Expose complete values accessibly.
- Place Save image and Public proof together, followed by the disclosure that these downloads contain no transfer credential. Keep ownership-bearing export actions in the authenticated local-owner flow.
- Preserve the selected-item URL and its unique OG image, including correct historical state where supported. Closing restores the profile and selected tab.

This records the required result; the audit commit's current modal does not yet satisfy this composition or all three verification rows.

## 10. NFT-populated OG images: verified reference behavior

Follow-up inspection on 2026-10-04 (local time) fetched seven public pages without JavaScript and fetched their exact `og:image` responses. Public metadata, MIME type, byte size, dimensions, cache headers, and image SHA-256 are saved in [reference-sharing.json](../research/reference-sharing.json). All seven image responses were HTTP 200, 1200×630, and had different byte digests. Five dynamic images were also opened and visually inspected in the browser: MK Curator, current MK2, historical MK1, Smoke Test Collection, and the MK3 listing. This verifies composition as well as distinct URLs; title-only differences would not prove artwork parity.

| Reference page | Actual share-image content | ZFT requirement |
| --- | --- | --- |
| MK Curator profile | Avatar/name, follower/like counts, 2-NFT badge, overlapping **MK2 and MK3 artwork** with titles | Use that collector's eligible public NFTs in a multi-card composition; theme with Zenon |
| Smoke Test Collection profile | Different avatar/name/count and **three overlapping artwork cards** for a four-item collection | Cap representative art at three; keep the true full count; handle 0/1/2/3+ items intentionally |
| MK2 selected artwork | Collector/avatar, MK2 title, collection context, **one large MK2 artwork** and edition badge | Selected `nft` must choose the exact art; it must not reuse the profile collage |
| Historical MK1 | MK1 art, former collector identity, **Sent on** badge and explanation that it moved | Retained public history gets a distinct image context with an honest historical state |
| Current MK1 under another profile | Different profile/item image URL, title, metadata and bytes from historical MK1 | Bind image revision to publication context, not just the image hash; current image pixels were fetched but not separately visually inspected |
| MK3 market listing | MK3 art, seller/avatar, sale state, **4,999 sats** price badge and bid summary | Future real listing template uses actual settlement units and listing state; no fabricated live trading data |
| Homepage | Static branded `/assets/og-2.png` | Homepage has its own identity; profile/item content is dynamically populated |

Observed dynamic routes are `/api/og/p/<profile>.jpg?v=<revision>`, `/api/og/p/<profile>/<item>.jpg?v=<revision>`, and `/api/og/market/<listing>.jpg?v=<revision>`. The inspected dynamic responses used `image/jpeg` and `Cache-Control: public, max-age=31536000, immutable`; the homepage used PNG. Both OG and Twitter image tags pointed to the same page-specific image. This observes immutable versioned responses, not the server's generation library or the full set of events that trigger a new revision.

### Required artwork selection and rendering

1. **Actual artwork is required when eligible public art exists.** A unique filename, changed title, or different accent color is insufficient. The card must show the NFT image bytes/derived thumbnail associated with that exact public context.
2. For a collector profile, choose an eligible featured current holding first, then newest published current holdings with stable token-ID tie-breaking, de-duplicate, and cap at three. Keep all cards recognizable; use individual titles where legible. If a separate Created view is shared, label that provenance context explicitly. Never silently mix previously created/sent art into a current-holdings collage.
3. For selected/standalone artwork, show exactly that NFT as the dominant image. For a historical publication, use the retained art and historical collector with the correct state. For a future market listing, use that listing's item, price/asset, seller and status snapshot.
4. Use sanitized public thumbnails generated from canonical R2 art; **never** re-encode or alter the canonical image used by token identity. Oversized but otherwise valid NFTs need bounded thumbnail generation before OG rendering. Thumbnail objects bind the original digest and transformation version and stay outside the private file/vault path.
5. Empty collections get an intentional branded empty layout. Missing/corrupt media or renderer failure gets a page-specific fallback. A large valid image should not routinely disappear merely because the OG renderer cannot decode the original within its request budget. Bound transformation work separately; do not remove the existing memory limits to force images through.
6. New public holdings, removal, ownership-context change, featured selection, displayed profile fields/counts, thumbnail/template changes, and actual market state changes must invalidate the affected share snapshot. HTML advertises the new ready revision; old responses remain immutable where publication remains eligible. External platform recrawl is a separate dependency.

### Current ZFT implementation versus this requirement

The alpha already embeds actual NFT images from R2 into generated 1200×630 PNGs. `apps/api/sharing.ts` selects up to three profile artworks and one selected/standalone item; `apps/api/og-render.tsx` draws them. [The hosted First Momentum canary](../research/sharing/page-1.png) visibly contains its real minted artwork, so the pipeline is not just a generic logo renderer.

Implementation update: profile images use eligible current holdings, with an eligible featured holding first, then publication recency and a stable token tie-breaker. Cards include titles. Selected historical epochs have distinct retained-publication guards and revisions. The streaming derivative pipeline supports canonical art up to 24 MP/10 MiB with a 65,536-pixel scanline-width bound. R4 adds independent avatar and cover rendering. Home and both discovery pages include up to three artwork candidates from their directory queries, deduplicated by token, with branded fallback during an optional discovery outage. Activity remains a branded static card; market image contexts remain future work.

### Additional acceptance evidence

Render fixtures with 0, 1, 2 and 4 distinct eligible NFTs and visually confirm exactly the intended images/counts. Use contrasting fixture artwork so omission, duplication, ordering and an incorrect collector are apparent. Test one item across standalone, current profile, historical profile and listing contexts. Inspect initial HTML and actual decoded image pixels, not only URL uniqueness or PNG dimensions. Test a valid >2 MP/1 MiB NFT through thumbnail generation, corrupt/missing art fallback, profile updates, unpublishing, membership changes, revision isolation, long titles and image crops. A selected NFT must never inherit another item's cached pixels.

## Profile media revisions (R4)

Profile and selected-artwork snapshots include optional `profileMedia` with the wallet address and immutable avatar/cover hashes. The full snapshot digest includes these references, so media changes create a new OG URL while existing public snapshots retain their old pixels. The renderer loads only the bounded admitted R2 namespace, verifies source hashes and caches 480px derivatives. Missing images fall back independently. The avatar appears beside the brand and the cover becomes a subdued background; NFT artwork remains the foreground collage. Reset does not revoke already-shared images or external social caches. Standalone item and static-page snapshots retain their prior behavior.

The hosted profile-media canary fetches the post-reset PNG, checks status/type, 1200×630 dimensions and the 1 MiB limit, and requires changed decoded pixels. It refetches the original OG URL and requires byte-for-byte equality. Renderer fixtures use the same profile title and separately assert avatar and cover pixels in regions outside the title and NFT collage, with zero matches in the missing-media fallback. The R4 fixtures also run in CI; R5 expands the total to fourteen.


## Help and sharing acceptance (R5)

`/how-it-works` and `/about` share one view resolver across browser and Worker. Basics is the default; exact `view=cryptography` selects Technical. The latter has its own title, description, canonical URL and `/api/og/page/how-it-works-technical.png?v=…` image. Both aliases canonicalize to `/how-it-works`; unrelated query values and fragments never enter sharing metadata. Help snapshots need no database reads. Existing `/api/og/page/about.png` snapshots remain readable.

The fourteen real-workerd renderer fixtures in [results.json](../research/sharing-fixtures/results.json) assert visible contrasting NFT pixels for 1/2/3 pieces, reject fourth-card pixels and require identical 3/4-card output for an otherwise identical snapshot. Zero/missing-art and both help views use branded fallbacks. Additional fixtures cover a 24 MP / >1 MiB source, independent avatar/cover regions, long titles with markup/symbols, and portrait/landscape crops. Every output is a bounded 1200×630 PNG. Titles are truncated and unsupported glyphs normalized; no remote image source is admitted.

`tests/sharing.test.ts` and `tests/help.test.ts` cover real initial HTML, help under database failure, aliases/invalid view values, exact page/revision lookup, noindex app-shell errors and existing context/unpublish guards. `scripts/check-help.ts` checks hosted HTML/canonical/image parity, distinct decoded help images, immutable repeat bytes, invalid-item shell, health and the deployed bundle hash. [Browser checks](../research/r5-ui.json) cover both views at 320/360/768/1440px, keyboard/history/task links and missing/denied/successful clipboard behavior using the real copy component in a disposable fixture.

Public profile links, artwork links, identifiers and the help deployment address use the same copy control. If automatic copy fails, a dialog shows the exact public value, offers selection for manual copying and restores focus on Escape. The success status is tied to the copied value. Future marketplace/curated-collection templates, actual social-platform caches/recrawls, and full device acceptance remain their separate roadmap gates.


## Supplied brand revision

New snapshots include `branding: "zft-2026-10"` in the snapshot digest and render the supplied outlined logo. Empty-art cards use the supplied mark. Historical snapshots without the field retain their previous wordmark/fallback and immutable pixels. The new fifteenth renderer fixture pins the legacy output hash and requires a distinct new-brand image; all existing NFT and profile-media assertions remain. See [BRAND-ASSETS.md](BRAND-ASSETS.md) for preserved originals, font provenance, served paths, regeneration and rollout status.
