# Shielded-only public site

This candidate replaces the mixed public frontend after merged PR39 (`c91954c689208dbba6b84fb5c2d908ffce5384be`). The user chose public pictures and titles by default and requested removal of the old site. It is prepared for review, not deployed.

## Product behavior

The homepage is a public gallery of published shielded creations. Each card opens an item page with its picture, name, description, creator fee account, asset ID and creation transaction. Create, My collection, Receive and Recover lead into the existing `/shielded` client. The public pages require no wallet, password or private journal.

Before preparing a new creation, the client explains that the sanitized picture, name, description and creator fee account will be public. The spending keys, transferable bearer picture, recovery file and password remain private. Only the second creation transaction finishes creation; a draft or first reservation never becomes a gallery entry.

After a new creation is observed, the client uploads an explicit public allowlist. The completion view links directly to the public item. If upload fails, it says the ZFT was created and publication is pending. Publish to gallery retries only that upload. A reopened or restored record requires observation and an explicit publication action; unlocking old records never silently publishes them. Consent for automatic publication is limited to new creations prepared in the current unlocked session.

The old wallet/profile catalog, profiles, social activity, profile editing, public possession proofs and their public routes are removed. Old entry links for Create, collection, Receive and Recover redirect to the corresponding shielded flow. Old profile and catalog API paths return 404. The default Worker's legacy index schedule is a no-op. Existing Durable Object exports, bindings, storage, contracts and data remain intact; no migration, deletion or backfill occurs. The separate historical design prototype and private research demos are not deployed or modified by this candidate.

## Public catalog boundary

`POST /api/shielded/gallery` accepts only the publication format, asset ID, creation transaction hash, exact public metadata and base64 canonical PNG. The body is bounded to 14,000,000 bytes. Metadata uses the frozen shielded format, canonical JSON, byte limits, dimension limits and asset-ID formula. Unknown fields, malformed images, bearer chunks, substituted metadata and unfinished creations are rejected before publication.

The server checks the selected chain ID, genesis and all six contract code hashes. At a fixed head it verifies a successful receipt from the pinned registry, its Created event, the exact image and metadata hashes, creator, asset ID and registry image mapping. It checks the receipt's canonical block and rechecks the observed head. No private inputs go to RPC. The gallery is a public RPC observation of creation, not guaranteed finality, a portable ownership proof or a claim about the current holder.

Public image, immutable metadata/provenance record and newest-first index entries use a dedicated `shielded-public/v1/<chain>/<registry>/` namespace in the existing MEDIA bucket. No new resources or database schema are needed. Deterministic keys make retry idempotent, including interruption between the record and index writes. A reincluded transaction can republish its current block; stale index entries are ignored.

Anonymous GET endpoints provide the paginated gallery, `/api/shielded/gallery/<assetId>` and its `/image`. Listing and item reads recheck creation provenance. Reorged entries are hidden; an RPC outage returns an error rather than an apparently empty gallery. Six entries per page bound the chain/storage requests. The image endpoint serves only previously published, hash-checked public bytes, without RPC calls or a live creation claim. Those bytes remain available during an outage or reorg; listings and item pages decide whether creation is currently observed. Responses are not cached as permanent claims. The UI labels creation observation and deliberately omits current-owner/profile inventory features.

The public build excludes the shielded proof worker, recovery decoder and spending controller. The existing static `/shielded*` host remains ASSETS-only and posts public publication data to the same origin's default Worker. No contract, circuit, recovery format, dependency lock, pin, DNS or route change is included.

## Validation and release

The local regression creates with real disposable Anvil contracts and proofs, loses the final wallet response, reopens the same encrypted record, observes completion, publishes it and reads its public image back. Publication leaves the journal unchanged and includes no secret/randomness fields or values. Separate cases reject drafts, reservations, uncertain submissions and unobserved reopened records. Two mutation controls detect an expanded publication allowlist and an attempted journal write.

Publication finds its public creation event from a saved successful receipt first. If that response was lost, it checks the authorization's commit window (at most 255 blocks). Only a restored older backup that predates same-destination renewal needs the historical fallback. Regressions advance the disposable chain by 2,000 blocks and require zero log queries with a saved receipt, or one bounded query after a lost response. Public image tests require zero RPC calls while retaining byte-hash checks. The local trial server shares production's JSON error mapping, preserving unpublished-item 404s and temporary-outage 503s.

The browser trial exercises the notice, exact recovery download/reselection, both transactions, explicit waiting, automatic publication attempt, a deliberately failed upload, successful upload-only retry, homepage card and public detail. The final public build is also inspected on a separate loopback origin without an injected wallet, at desktop and narrow mobile sizes. Evidence records the exact tested source scope. No user's records or keys are inspected and no live transaction is submitted.

Reproduction commands:

```sh
pnpm test
pnpm typecheck
node --import tsx --test --test-concurrency=1 research/shielded-app/test/client.test.mjs
node research/shielded-app/check-controls.mjs
node research/shielded-app/check-builds.mjs
node --test research/shielded-host/host.test.mjs research/shielded-host/source-package.test.mjs
pnpm exec tsc --noEmit --project research/shielded-host/tsconfig.json
pnpm build
pnpm worker:check
```

Preserve prior generated host outputs before rebuilding `research/shielded-host/build.mjs`; it deliberately refuses overwrite. Use the existing exact proof artifacts. The source reconstruction check reuses frozen dependencies and source supplements; it does not reproduce upstream compiler bundles or the trusted setup. Historical validation manifests are retained unchanged. Current evidence is recorded in [the gallery validation manifest](../research/shielded-public-gallery-validation.json).

Release requires approval for both the default Worker/public frontend and the separate shielded static package. The existing route split can be reused. The candidate does not merge, activate a Worker, modify remote storage, request a faucet, purchase reviews or message bots. Independent review, real MetaMask/Firefox/iOS/Android qualification, load/resource budgets, second-operator disappearance and independently qualified devnet finality remain open.
