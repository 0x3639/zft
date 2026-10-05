# NonFungible Cash action audit

Inspected 2026-10-04 in a guest browser session. This ledger accompanies the [complete ZFT functional specification](FUNCTIONAL-SPEC.md). It records reference behavior, not ZFT implementation completion. Dynamic counts, dates, and record names are inspection-time examples.

**Coverage:** the supplied profile and linked home, discovery, activity, help, market and guest dialogs were explored by clicking controls. Repeated dynamic cards were sampled to cover their action types; this is not a claim to have clicked every record on the service. Owner-only actions and payment execution remain unverified. Creating a disposable test collection and saving its generated key require the pending user approval; no collection was created and no payment, offer, or ownership transfer was submitted during this audit.

Legend: **Exercised** = clicked/entered and observed the stated result; **Observed** = visible but final operation not run; **Documented** = described by the reference help, not independently tested; **Pending** = requires an owner session, funds, or another acceptance pass. A click followed by unchanged UI is not recorded as a successful backend operation.

## Sources and fixtures

- [Homepage](https://nonfungible.cash/), [collections](https://nonfungible.cash/explore), [NFTs](https://nonfungible.cash/explore/nfts), [global activity](https://nonfungible.cash/activity), [help](https://nonfungible.cash/how-it-works), [technical help](https://nonfungible.cash/how-it-works?view=cryptography), [market](https://nonfungible.cash/market).
- [MK Curator](https://nonfungible.cash/p/ebb88e60451df894c0510b1476d4f5ef367105ae7f5acad64ecb7a06fb6ccfa5): 2 collected, 1 sent, 1 like, 2 followers, 0 following at inspection.
- [Current MK2](https://nonfungible.cash/p/ebb88e60451df894c0510b1476d4f5ef367105ae7f5acad64ecb7a06fb6ccfa5?nft=43e5d084b5e340b8afd664c2e661602c).
- [Historical MK1](https://nonfungible.cash/p/ebb88e60451df894c0510b1476d4f5ef367105ae7f5acad64ecb7a06fb6ccfa5?nft=a85ec604d7454d7cb3bca695936fbd85) and [current MK1](https://nonfungible.cash/p/91760d0abdfb8cd351aaee1252056a1170c10fa24347dda3448053dc493337e1?nft=36308438d38b43a5834bc1811ab02f8a). Same asset hash `6693eebe7cae2d2e3f6976bec32219bea718a46b71d89a605a2490bc9e02258d`; different publication/credential context.
- [MK3 listing](https://nonfungible.cash/market/2a4e293ef8821d05c48a45f1c8a3b342): 4,999 sats and one bid visible. Offer semantics described by the page were not executed.
- User-provided screenshot of MK1's transferred-item dialog, 2026-10-04 at 6:09 PM. Its composition is recorded in [PAGES-AND-SHARING §9](PAGES-AND-SHARING.md#9-image-click-modal-screenshot-acceptance-reference).

## Navigation and homepage

| ID | Control | Evidence/result | Coverage |
| --- | --- | --- | --- |
| NAV-01 | Brand link | Returned to `/` | Exercised |
| NAV-02 | Menu → Explore, Activity, How it works | Opened the corresponding path pages | Exercised, each item |
| NAV-03 | Header Market | Opened market directory | Exercised |
| NAV-04 | Footer Explore, Activity, How it works | Opened the corresponding pages | Exercised, each link |
| NAV-05 | Theme choices | Dark, Light, System selected; button reflected the choice; restored System | Exercised; cross-session persistence not tested |
| NAV-06 | Open by public key | Opened Find a profile dialog | Exercised |
| NAV-07 | Lookup with full reference profile URL | Returned to MK Curator | Exercised |
| NAV-08 | Lookup with raw MK public key | Returned to MK Curator | Exercised |
| NAV-09 | Invalid lookup `not-a-key` | Validation toast requested a public key or profile link | Exercised |
| HOME-01 | Header Get started; hero and closing Start a collection | Each opened Create a collection; help and offer entry points opened the same form | Exercised all three homepage placements and the other gates; no creation submitted |
| HOME-02 | Already collecting? Import your key | Opened unlock/import dialog | Exercised |
| HOME-03 | Hero How it works; lower See how it works | Both navigated to help Basics | Exercised, both |
| HOME-04 | See all; Browse all; All activity | `/explore`; `/explore/nfts`; `/activity` | Exercised, all three |
| HOME-05 | Popular collection row | MK Curator profile opened | Exercised representative row |
| HOME-06 | Popular-row heart | Clicking the MK row's nested heart led to the MK profile; no creation dialog remained there, unlike the profile's own guest heart | Exercised twice with the same navigation result; possible reference bubbling behavior, not a ZFT requirement |
| HOME-07 | Fresh art and embedded feed controls | Item/actor/thumbnail controls visible; equivalent destination types exercised in discovery/global feed | Observed here; no claim every repeated homepage card was clicked |
| HOME-08 | Hero stacked preview cards/ticker | Illustrative cards labeled preview; ticker displayed mint events | Observed; refresh cadence not measured |

## Profiles and artwork

| ID | Control/state | Evidence/result | Coverage |
| --- | --- | --- | --- |
| PROFILE-01 | Public key Copy | Public-key-copied toast | Exercised |
| PROFILE-02 | Share | Profile-link-copied toast; no additional share menu observed | Exercised |
| PROFILE-03 | Guest Follow | Creation dialog and start-collection-first feedback | Exercised; no relation created |
| PROFILE-04 | Guest Like collection | Same onboarding gate | Exercised; no like created |
| PROFILE-05 | Unlock | Existing-key dialog with local-storage/migration explanation | Exercised entry; no key entered |
| PROFILE-06 | Followers/Following | Network dialog with both tabs; populated followers and empty Following for MK | Exercised |
| PROFILE-07 | Follower profile navigation | errip entry opened its profile; its populated Following list linked back to MK | Exercised both directions |
| PROFILE-08 | Collection/Sent/Activity tabs | Current cards, historical card, public events respectively | Exercised, all tabs |
| PROFILE-09 | Re-verify | Clicked; no lasting feedback captured | Exercised control; backend result unproven |
| PROFILE-10 | Activity social target | Smoke Test Collection link opened that named profile | Exercised |
| PROFILE-11 | Cover/avatar/editing | Custom images visible on public profiles | Observed; owner edit controls pending |
| ITEM-01 | Collected artwork | MK2/MK3 opened detail dialog with selected-item query | Exercised |
| ITEM-02 | Sent artwork | MK1 retained proof/signature checks while labeled no longer held by this collector | Exercised |
| ITEM-03 | Current MK1 via discovery | Another collector's profile/dialog; same image hash, different item-view ID; Verifying became Verified owner | Exercised |
| ITEM-04 | Flip card → Show front | Switched to proof face and back; hash/nullifier/keyset/profile-signature labels visible | Exercised both directions |
| ITEM-05 | Asset-hash Copy | Asset-hash-copied toast | Exercised |
| ITEM-06 | Collector Copy in dialog | Public-key-copied toast | Exercised |
| ITEM-07 | Save image | Downloaded MK2 JPEG; decoded successfully | Exercised and artifact inspected; details below |
| ITEM-08 | Public proof | Downloaded JSON with public showing, signature, status, mint verification data | Exercised and parsed; cryptography not independently verified |
| ITEM-09 | Close and Escape | Dismissed dialog, removed `nft` query | Exercised; focus restoration not audited with a screen reader |
| ITEM-10 | Direct selected-artwork link and reload | MK2 dialog opened from its shared URL and reopened after reload | Exercised |
| ITEM-11 | Modal responsive layout | Desktop composition from supplied screenshot; narrow browser layout inspected | Observed; complete breakpoint/assistive-technology matrix pending |

### Download evidence

The MK2 controls saved `cashu-042cb9db47d1.jpg` (185,400 bytes, decoded as 847×798 JPEG) and `cashu-proof-042cb9db47d1.json` (2,366 bytes). They were inspected locally in Downloads; reference artwork was not copied into ZFT product assets. The browser download-event watcher timed out even though the files were saved, so success was established from the actual artifacts.

The proof's top-level fields were `id`, `pubkey`, `h`, `title`, `showing`, `signature`, `status`, `created`, `sent`, `custody`, and `mint`; `mint` contained `keyset_id` and `public_key`. `sent` was null for this current item. No plaintext private-key/transfer-credential field was present. This is a schema observation, not independent validation of the showing's cryptography or an exhaustive binary secret-leak audit. ZFT must define and test its own public-proof format.

## Discovery, feeds, help, market

| ID | Control/state | Evidence/result | Coverage |
| --- | --- | --- | --- |
| DISCOVERY-01 | Collections/NFTs tabs | `/explore` and `/explore/nfts` with different search/sort sets | Exercised |
| DISCOVERY-02 | Collection name search | MK Curator reduced to one matching collection | Exercised |
| DISCOVERY-03 | Popular/Newest/Biggest | Each selected; Biggest showed 100-item collections first | Exercised; exact ranking algorithm unknown |
| DISCOVERY-04 | Collection Load more | 24 → 48 collection cards | Exercised |
| DISCOVERY-05 | NFT title search | MK returned MK1, MK2, MK3 | Exercised |
| DISCOVERY-06 | Newest/Oldest/A–Z | Each selected; A–Z ordered MK1/MK2/MK3; Oldest MK2/MK1/MK3 | Exercised; sort tie rules unknown |
| DISCOVERY-07 | NFT Load more | 24 → 48 artwork buttons (excluding footer lookup button) | Exercised |
| DISCOVERY-08 | NFT no-results search | Deliberately unmatched text produced no-results guidance | Exercised |
| DISCOVERY-09 | Open artwork | MK1 opened its current collector's selected-artwork URL | Exercised |
| ACTIVITY-01 | Everyone/Following | Global feed and guest explanation for an empty followed feed | Exercised |
| ACTIVITY-02 | Load more | Expanded event controls from 30 to 60 rows | Exercised; counts inferred from three controls per row |
| ACTIVITY-03 | NFT title | Nonmonke-01387 opened profile-selected item detail | Exercised |
| ACTIVITY-04 | Actor/thumbnail repetitions | Repeated public profile/item action types visible | Observed here; related profile/item navigation exercised elsewhere |
| HELP-01 | Basics/Cryptography tabs | Switched views; technical query became `?view=cryptography` | Exercised both tabs |
| HELP-02 | Inline cryptography link; Read the cryptography | Both selected technical view | Exercised |
| HELP-03 | Create a collection | Opened guest creation dialog | Exercised entry only |
| HELP-04 | Send/cancel/encrypted links/remote recovery explanation | Technical page describes these owner features | Documented, not owner-tested |
| MARKET-01 | Search | MK3 filtered to its listing | Exercised |
| MARKET-02 | Newest/price ascending/price descending | All selected; ascending began 420/1,000/2,100 sats, descending 210,000,000/100,000,021/100,000,000 | Exercised; values are inspection-time examples |
| MARKET-03 | MK3 listing | Listing detail opened with amount, bid, expiry, seller, prepaid-offer explanation | Exercised |
| MARKET-04 | Bidder dean; seller MK Curator | Each opened the corresponding named public profile | Exercised both |
| MARKET-05 | Start a collection to make an offer | Opened creation dialog | Exercised gate; no offer made |
| MARKET-06 | Back to Market and browser Back | Returned to expected listing/directory destinations | Exercised |

## Owner and consequential flows still to inspect

The following owner-session gaps do not apply to public OG inspection; the separate sharing checks below required no account or payment.

| ID | Flow | Current evidence | Required follow-up |
| --- | --- | --- | --- |
| OWNER-01 | Create a collection; save key; acknowledgment; submit | Name/generated-key/copy/download/checkbox/gated button observed | Authorized disposable collection; save key privately; verify resulting owner navigation |
| OWNER-02 | Unlock with valid/invalid key; lock; switch identity | Guest form inspected; empty submission did not yield clear captured feedback | Disposable identity, valid/wrong-key tests; no access to another collector's secrets |
| OWNER-03 | Edit name/bio/avatar/cover; save/reset | Public outputs visible | Inspect actual owner forms, constraints, save/conflict behavior |
| OWNER-04 | Mint; image validation; duplicate | Help describes file-based mint | Owner session and approved harmless fixture; record actual progress/error states |
| OWNER-05 | Send/export/claim/cancel/re-export | Help describes capability transfer and self-rotation cancellation | Two controlled identities/files; actual lifecycle and stale-copy results |
| OWNER-06 | Share encrypted link, optional password, claim, revoke | Help describes features | Inspect form/schema/expiry, then authorized controlled test; no private user files |
| OWNER-07 | Remote backup/recovery | Help claims encrypted backup restored with collection key | Clean-session restore test and backup limitations; do not assume equivalent ZFT behavior |
| OWNER-08 | Follow/unfollow/like/unlike while unlocked | Guest gates tested | Signed mutation outcomes/counts and following-feed behavior |
| OWNER-09 | List/unlist, funded bid, accept, refund/expiry | Listing/guest controls only | Separate owner/payment test plan; no financial execution in this audit |
| OWNER-10 | Remove local/public item; account/backup deletion | No owner controls observed | Discover actual controls before defining reference parity; consequential deletion handled explicitly |

The complete ZFT specification includes requirements for these journeys, but their exact reference controls remain open. Do not fabricate hidden-menu labels or mark them exercised from help text alone. Further findings should update this ledger and the relevant acceptance IDs in the functional spec together.

## Open Graph and artwork composition

Follow-up public HTTP/visual audit: [raw metadata and image evidence](../research/reference-sharing.json), [detailed composition and ZFT gaps](PAGES-AND-SHARING.md#10-nft-populated-og-images-verified-reference-behavior).

| ID | Check | Result | Coverage |
| --- | --- | --- | --- |
| SHARE-01 | Initial HTML, no JavaScript | Seven pages returned their own OG/Twitter metadata and advertised image URL; no canonical link tag found | HTTP verified |
| SHARE-02 | Image responses | All seven HTTP 200; 1200×630; different image byte digests; one-year immutable cache headers | HTTP/image-header verified |
| SHARE-03 | MK profile composition | Actual MK2/MK3 NFT art, titles, avatar, collection count, followers/likes | Visually inspected actual OG image |
| SHARE-04 | Different profile composition | Smoke Test Collection has different NFT art, three cards for four items, different identity/count | Visually inspected actual OG image |
| SHARE-05 | Selected NFT composition | MK2-only dominant artwork, collector/title/context, edition badge | Visually inspected actual OG image |
| SHARE-06 | Historical selected NFT | MK1 art and former collector with Sent on badge and moved-on explanation | Visually inspected actual OG image |
| SHARE-07 | Current versus historical MK1 | Different image paths/revisions, titles, profile context and bytes | HTTP verified; current MK1 OG not separately visually inspected |
| SHARE-08 | Listing composition | MK3 art, seller, 4,999 sats price, sale state and bid summary | Visually inspected actual OG image; no payment |
| SHARE-09 | Revision updates after mutations | Version query and immutable headers observed; exact algorithm and all update triggers unknown | Owner mutation/recrawl tests pending |
