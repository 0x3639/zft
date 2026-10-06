# ZFT brand assets

## Delivery status

The supplied logo shipped in [PR #7](https://github.com/0x3639/zft/pull/7), merged at `20c2c40` on 2026-10-06. Final head `f6e31f6` passed CodeRabbit review, both CI runs and the Cloudflare preview. Its original devnet deployment was Worker `94d8571d-1c47-4617-b1ef-66b75649fad2`; [hosted acceptance](../research/brand-deployment.json) passes. Later operational deployments retain these assets; see the [roadmap](IMPLEMENTATION.md) for current work. No schema or contract changes were required.

## Preserved source and public files

All **54 supplied files** from the repository's `zft-logo/` folder are copied byte-for-byte into `apps/web/public/assets/brand/original/`: logo marks, wordmarks, horizontal/stacked lockups, monochrome variants, avatars, app icons, favicons, and the original README. The source folder remains untouched.

The public gallery is `/assets/brand/`. It previews all 53 visual assets and links to their original downloads, generated web SVGs and source notes. `/assets/brand/manifest.json` records each original's filename, size and SHA-256, plus generated SVG hashes. All variants remain available even when they are not used in the app UI.

| Surface | Active asset |
| --- | --- |
| Header and footer | Horizontal on-light/on-dark lockups, selected by the existing theme; 120 × 36 CSS pixels |
| Browser favicon | Supplied dark tile, SVG plus a 16/32/48 PNG-backed ICO and 32px PNG fallback |
| Apple touch icon | Supplied 180px tile |
| Web app manifest | Supplied 192px and 512px tile icons; standalone display metadata, no offline guarantee |
| New OG images | Dark horizontal lockup; supplied mark for the no-artwork fallback |

`/favicon.svg` and `/favicon.ico` are the conventional public aliases. Head links use `?v=2026-10` to refresh browser icon caches. Other brand files live under `/assets/brand/`, already handled by Cloudflare Static Assets. No Worker binding, database, contract or route change is required. The legacy design prototype remains separate.

## Font-independent SVGs

The supplied wordmarks reference IBM Plex Mono SemiBold by font name. Runtime SVGs outline that lettering with the actual font so browser, favicon and server OG rendering do not depend on an installed font or a network font request. Supplied geometry, spacing and colors are preserved. Originals retain their metadata; modified web derivatives omit the original provenance metadata and contain no live text or external image references.

The pinned generator font is `scripts/brand/IBMPlexMono-SemiBold.ttf`, sourced from [Google Fonts' IBM Plex Mono package](https://github.com/google/fonts/tree/main/ofl/ibmplexmono). Its SHA-256 is in the inventory. The SIL Open Font License is included at `apps/web/public/licenses/IBM-Plex-Mono.txt`. The generator uses Satori's already-locked OpenType parser; no additional runtime dependency is introduced.

After changing a supplied asset, run from the repository root:

```sh
node scripts/build-brand-assets.mjs
pnpm build
node scripts/check-og-renderer.mjs
```

Commit the originals and generated outputs together. The generator writes the web SVGs, inventory, gallery HTML, favicon aliases and `packages/protocol/brand.ts`. The gallery stylesheet and web manifest are maintained alongside them. Regeneration was checked to produce identical bytes on a second run.

## Share-image revision compatibility

New snapshots include `branding: "zft-2026-10"` in their digest. This creates new OG URLs rather than replacing pixels behind an immutable URL. Retained version-1 snapshots without that field continue through the prior renderer branches, including the old wordmark and empty-art fallback. Existing publication eligibility checks still apply. Future branding revisions must retain prior rendering behavior for retained snapshots.

The renderer acceptance run now covers 15 fixtures. The legacy empty-art fixture must retain SHA-256 `2eecc0db0b80f24db68303386e3786f20705a46b8bef9b22fe9404e40cc62b9b`; the otherwise identical new snapshot must differ. NFT collage, avatar/cover, crop, dimensions and size assertions remain in place.

## Acceptance evidence

- **203 app tests**, typecheck, frontend production build and Worker dry run pass.
- [Hosted deployment](../research/brand-deployment.json): 86 exact asset responses, three new OG images, byte-identical prior OG URLs, exact frontend bundle, semantic health and [browser screenshot](../research/brand-hosted.png).
- [Asset response checks](../research/brand-assets.json): 54 byte-identical source files; 86 successful local workerd responses, with original/generated hashes and image/manifest MIME checks.
- [OG fixture results](../research/sharing-fixtures/results.json): 15 bounded 1200 × 630 images, legacy pixel preservation and new-brand output.
- [Browser checks](../research/brand-ui.json): light/dark header and footer, 320/360px layout without horizontal overflow, loaded logo images and public gallery.
- Screenshots: [dark](../research/brand-dark.png), [light](../research/brand-light.png), [mobile](../research/brand-mobile.png), [gallery](../research/brand-gallery.png).

Run `pnpm exec tsx scripts/check-brand.ts` after deployment to verify exact served assets, the frontend bundle, semantic health, new OG revisions and preservation of the recorded pre-brand URLs in `research/brand-before.json`. Physical-device home-screen icon selection and external social-cache refresh are part of R6 acceptance.
