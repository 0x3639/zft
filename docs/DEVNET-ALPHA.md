# Hosted devnet alpha

2026-10-04. The real app is deployed at [devnet.zft.foo](https://devnet.zft.foo/), with real ZVM transactions. It is not the full public beta from the specifications.

The [complete website functional specification](FUNCTIONAL-SPEC.md) covers the entire target product; the [reference action ledger](REFERENCE-AUDIT.md) records which NonFungible Cash controls were actually exercised and which owner/payment flows remain unverified. Those documents specify remaining work, not extra deployed features.

## Implemented

- Non-upgradeable ERC-721 with EIP-712 mint and ownership rotation. Every ordinary, approved, operator, and self-transfer increments the ownership epoch. No administrator or seizure path.
- React frontend using the pinned Zenon theme and self-hosted fonts: exploration, public item proof, creator pages, local collection, mint, file import/claim, export, cancellation, recovery, and lock/unlock.
- Wallet-required public profile identity and new minting, plus wallet receiving; wallet-owned tokens need no local vault or ZFT password. Account-scoped public operation journals preserve exact pending authorizations without private keys.
- File custody uses independent keys in session memory or optional password-protected IndexedDB (PBKDF2/HKDF/AES-GCM). New destination keys require a downloaded, acknowledged v1 recovery snapshot before submission. Manual lock and 15-minute inactivity lock protect remembered keys; existing vaults and v1 recovery remain compatible.
- Strict transferable PNG envelopes with hash/metadata checks, CRC validation, deployment allowlisting, large-number handling, and bounded decoding. Uploaded public art contains only PNG pixels.
- Signed single-use API challenges, R2 media adapter, fixed-contract sponsor, per-profile/IP quotas, gas caps, explicitly serialized Durable Object delivery, durable signed-transaction journal, retries by authorization digest, receipt reconciliation, and a small confirmed-mint catalog. Authentication uses its own serial critical section; read-only status checks bypass delivery waits and fail closed after five seconds. [Sponsor operation boundaries and checks](SPONSOR-OPERATIONS.md).
- Signed, versioned public profile editing; featured artwork; follow/unfollow and like/unlike; follower directories; opt-in item-owner possession proofs; collection/sent/created tabs and public profile activity; profile-selected artwork dialogs; public image and observation downloads.
- Everyone/Following activity, profile-action journal, explicit social reversals, retained-epoch publication visibility, profile/artwork links, and relative/absolute verified event times. Earlier social history is not invented.
- D1 event journal indexed independently from sponsor submissions, cursor pagination, six-block confirmation policy, serialized scans and checkpoint rewind on fork detection. Cron and rate-limited public index reads wake ingestion.
- Per-page initial HTML metadata and deterministic 1200×630 PNGs for static pages, profiles, selected artwork, and standalone items. Known revisions are stored in R2; arbitrary revision generation and unrelated profile/item contexts are rejected.
- Invalid per-token metadata is omitted from public galleries and collection previews; valid peers remain visible. Missing/invalid deep links and share-storage outages still serve the app shell with noindex metadata and the corresponding 400/404/503 status, so client error/retry states can mount.
- Basics/Technical help at `/how-it-works` (and `/about`), URL/history-aware views, task links, distinct initial HTML/OG, and public-copy fallback dialogs.
- Collection-first profile navigation; Network dialog; contextual guest unlock; mobile navigation and address/link lookup; persistent System/Light/Dark themes.
- Two-face proof card with independent integrity, owner-authorized profile binding, and live ownership checks; retained historical epochs and sanitized JSON v2 proof downloads.
- EIP-6963/MetaMask connection, pinned ZVM network add/switch, public address and devnet native-gas balance. Wallet/file custody transfers are implemented at `/wallet`; actual MetaMask/phone acceptance remains pending and trading is not implemented.
- Foundry unit/fuzz tests, TypeScript codec/vault/protocol/SQLite service tests, CI, deployment scripts, and real devnet acceptance canaries.

## Deployed contract

- Chain: **7340469**, ZVM devnet.
- Contract: [`0x42666265e38f2d1b786e8af8e9576224a95b90ae`](https://devnet.zenon.foo/explorer/address/0x42666265e38f2d1b786e8af8e9576224a95b90ae).
- Deployment block: **94013**.
- Transaction: [`0x5e368a…ee0c`](https://devnet.zenon.foo/explorer/tx/0x5e368a5357ef757d5bfd0090b73b9f3671f988a063c23023352a741f6e9aee0c).
- Compiler: Solidity 0.8.30, Cancun target, optimizer 200 runs, OpenZeppelin 5.6.1.
- Manifest: `packages/protocol/deployment.json` pins genesis, contract, runtime bytecode hash, deployment block, and metadata origin. A mismatch disables signing/submission.

The public relayer currently requires a **50 gwei minimum priority fee** that `eth_gasPrice` does not include. The first deployment was rejected for this reason. Its replacement used the same nonce and constructor data. The integration adds the observed floor to the node quote and caps total gas price at 100 gwei. Transaction gas is capped at 600,000; the sponsor reserves a maximum 0.1 devnet ZNN per UTC day. These are test funds from the public faucet.

The UI calls an operation **confirmed** after six subsequent EVM blocks. A reverted receipt also waits through those six subsequent blocks as **included** before becoming **failed**, allowing its sponsor nonce to be released and its saved authorization to be renewed. This is an application policy, not a protocol-finality guarantee. The RPC accepts `finalized`, but independently validating its semantics remains a beta gate.

## Local operation

Use Node 22.12+ and pnpm 10.14.0. All commands run from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec wrangler d1 migrations apply zft-local-index --config wrangler.devnet.jsonc --env local --local
pnpm exec wrangler dev --config wrangler.devnet.jsonc --env local --port 8787
# Second terminal:
pnpm dev
```

Open **http://localhost:5173** (use this exact origin for signed API requests). The Worker uses isolated local R2/DO storage under `.wrangler/state`. Its chain reads and transactions reach the real ZVM devnet. Keep that state between restarts: it holds the sponsor's nonce journal and admitted public artwork.

Hosted sponsorship uses its separate funded devnet account. Local sponsorship is disabled in the committed local environment; `.dev.vars.local` enables the dedicated local test account:

```dotenv
SPONSOR_PRIVATE_KEY=0x<dedicated-devnet-gas-key>
SPONSOR_ENABLED=true
```

Never use a real-money account. `scripts/prepare-devnet.ts` creates separate deployer and sponsor keys in `.local/devnet-keys.json` with restricted permissions; `--fund` and `--fund --sponsor` request free ZVM faucet funds. Existing local keys are reused. Keys and recovery files are ignored by Git. Restart Wrangler after creating/changing its secrets file.

Connect MetaMask to mint directly into the wallet, receive a transferable PNG and use the wallet address as the public profile identity. There is no local-profile selector or migration step. New minting always uses the connected wallet as creator and initial owner. Choose Make transferable file from Wallet afterward to move ownership to a fresh backed-up file key. A locked file vault does not block wallet actions. File receiving/recovery can still use a memory-only session or optional password-protected storage; file keys do not log in to a public profile. New file keys require a downloaded, acknowledged recovery snapshot before submission. Claims and cancellations follow this checkpoint too. Timeout recovery reuses the saved operation/destination. Unknown job outcomes fail closed; expired or known-reverted operations renew consent to the same recipient. Wallet drafts appear in Wallet; expired wallet claims require reopening the original file. Legacy file-mint drafts remain resumable, but new ones are no longer created by the UI.

A recovery file is a **secret bearer snapshot**, not password-encrypted transport. A browser passphrase protects stored records, not the download. Session keys disappear on reload/tab close; restore the snapshot to continue. A session can be remembered with a password after acknowledging a current snapshot. Existing encrypted vaults require their password and are never overwritten/downgraded. New keys require a newer snapshot; no administrator can recover missing keys. Legacy headers without acknowledged-key hashes require one fresh backup acknowledgment before file operations.

## Image format frozen for this slice

`zft-png/1`: accept JPEG or non-interlaced 8-bit RGB/grayscale PNG; apply JPEG/PNG EXIF orientation; strip metadata; encode 8-bit RGBA PNG with fast-png 8.0.0 / fflate settings pinned in the lockfile, compression level 6, no interlacing. JPEG decoding uses jpeg-js 0.4.4. Transparency is retained. Inputs/outputs are bounded at 10 MiB and 24 megapixels; inflated PNG bytes must match dimensions exactly before decoding.

APNG, indexed/16-bit/interlaced PNG, CMYK JPEG, and embedded ICC profiles are rejected. Convert those to an 8-bit sRGB image first. Arbitrary color-profile conversion is not implemented. Exports use one `zfTA` PNG chunk and remain viewable as pictures. JPEG APP15 export is reserved for a future explicitly versioned codec. Send `.zft.png` as the original attachment; screenshots/recompression are not transferable.

## Verification

The wallet-first hosted canary uses two isolated generated test wallets: direct wallet mint → backed-up session file → direct claim into the second wallet, plus a wallet-authenticated profile update and stale-file rejection. Three transactions confirmed at blocks 95382, 95393 and 95400. [Public evidence](../research/hosted-wallet-first.json). Run `node --import tsx scripts/check-wallet-first.ts` to resume its saved journals; all keys, recovery and bearer files stay under ignored `.local/`. This SDK check does not establish MetaMask extension or phone acceptance.

`pnpm test` includes isolated local workerd sharing tests using synthetic D1/R2/asset bindings. These require local socket access and exercise the real HTML rewriter; they do not use hosted storage, keys or chain transactions.

```sh
pnpm typecheck
pnpm test
pnpm contracts:build
pnpm contracts:test
pnpm build
pnpm worker:check
node --import tsx scripts/check-deployment.ts
```

`research/local-bytecode-verification.json` compares locally compiled runtime bytes, including Solidity metadata, to the deployed code, excluding declared constructor immutable slots. This comparison does not publish repository source. Public explorer verification is a separate operation requiring permission to publish source; its prepared script is `scripts/verify-contract.ts`.

With the local app and sponsor running:

```sh
node --import tsx scripts/devnet-canary.ts
```

This mints a generated test artwork and exercises export → claim → cancel → re-export → claim → recovery, with stale-copy rejection and duplicate-request idempotency. It writes only public transaction evidence to `research/devnet-canary.json`; bearer files and encrypted-vault snapshots remain under ignored `.local/`. This is SDK/Worker integration using isolated IndexedDB emulation, not evidence of a completed two-browser or phone acceptance test.

## Cloudflare deployment

Current R2 release: Worker version `19044da4-6ff9-4054-9a16-b58418d476d8`, including the PR #3 sharing fallback, wallet-only public identity, compact Profile navigation and icon theme menu. Wallet profile controls and file locking are in the header Profile dialog, and the theme control is an icon-only menu; saved vaults no longer insert a panel above public page content. Collection discovery, NFT title search/sorting, a live-data homepage, and separate artwork-filled home/directory OG images are deployed. Current exact-bundle, route/search/count/PNG and UI checks are in [navigation deployment evidence](../research/profile-navigation-deployment.json); earlier [PR #3 sharing checks](../research/pr3-review-deployment.json), original [R2 deployment evidence](../research/r2-deployment.json) and [browser checks](../research/r2-ui.json) are retained. Earlier wallet-first and backup-gate evidence is retained in [the PR #2 follow-up](../research/pr2-review-deployment.json).

- App: **https://devnet.zft.foo**, Worker **zft-devnet**.
- Canonical public media: **https://zft.foo/art/** and **https://zft.foo/metadata/**, routed to that same Worker. The apex homepage remains the `zft-preview` design prototype.
- D1 **zft-devnet-index**, R2 **zft-devnet-public**, Sponsor and Indexer Durable Objects, one-minute cron. Local bindings are isolated.
- Hosted sponsor **0x3FDefb23b5ccd02a9f706E478335aB000C4464d1**, funded only with free devnet ZNN. Its key is a Cloudflare secret, separate from the local sponsor and deployer. Never run two outboxes with one gas account.
- Explicit **wrangler.devnet.jsonc** keeps the legacy prototype Git deploy command separate. PR 1 is merged into main. Its prototype Git build passed; the devnet app is still deployed explicitly with its own configuration.

```sh
pnpm exec wrangler d1 migrations apply zft-devnet-index --config wrangler.devnet.jsonc --env= --remote
pnpm run deploy
```

Use `pnpm run deploy`: `pnpm deploy` invokes pnpm's unrelated built-in workspace command. `scripts/prepare-hosted.ts` provisions only the separate hosted devnet key; `scripts/publish-media.ts` copies strictly validated, already minted public art/metadata from the local app. Neither uploads vaults or transferable envelopes.

For a future Git build integration on **zft-devnet**, use build command `pnpm install --frozen-lockfile && pnpm build` and deploy command `pnpm exec wrangler deploy --config wrangler.devnet.jsonc --env=""`. Apply database migrations deliberately. Moving the apex front page to the app is a separate reviewed routing/build change; the present review build is already functional at the devnet hostname.

## Public-page behavior and verification

Profile edits require a single-use signed request and matching revision. Public possession proofs are signed by the current disposable item owner and bind the profile, contract, token, epoch, and expiry (maximum 31 days). They never transmit the key. The index suppresses holdings whose epoch/owner has changed. Removing a holding deletes its profile association; mint provenance stays public. Public cached previews can remain on other platforms.

OG rendering uses pinned Satori 0.26.0 plus resvg-WASM 2.6.2 with bundled Space Grotesk/JetBrains Mono fonts. The newer HarfBuzz-based renderer required browser facilities unavailable in the Worker canary. The deployed pipeline was tested on Cloudflare. Render at most three 480px R2 thumbnails derived from hash-verified canonical PNGs, up to 24 MP/10 MiB. The derivative decoder holds two scanlines and bounded output; originals wider than 65,536 pixels receive a text fallback. Derivatives are immutable by source hash and transform version; original bytes stay unchanged. Profile collages use current public holdings, with eligible featured art first/in front, then newest publication and token-ID tie-breaker. Image failure or output above 1 MiB also falls back to the text card. This keeps renderer memory bounded without fetching arbitrary media URLs. Profile revisions preserve old snapshots; unpublishing blocks fresh retrieval of selected-profile artwork images that no longer belong in that context. Historical selected-item routes include `epoch` and require that exact retained possession statement; creator provenance alone cannot grant a historical context.

```sh
# Local signed profiles, social idempotency, possession and six unique PNGs:
node --import tsx scripts/check-public.ts
# Hosted public acceptance, using the previously generated canary identities:
ZFT_TEST_ORIGIN=https://devnet.zft.foo node --import tsx scripts/check-public.ts
# Separate hosted transaction canary with its own saved journal/recovery files:
ZFT_TEST_ORIGIN=https://devnet.zft.foo ZFT_CANARY_LABEL=hosted node --import tsx scripts/devnet-canary.ts
```

Public results are saved in `research/public-canary.json`, `research/sharing/`, and the transaction-canary evidence. Generated recovery and transfer files remain in ignored `.local/`. SDK canaries use isolated IndexedDB emulation; they do not substitute for actual two-browser or phone acceptance.

The hosted transaction canary completed on 2026-10-04: four confirmed transactions at blocks 94503, 94510, 94517, and 94527 cover mint, claim, cancel, and second claim, followed by recovery and stale-copy checks. Public evidence is in `research/hosted-devnet-canary.json`. Hosted API admission checks also rejected cross-origin writes, unsigned requests, oversized bodies, body substitution, invalid uploads, and consumed-challenge replay. Five hosted public pages produced distinct valid sharing PNGs.

Current wallet-custody Worker version: `a5a54d62-0d22-4fd4-9355-dc0c31470c52` (2026-10-04). Contract and storage migrations are unchanged.

## Public-parity update verification

31 TypeScript tests pass, including independent proof states, wrong-profile binding, historical epoch access/unpublish, current collage selection, large PNG thumbnails, and wallet network/lookup behavior. The production frontend and Worker build pass. `node scripts/check-og-renderer.mjs` starts an isolated local workerd, renders 0/1/2/3-piece, missing-media and 24 MP fixtures, saves public evidence under `research/sharing-fixtures/`, then stops the Worker. It does not touch hosted bindings or keys. Render timing is local wall time, not a Cloudflare CPU allowance measurement.

Browser acceptance includes current three-check proof, card flip, safe public JSON download, Network/profile navigation, contextual guest unlock, keyboard dismissal/focus return, theme persistence, lookup, and 390px layout. MetaMask network/rejection behavior has mocked provider tests; actual extension, wallet account-change UI and phone transaction acceptance still need completion.

## Remaining beta gates

- Curated-collection scope and full reference-page parity. Profile media, Everyone/Following activity and Basics/Technical help are implemented; actual wallet/device and social-platform acceptance remain open.
- Independent ZVM/finality verification; controlled large/deep reorg and reset drills. SQLite regression tests cover index rollback, external transfers, and stopped ingestion on deployment mismatch.
- Local sponsor crash/restart, exact retry and nonce-refusal tests now pass; [recovery qualification and procedure](SPONSOR-OPERATIONS.md#crash-and-retry-qualification-r71) records their boundary. Controlled-chain/hosted recovery, automatic fee replacement, reorg drills, bounded journal retention, stronger Sybil admission and storage cleanup remain open. Ambiguous or conflicting nonce state deliberately stops new signing for reconciliation.
- Actual browser-to-browser and phone transactions, large-collection recovery performance, expanded accessibility testing, release/security review, and target social-platform preview checks.
- Reviewed apex homepage/Git-build promotion and approved public explorer source verification. Mainnet, monetary sales, and marketplaces remain out of scope.

## Wallet custody milestone

Open `/wallet` from the wallet controls or compact menu. Its inventory lists indexed ZFT ownership at the connected address. Live deployment/owner/metadata/epoch checks still gate every move. Wallet → file creates and saves a fresh key, requires a new acknowledged recovery snapshot, then requests the scoped MetaMask typed-data signature. File → wallet shows the full connected recipient for confirmation and signs using only the disposable local key. The existing sponsor sends both rotations; a wallet gas payment or operator approval is not required by these flows.

Saved authorization and transaction status survive reload/recovery. Unknown job failures are not treated as permission to replace keys. Expired wallet authorizations must be renewed through Wallet using the original saved destination. The vault rejects stale conditional writes so a delayed prompt or response cannot overwrite a newer custody operation. A completed return is shown as `wallet`; prior exported files are rejected against live ownership.

95 TypeScript tests pass, including 14 wallet/file-custody cases, 11 direct-wallet cases, 8 scoped challenge cases and memory/recovery/upgrade/inactivity checks. Typecheck, frontend build and Worker dry run pass. Local UI inspection confirms wallet-first/no-password onboarding, the optional protection checkbox, no-provider guidance and session recovery entry. Actual MetaMask extension, phone and full browser recovery acceptance remain open in R1.5/R1.6/R6. The recovery format and deployed contract/API remain unchanged.

Run the isolated generated-wallet SDK canary with `ZFT_TEST_ORIGIN=https://devnet.zft.foo node --import tsx scripts/check-wallet-custody.ts`. It uses only new test assets and sponsored devnet gas. Recovery files and its test wallet key remain in ignored `.local/`; retries resume the saved journal. It writes public evidence to `research/hosted-wallet-canary.json` only after the round trip, stale-file rejection and indexed wallet inventory pass. This signer fixture does not exercise a MetaMask extension.

The hosted SDK custody canary passed four confirmed transactions at blocks 95002, 95009, 95016 and 95023, including wallet → file → wallet, stale-export rejection and indexed wallet holdings. Public evidence: [hosted-wallet-canary.json](../research/hosted-wallet-canary.json).


## Discovery projection and deployment (R2)

Apply the additive D1 migration before deploying this build:

```sh
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.devnet.jsonc --env=
pnpm run deploy
node --import tsx scripts/check-discovery.ts
```

Use `--local --env local` for the test database. Migration `0002_discovery.sql` preserves existing chain events, profiles, relations and possession statements. It adds metadata validation/search records, a profile search/creation-time side table and revision triggers. The prior Worker can still read/write its original schema after migration; rolling back to `963d3892-b19a-4978-bb45-51a97dc32f2b` therefore does not need a destructive schema rollback. Do not remove these tables/triggers during routine rollback.

Scheduled index ingestion projects at most eight metadata records and eight profile names per run, then continues with an alarm if needed. Invalid/missing metadata retries after five minutes; real R2 outages are not persisted as invalid metadata. API responses report `pending` while unseen rows are being processed. Wait for pending to reach zero before accepting the hosted canary. Existing/implicit profile creation dates remain unknown; new explicitly saved profiles get a server timestamp. Renaming a profile preserves its original timestamp.

`/api/discovery/collections` and `/api/discovery/nfts` perform normalized literal substring search before bounded keyset pagination. Limits are 1–24. Cursors are tied to filter/sort and the data revision and expire after five minutes or the next ownership-statement expiry. A 409 means the view changed: refresh rather than append a different ranking snapshot. The frontend retains visible results on outages and blocks stale responses/duplicate loads. Current collector links require exactly one eligible published binding; unbound/ambiguous results open the neutral item page.

Collection counts and profile Collection/Sent eligibility use the same valid-metadata projection. Home uses six ranked profiles, eight recent NFTs and six public chain events. Transfer rows use neutral wording and confirmed block numbers; full Everyone/Following activity and actual event timestamps remain R3. Shared home/discovery cards contain actual public NFT pixels with distinct immutable page revisions, including a neutral fallback when no artwork is available. Optional discovery query failures also use that fallback: these three static pages retain their titles, public OG metadata and HTTP 200. Discovery API errors and required profile/item context or snapshot-storage failures retain their error behavior.

R2 adds 17 discovery regressions and six sharing fallback cases from PR #3 review; four wallet-profile authentication cases bring the complete suite to 122 TypeScript tests, plus typecheck/build/Worker dry run. The fallback cases failed before the fix and pass afterward under local outage/revision-conflict injection. The entry bundle is about 676 kB minified / 206 kB gzip; route splitting and large-dataset query/resource profiling remain R7.3. Actual MetaMask-signed browser social actions and full device acceptance remain R6. The contract, file codec, recovery format and apex routing are unchanged.


## Public activity deployment (R3)

Apply the additive migration before deploying the app. It preserves the preceding Worker's insert shapes and does not change contracts or custody formats:

```sh
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.devnet.jsonc --env=
pnpm run deploy
```

`0003_activity.sql` records profile/social/publication transitions atomically via D1 triggers. Follow-up `0004_activity_invalidation.sql` replaces only two update triggers and advances the activity revision, preserving journal rows and publication bindings. Live proof extensions and unchanged metadata retries no longer reset feeds; proof shortening/reactivation and changed metadata still invalidate cursors. Expiry bounds use only visible, scope-matching publication generations in the pinned snapshot. Public action history starts when this migration is installed. Undoing a like/follow retains both events. Unpublishing hides the token association from future feed requests; retained internal journal data and third-party caches have separate retention concerns (R7.3). Re-publishing never restores the hidden generation.

The indexer stores hash-verified event block times with new ranges and backfills at most eight existing event blocks per wake. An unavailable/mismatched time halts that batch without advancing its checkpoint. Until backfill succeeds, the feed says Time unavailable. Metadata projection and timestamp/visibility changes can invalidate a cursor with 409; Refresh obtains a new snapshot. `/api/index` reports the existing checkpoint/lag/error and wakes background work at most every 30 seconds. The existing scheduled alarm continues bounded backfill.

Run `ZFT_TEST_ORIGIN=https://devnet.zft.foo node --import tsx scripts/check-activity.ts` after time/metadata backfill. This writes only to two isolated, labeled acceptance profiles (generated keys in ignored `.local/`), tests signed follow/like/reversal/idempotency, public Following and pagination, and verifies the deployed bundle. It sends no ownership transaction. Evidence goes to `research/hosted-activity.json`; omit the origin override for local acceptance. Reorg/unpublish/expiry/race tests use real local SQLite; actual MetaMask and phone acceptance remains R6.

Rollback the Worker if required, retaining the additive tables/triggers and existing bindings/routes. Do not drop the journal or revert migrations to roll back UI code. The preceding Worker ignores activity tables and remains compatible; upgraded feed routes return only after the new Worker is restored.

R3 deployed on 2026-10-05 as Worker **`f8bfcef9-5b1e-4fd9-813b-9395b60fb52a`** after migration `0003_activity.sql`. **139 TypeScript tests**, typecheck/build/Worker dry run passed. The [hosted canary](../research/hosted-activity.json) verifies the tested bundle, two signed fixture profiles, history/idempotency and 24 events across 12 pages. The indexer reported no error with six-block lag. [Browser evidence](../research/r3-ui.json) records responsive, guest, profile/item link and accessible-time checks. No contract or ownership transaction was required.

PR #4 review fixes deployed as Worker **`dcd1dd7d-f9e1-48fe-9f91-88f913380872`** with migration `0004_activity_invalidation.sql`. The migration preserved the eight existing public journal rows (and zero current publication bindings); its one revision bump expires prior cursors. **154 app tests**, typecheck/build/Worker dry run and local/hosted acceptance pass. The hosted canary now traverses 32 events / 16 pages and asserts each nonterminal cursor advances. [Review-fix evidence](../research/pr4-review.json) records bundle verification, migration counts and the guest Following browser check. The post-connection return gate is tested with wallet/profile state fixtures; actual extension acceptance remains R6.

The metadata-scope follow-up uses additive migration `0005_activity_metadata_scope.sql` before Worker deployment. It retains all journal rows and records per-token metadata revisions, including deletion marks. The new Worker emits version-2 cursors and refreshes old version-1 cursors with 409. Metadata inserted for later mints or other feed scopes does not invalidate a snapshot; relevant backfill, deletion and mid-read changes still do. The original global counter continues advancing so the preceding Worker remains conservative during rolling deployment or rollback. Do not remove the metadata clock/projection on rollback.

This follow-up deployed as Worker **`4f7d76fc-b8a4-41a3-9c83-0a083b998391`** on 2026-10-05 (America/Chicago). **162 app tests**, typecheck/build/Worker dry run pass. The [hosted verification](../research/pr4-metadata-review.json) confirms version-2 continuation (200), legacy refresh (409), six-block index lag without an error, and the signed canary across 40 events / 20 pages. Frontend assets are unchanged.

The publication-scope follow-up uses additive migration `0006_activity_publication_scope.sql` before Worker deployment. Each changed publication generation receives a revision keyed by its immutable journal event ID. Withdrawal records the revision before removing the visibility binding; re-publication gets a new journal ID. Version-3 cursors compare only generations within their scope and pinned public-ID range, before and after reading the page. Unrelated and later publications no longer interrupt pagination. Version-1/2 cursors request refresh with 409. Existing journal/possession/binding rows remain intact, and old Workers retain their global invalidation behavior. Keep the added clocks/projections installed on rollback.

This publication follow-up deployed as Worker **`abc2243f-b377-486c-8692-4ecf6c8c752e`** on 2026-10-05 (America/Chicago). **172 app tests**, typecheck/build/Worker dry run pass. The [hosted checks](../research/pr4-publication-review.json) confirm unchanged migration counts (24 journal rows, zero bindings, two possessions), version-3 continuation, version-1/2 refresh, healthy six-block index lag and the signed canary across 48 events / 24 pages. Frontend assets are unchanged.

## Profile media (R4)

Apply additive migration `0007_profile_media.sql` before deploying the R4 Worker. It adds a side table without changing existing profile columns or journal rows. Older clients that omit images keep their references; a previous Worker can still write its original profile shape. Keep the table and immutable media objects when rolling back.

Uploads use the existing wallet-authenticated profile request. Browser normalization/cropping produces bounded 256×256 avatar and 1280×480 cover PNGs; server validation rejects envelopes and noncanonical/invalid pixels. Profile, references and journal changes use one D1 transaction with a compare-and-swap revision. R2 uploads occur first, so a failed transaction can leave an unreferenced public object. Reset only clears current references. Permanent media cleanup/retention is an R7.3 operation and must account for immutable OG snapshots.

Profile images are served by the existing devnet Worker at `/profile-media/:address/:hash.png`; no contract, binding or apex routing change is required. Reproduce the signed SDK checks with `ZFT_TEST_ORIGIN=https://devnet.zft.foo node --import tsx scripts/check-profile-media.ts`. Generated fixture keys remain in ignored `.local/`; no ownership transactions are sent. `node scripts/check-og-renderer.mjs` covers eight bounded sharing-image fixtures including profile media and missing-image fallback. Real extension/device acceptance remains R6.

R4 deployed as Worker **`1f5abf97-d8ce-4db2-ae3f-1f0f604d5fc3`** on 2026-10-05 (America/Chicago). Migration counts remained seven profiles, 32 journal events and two possessions. **186 app tests**, typecheck, frontend build, Worker dry run and eight local OG fixtures pass. [Hosted evidence](../research/hosted-profile-media.json) confirms both images in one signed save, stale-save 409, omission preservation, immutable PNG bytes and distinct bounded 1200×630 OG images after reset. [UI evidence](../research/r4-ui.json) uses a generated signer fixture, not a real wallet extension.

PR #5 review follow-up deployed as Worker **`5e7fdf99-4375-4657-aa77-76a5ae46f4de`** on 2026-10-05 (America/Chicago). The crop preview revokes replaced blob URLs. The signed hosted check now validates the actual post-reset PNG and byte-for-byte retention of the original OG image; matching-title renderer fixtures independently require avatar/cover pixels and run in CI. **186 app tests**, typecheck/build/Worker dry run and all eight fixtures pass. [Deployment and review evidence](../research/pr5-review.json) records the hosted bundle hash and checks. Existing migration 0007, data and routes remain unchanged.


## Help and sharing (R5)

Deployed 2026-10-06 as Worker **`0e513f21-a2c9-47c5-9ef0-3e6502473e9b`**. Basics and Technical help use a shared route/metadata resolver, with `/about` retained as an alias. Technical sharing has its own immutable PNG. Public copy controls provide manual selection after unavailable/rejected clipboard writes, and malformed collectible links return a clear error with an Explore action.

**203 app tests** and typecheck pass after the release-health review fix; the unchanged runtime retains its passing build/Worker dry run and fourteen real-workerd OG fixtures. [Hosted acceptance](../research/r5-deployment.json) verifies canonical help HTML, distinct bounded 1200×630 PNGs, immutable repeat bytes, invalid-item app shell, semantic health (ready ZVM devnet, enabled sponsor, populated error-free index within its six-block confirmation window) and the deployed asset hash. [UI evidence](../research/r5-ui.json) covers responsive layouts, keyboard/history/task navigation and copy failures; the hosted guide also passed a native clipboard write. Reproduce read-only hosted checks with `node --import tsx scripts/check-help.ts`.

No migration or contract update is needed. Preserve migration 0007 and the journal, bindings and existing routes. The preceding Worker `5e7fdf99-4375-4657-aa77-76a5ae46f4de` remains a schema-compatible rollback target. The apex prototype remains in place. Actual wallet/phone acceptance, social-platform recrawls and operational fault qualification remain R6/R7.


PR #6 title follow-up deployed as Worker **`0f53a02e-0450-4bec-ac0d-0475f3ecd728`** on 2026-10-06. Leaving a directly loaded help page now resets the document title instead of restoring the help title supplied by initial HTML. [Hosted browser evidence](../research/pr6-title-review.json) records the reproduced bug and passing navigation/history/alias checks. **194 app tests**, typecheck/build/Worker dry run and [hosted help checks](../research/r5-deployment.json) pass. No contract, migration, binding or route changes.


## Supplied branding (PR #7)

Worker **`94d8571d-1c47-4617-b1ef-66b75649fad2`** serves the supplied ZFT logo in the app, SVG/ICO favicons, touch/app icons and a [public asset gallery](https://devnet.zft.foo/assets/brand/). All 54 supplied source files are preserved. New OG snapshots receive a branding revision; existing share URLs retain their prior pixels. No migration, contract or binding/route changes were made.

**203 app tests**, typecheck/build/Worker dry run and 15 OG fixtures pass. The [hosted acceptance record](../research/brand-deployment.json) verifies 86 exact asset responses, three new OG images, unchanged prior image bytes, the deployed bundle and semantic health. [Brand documentation](BRAND-ASSETS.md) includes source/license provenance and regeneration instructions. PR #7 review remains pending; real-device and release gates remain R6/R7.
