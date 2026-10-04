# Reference page parity and social sharing

Draft 0.1 · required by the user on 2026-10-04. Match NonFungible Cash’s page composition and flows while applying the pinned Zenon theme. Public profile/social/OG features are included in the first beta; live trading is a separately reviewed expansion.

## 1. Direct reference observations

The supplied [MK Curator profile](https://nonfungible.cash/p/ebb88e60451df894c0510b1476d4f5ef367105ae7f5acad64ecb7a06fb6ccfa5) has cover art, avatar, name, shortened/copyable public identity, collection like, follow, share, unlock, five counts, Collection/Sent/Activity tabs, a re-verification action, and artwork cards. Selecting artwork opens a detail dialog and adds `?nft=<id>` to the profile URL. The detail has artwork/proof views, asset hash, collector identity, ownership-check states, save-image and public-proof controls. Public image/proof downloads contain no transfer credential.

Fetched initial HTML demonstrated **distinct profile and selected-artwork metadata**, before any browser JavaScript:

| Public URL | Observed share behavior |
| --- | --- |
| `/` | Brand homepage title/description and default image `/assets/og-2.png` |
| `/p/<profile-id>` | Profile-specific title/description and `/api/og/p/<profile-id>.jpg?v=<revision>` |
| `/p/<profile-id>?nft=<item-id>` | Artwork-specific title/description/canonical URL and `/api/og/p/<profile-id>/<item-id>.jpg?v=<revision>` |

The observed images are 1200×630 and include `og:image:alt`, dimensions, and Twitter `summary_large_image`. The inspected profile card contains its avatar/name, counts, and overlapping featured artwork cards. ZFT should reproduce this semantic behavior with its own branding and public art. This is a verified behavior for the inspected routes, not a claim that every possible reference URL uses unique metadata.

## 2. Route and page inventory

| Reference surface | ZFT production route and behavior |
| --- | --- |
| Homepage | `/`: split hero, preview cards, collections, fresh mints, activity, explanations, CTA |
| Explore | `/explore`: public collection/item discovery, bounded filters and pagination |
| Activity | `/activity`: actual indexed mint/transfers and signed social activity; filtering/pagination |
| How it works | `/how-it-works`: product basics plus honest technical/protocol view |
| Public profile / default collection | `/p/:profileAddress`: cover/avatar, identity, bio, counters, likes/follows/share, tabs |
| Profile-selected artwork | `/p/:profileAddress?nft=:tokenId`: same profile background with deep-linked artwork/proof dialog and item-specific OG |
| Standalone artwork | `/item/:tokenId`: canonical detail/share page; client can render full-page mobile view |
| Additional curated collection | `/c/:collectionId`: public collection name/cover/curator/item set; default profile is not another on-chain contract |
| My local collection | `/collection`: local owned/exported/sent states and backup status; generic safe share metadata only |
| Mint/create | `/mint`: local image normalization, metadata, publication choice, recovery gate, signed mint |
| Import | `/import`: local file parse/verify/claim; no secrets in URL or server-rendered content |
| Recovery/unlock | `/settings/recovery`: encrypted local vault, backup import/export, matching profile unlock |
| Market | `/market`: designed now; actual listing/offer/purchase integration ships after marketplace review |
| Encrypted claim link | `/claim/:id#<key>`: later release, separately reviewed capability/link protocol |

Prototype hash routes are a temporary navigation mechanism. They cannot provide real per-route crawler metadata because fragments are not transmitted in HTTP requests. Production uses path/query routes intercepted by the Worker. Profile IDs are the proposed EVM profile addresses rather than Cashu profile keys; token IDs are the deterministic image-hash integers rather than reference-specific opaque IDs.

## 3. Profile and social requirements

Cover and avatar uploads follow sanitized image constraints; default them to public art or a deterministic avatar when absent. Collection counts use published/current possession attestations plus live indexed ownership; sent history comes from observed past transitions. Likes/follows use unique signed actor-target relations, are reversible, and update counts consistently. Followers/following open paginated lists. Re-verify refreshes current owner/nonce and attestation status; an outage produces `Could not check`, never a false invalidation.

Only a locally unlocked matching profile can edit its identity fields. A public visitor sees Follow/Like/Share; an owner sees Edit/Manage plus local unlock/backup context. A user can have local items without a public profile. Do not publish an imported NFT or identify its recipient profile without opt-in.

Artwork detail preserves the reference’s distinction between public art/proof and transferable files. `Save image` exports a sanitized preview only. `Public proof` exports the non-secret attestation, image/metadata digests, chain/deployment, observed owner/epoch/block, and verification instructions. It is evidence at a stated observation point, not a perpetual current-owner certificate. `Send collectible` is available only in the local owner context and contains secret authority.

Prototype parity: profile cover/avatar/counts/tabs, local follow/like/share states, item details, recovery and the three OG template families are inspectable. Live follower directories, editable profile/upload forms, cryptographic public-proof download, pagination, and market settlement are specified for implementation, not faked as completed services.

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
