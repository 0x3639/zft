# Proposal verification

Checked 2026-10-04. This evidence covers the review package, not the future production application.

## Checks completed

- JavaScript syntax: `node --check design/app.js` and `node --check design/og.js` passed.
- Solidity interface syntax: `solcjs` 0.8.30 compiled `contracts/interfaces/IZFT.sol` to an ABI successfully. This does not verify a contract implementation; none exists yet.
- Repository Markdown links resolve to present files; research probe JSON parses.
- Browser review: homepage, public profile, selected artwork dialog, standalone owner item, local collection, recovery, mint, import/claim, export/cancel, and stale-file states.
- Sample mint appeared in the local collection; the default publication checkbox was off. Sample claim added the received artwork. Export retained ownership and exposed cancellation; cancellation restored the owned state.
- Recovery required both a sample download and acknowledgment, in either order. Returning from recovery preserved the mint title/description draft.
- Native dialog focus moved to its close control; Escape closed a selected-artwork dialog and removed its item query from the profile hash route.
- Dark and light themes inspected. Home/profile layouts checked across 320, 360, 390, 768, 1280, and 1440px widths as applicable, without horizontal document overflow.
- Profile and artwork social-card compositions rendered as distinct 1200×630 images. Screenshots are JPEG review evidence; production OG output is specified as PNG.
- Browser error logs were empty during the checked flows.

The prototype makes no wallet connection, key generation, RPC submission, or contract call. Its state is in memory and resets on reload. Download buttons emit clearly labeled `.txt` design samples. Local image selection is a visual preview and does not implement canonicalization or transferable-file verification.

## Screenshots

| Screen | Review evidence |
| --- | --- |
| Homepage, dark | [Screenshot](../design/screenshots/home-dark.jpg) |
| Homepage, light | [Screenshot](../design/screenshots/home-light.jpg) |
| Public profile, desktop | [Screenshot](../design/screenshots/profile-desktop.jpg) |
| Public profile, phone | [Screenshot](../design/screenshots/profile-mobile.jpg) |
| Unique profile social card | [Screenshot](../design/screenshots/og-profile.jpg) |
| Unique artwork social card | [Screenshot](../design/screenshots/og-item.jpg) |

## Implementation checks still required

No live end-to-end ownership test, contract invariant suite, production codec/vault validation, automated accessibility audit, manual screen-reader certification, Cloudflare provisioning, renderer runtime canary, crawler metadata service, or deployment verification is claimed. These have explicit acceptance gates in [IMPLEMENTATION.md](IMPLEMENTATION.md) and [PAGES-AND-SHARING.md](PAGES-AND-SHARING.md). Research RPC/precompile checks are read-only capability probes, documented separately in [EVIDENCE.md](../research/EVIDENCE.md).
