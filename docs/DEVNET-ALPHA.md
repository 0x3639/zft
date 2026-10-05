# Hosted devnet alpha

2026-10-04. The real app is deployed at [devnet.zft.foo](https://devnet.zft.foo/), with real ZVM transactions. It is not the full public beta from the specifications.

The [complete website functional specification](FUNCTIONAL-SPEC.md) covers the entire target product; the [reference action ledger](REFERENCE-AUDIT.md) records which NonFungible Cash controls were actually exercised and which owner/payment flows remain unverified. Those documents specify remaining work, not extra deployed features.

## Implemented

- Non-upgradeable ERC-721 with EIP-712 mint and ownership rotation. Every ordinary, approved, operator, and self-transfer increments the ownership epoch. No administrator or seizure path.
- React frontend using the pinned Zenon theme and self-hosted fonts: exploration, public item proof, creator pages, local collection, mint, file import/claim, export, cancellation, recovery, and lock/unlock.
- Fresh independent keys per ownership transition; encrypted IndexedDB records; PBKDF2/HKDF/AES-GCM; pending requests and both sides of each transition saved before submission.
- Strict transferable PNG envelopes with hash/metadata checks, CRC validation, deployment allowlisting, large-number handling, and bounded decoding. Uploaded public art contains only PNG pixels.
- Signed single-use API challenges, R2 media adapter, fixed-contract sponsor, per-profile/IP quotas, gas caps, explicitly serialized Durable Object delivery, durable signed-transaction journal, retries by authorization digest, receipt reconciliation, and a small confirmed-mint catalog.
- Signed, versioned public profile editing; featured artwork; follow/unfollow and like/unlike; follower directories; opt-in item-owner possession proofs; collection/sent/creation activity tabs; profile-selected artwork dialogs; public image and observation downloads.
- D1 event journal indexed independently from sponsor submissions, cursor pagination, six-block confirmation policy, serialized scans and checkpoint rewind on fork detection. Cron and rate-limited public index reads wake ingestion.
- Per-page initial HTML metadata and deterministic 1200×630 PNGs for static pages, profiles, selected artwork, and standalone items. Known revisions are stored in R2; arbitrary revision generation and unrelated profile/item contexts are rejected.
- Foundry unit/fuzz tests, TypeScript codec/vault/protocol/SQLite service tests, CI, deployment scripts, and real devnet acceptance canaries.

## Deployed contract

- Chain: **7340469**, ZVM devnet.
- Contract: [`0x42666265e38f2d1b786e8af8e9576224a95b90ae`](https://devnet.zenon.foo/explorer/address/0x42666265e38f2d1b786e8af8e9576224a95b90ae).
- Deployment block: **94013**.
- Transaction: [`0x5e368a…ee0c`](https://devnet.zenon.foo/explorer/tx/0x5e368a5357ef757d5bfd0090b73b9f3671f988a063c23023352a741f6e9aee0c).
- Compiler: Solidity 0.8.30, Cancun target, optimizer 200 runs, OpenZeppelin 5.6.1.
- Manifest: `packages/protocol/deployment.json` pins genesis, contract, runtime bytecode hash, deployment block, and metadata origin. A mismatch disables signing/submission.

The public relayer currently requires a **50 gwei minimum priority fee** that `eth_gasPrice` does not include. The first deployment was rejected for this reason. Its replacement used the same nonce and constructor data. The integration adds the observed floor to the node quote and caps total gas price at 100 gwei. Transaction gas is capped at 600,000; the sponsor reserves a maximum 0.1 devnet ZNN per UTC day. These are test funds from the public faucet.

The UI calls an operation **confirmed** after six subsequent EVM blocks. This is an application policy, not a protocol-finality guarantee. The RPC accepts `finalized`, but independently validating its semantics remains a beta gate.

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

Create a local collection, save and acknowledge recovery, then mint an image. Claim and cancellation create a new saved key before submission. If a request times out, **Resume transaction** reuses the saved operation. Expired requests are renewed only after the server confirms the prior operation is absent or reverted, preserving the recipient key. Export is disabled for keys with external transaction/approval history; rotate to a fresh app key first.

A recovery file is a **secret bearer snapshot**, not a password-encrypted transport format. The local passphrase encrypts the browser vault; it does not protect a downloaded recovery file. New keys require a newer snapshot. Restore into a fresh browser profile so an existing vault is never overwritten. No administrator can recover missing item keys.

## Image format frozen for this slice

`zft-png/1`: accept JPEG or non-interlaced 8-bit RGB/grayscale PNG; apply JPEG/PNG EXIF orientation; strip metadata; encode 8-bit RGBA PNG with fast-png 8.0.0 / fflate settings pinned in the lockfile, compression level 6, no interlacing. JPEG decoding uses jpeg-js 0.4.4. Transparency is retained. Inputs/outputs are bounded at 10 MiB and 24 megapixels; inflated PNG bytes must match dimensions exactly before decoding.

APNG, indexed/16-bit/interlaced PNG, CMYK JPEG, and embedded ICC profiles are rejected. Convert those to an 8-bit sRGB image first. Arbitrary color-profile conversion is not implemented. Exports use one `zfTA` PNG chunk and remain viewable as pictures. JPEG APP15 export is reserved for a future explicitly versioned codec. Send `.zft.png` as the original attachment; screenshots/recompression are not transferable.

## Verification

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

- App: **https://devnet.zft.foo**, Worker **zft-devnet**.
- Canonical public media: **https://zft.foo/art/** and **https://zft.foo/metadata/**, routed to that same Worker. The apex homepage remains the `zft-preview` design prototype.
- D1 **zft-devnet-index**, R2 **zft-devnet-public**, Sponsor and Indexer Durable Objects, one-minute cron. Local bindings are isolated.
- Hosted sponsor **0x3FDefb23b5ccd02a9f706E478335aB000C4464d1**, funded only with free devnet ZNN. Its key is a Cloudflare secret, separate from the local sponsor and deployer. Never run two outboxes with one gas account.
- Explicit **wrangler.devnet.jsonc** keeps the legacy prototype Git deploy command separate. No Git build settings or main-branch merge has been changed by this milestone.

```sh
pnpm exec wrangler d1 migrations apply zft-devnet-index --config wrangler.devnet.jsonc --env= --remote
pnpm run deploy
```

Use `pnpm run deploy`: `pnpm deploy` invokes pnpm's unrelated built-in workspace command. `scripts/prepare-hosted.ts` provisions only the separate hosted devnet key; `scripts/publish-media.ts` copies strictly validated, already minted public art/metadata from the local app. Neither uploads vaults or transferable envelopes.

For a future Git build integration on **zft-devnet**, use build command `pnpm install --frozen-lockfile && pnpm build` and deploy command `pnpm exec wrangler deploy --config wrangler.devnet.jsonc --env=""`. Apply database migrations deliberately. Moving the apex front page to the app is a separate reviewed routing/build change; the present review build is already functional at the devnet hostname.

## Public-page behavior and verification

Profile edits require a single-use signed request and matching revision. Public possession proofs are signed by the current disposable item owner and bind the profile, contract, token, epoch, and expiry (maximum 31 days). They never transmit the key. The index suppresses holdings whose epoch/owner has changed. Removing a holding deletes its profile association; mint provenance stays public. Public cached previews can remain on other platforms.

OG rendering uses pinned Satori 0.26.0 plus resvg-WASM 2.6.2 with bundled Space Grotesk/JetBrains Mono fonts. The newer HarfBuzz-based renderer required browser facilities unavailable in the Worker canary. The deployed pipeline was tested on Cloudflare. Render at most three R2 images, each at most 1 MiB / 2 megapixels; larger artworks get a page-specific text card. Image failure or output above 1 MiB also falls back to the text card. This keeps renderer memory bounded without fetching arbitrary media URLs. Profile revisions preserve old snapshots; unpublishing blocks fresh retrieval of selected-profile artwork images that no longer belong in that context.

```sh
# Local signed profiles, social idempotency, possession and five unique PNGs:
node --import tsx scripts/check-public.ts
# Hosted public acceptance, using the previously generated canary identities:
ZFT_TEST_ORIGIN=https://devnet.zft.foo node --import tsx scripts/check-public.ts
# Separate hosted transaction canary with its own saved journal/recovery files:
ZFT_TEST_ORIGIN=https://devnet.zft.foo ZFT_CANARY_LABEL=hosted node --import tsx scripts/devnet-canary.ts
```

Public results are saved in `research/public-canary.json`, `research/sharing/`, and the transaction-canary evidence. Generated recovery and transfer files remain in ignored `.local/`. SDK canaries use isolated IndexedDB emulation; they do not substitute for actual two-browser or phone acceptance.

The hosted transaction canary completed on 2026-10-04: four confirmed transactions at blocks 94503, 94510, 94517, and 94527 cover mint, claim, cancel, and second claim, followed by recovery and stale-copy checks. Public evidence is in `research/hosted-devnet-canary.json`. Hosted API admission checks also rejected cross-origin writes, unsigned requests, oversized bodies, body substitution, invalid uploads, and consumed-challenge replay. Five hosted public pages produced distinct valid sharing PNGs.

## Remaining beta gates

- Additional curated collection pages, independent avatar/cover uploads, richer activity/social filtering, and full reference-page parity. The current cover uses a featured public collectible and the avatar uses an initial.
- Independent ZVM/finality verification; controlled large/deep reorg and reset drills. SQLite regression tests cover index rollback, external transfers, and stopped ingestion on deployment mismatch.
- Sponsor crash/restart/reorg/fee-replacement fault injection, bounded journal retention, stronger Sybil admission and storage cleanup. Ambiguous or conflicting nonce state deliberately stops the sponsor for operator reconciliation.
- Actual browser-to-browser and phone transactions, large-collection recovery performance, expanded accessibility testing, release/security review, and target social-platform preview checks.
- Reviewed apex homepage/Git-build promotion and approved public explorer source verification. Mainnet, monetary sales, and marketplaces remain out of scope.
