# First devnet implementation

2026-10-04. This is the first runnable implementation, with real ZVM transactions. It is not the full public beta from the specifications.

## Implemented

- Non-upgradeable ERC-721 with EIP-712 mint and ownership rotation. Every ordinary, approved, operator, and self-transfer increments the ownership epoch. No administrator or seizure path.
- React frontend using the pinned Zenon theme and self-hosted fonts: exploration, public item proof, creator pages, local collection, mint, file import/claim, export, cancellation, recovery, and lock/unlock.
- Fresh independent keys per ownership transition; encrypted IndexedDB records; PBKDF2/HKDF/AES-GCM; pending requests and both sides of each transition saved before submission.
- Strict transferable PNG envelopes with hash/metadata checks, CRC validation, deployment allowlisting, large-number handling, and bounded decoding. Uploaded public art contains only PNG pixels.
- Signed single-use API challenges, R2 media adapter, fixed-contract sponsor, per-profile/IP quotas, gas caps, explicitly serialized Durable Object delivery, durable signed-transaction journal, retries by authorization digest, receipt reconciliation, and a small confirmed-mint catalog.
- Foundry unit/fuzz tests, TypeScript codec/vault/protocol tests, CI, deployment scripts, and a real devnet acceptance canary.

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
pnpm exec wrangler dev --config wrangler.devnet.jsonc --env local --port 8787
# Second terminal:
pnpm dev
```

Open **http://localhost:5173** (use this exact origin for signed API requests). The Worker uses isolated local R2/DO storage under `.wrangler/state`. Its chain reads and transactions reach the real ZVM devnet. Keep that state between restarts: it holds the sponsor's nonce journal and admitted public artwork.

Sponsorship is disabled in committed configuration. `.dev.vars.local` enables the dedicated local test account:

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

## Cloudflare promotion

The existing `zft-preview` Worker and [zft.foo](https://zft.foo/) still serve `design/`. The real app uses the explicit **wrangler.devnet.jsonc** configuration so merging it does not change the prototype's legacy deploy command. Do not point the legacy `--assets ./design` command at the app Worker.

The isolated R2 bucket **zft-devnet-public** has been created. The new Worker, production sponsor secret, domain migration, and Git build settings have not been promoted. The pinned contract's metadata origin is `https://zft.foo`; production metadata/art URLs will become available when the app's media routes are deployed there. Local canary media currently lives only in local R2 storage.

For eventual promotion, set the build command to `pnpm install --frozen-lockfile && pnpm build` and deploy command to `pnpm exec wrangler deploy --config wrangler.devnet.jsonc --env=""`. Provision a separate funded sponsor secret, migrate needed canonical public objects, verify the Worker, then move the domain from `zft-preview`. PR/staging environments must have isolated sponsor accounts and storage. Do not run two different outboxes with the same gas account.

## Remaining beta gates

- Full profile editing, collection membership, current-possession attestations, follows/likes, sent/activity/follower views, and unique PNG OG images with initial server HTML metadata. The richer `design/` pages remain the design reference.
- D1 event index, pagination, external-transfer discovery, reorg rollback, reset drills, and independent ZVM/finality verification. The present catalog records only confirmed mints submitted through this sponsor, up to 50 entries.
- Sponsor crash/restart/reorg/fee-replacement fault injection, bounded journal retention, stronger Sybil admission and storage cleanup. Ambiguous or conflicting nonce state deliberately stops the sponsor for operator reconciliation.
- Browser-to-browser and phone acceptance, large-collection recovery limits/performance, accessibility coverage, release/security review, and production CSP verification.
- Cloudflare app/domain promotion and approved public source verification. Mainnet, monetary sales, and marketplaces remain out of scope.
