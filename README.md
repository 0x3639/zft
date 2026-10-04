# ZFT

**Collect a picture. Send the file. Pass it on.**

ZFT is a proposed bearer-file collectible app on Sol’s Zenoglyphs VM (ZVM), hosted on Cloudflare. A JPG or PNG carries a disposable ownership key. Claiming the file rotates ownership on-chain, invalidating every previously exported copy.

**Status: proposal and frontend prototype for review.** The static prototype is live at [zft.foo](https://zft.foo/), using sample data and simulated operations. The Solidity file is an interface specification; the contract implementation and application backend remain planned.

Repository: [0x3639/zft](https://github.com/0x3639/zft).

## Review the project

1. [Product and protocol specification](docs/SPEC.md)
2. [Contract design and invariants](docs/CONTRACTS.md), [proposed Solidity interface](contracts/interfaces/IZFT.sol)
3. [Frontend design and flows](docs/FRONTEND.md)
4. [Cloudflare architecture, APIs, and operations](docs/ARCHITECTURE.md)
5. [Implementation milestones and acceptance gates](docs/IMPLEMENTATION.md)
6. [Decisions for review](docs/REVIEW.md)
7. [Research and devnet evidence](research/EVIDENCE.md)
8. [Page parity and Open Graph specification](docs/PAGES-AND-SHARING.md)
9. [Marketplace expansion design](docs/MARKETPLACE.md)
10. [Prototype verification and screenshots](docs/VALIDATION.md)
11. [Cloudflare prototype deployment](docs/DEPLOYMENT.md)

Start with `docs/REVIEW.md` and the prototype. The recommended first release has public on-chain transfers, free-to-user sponsored claims, local encrypted custody, file export/import, and an optional public gallery. Private transfers, sales, and encrypted claim links follow separately.

## Preview the frontend

No dependency installation is required:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/design/`. The prototype contains the homepage, gallery, public profiles, collection/sent/activity tabs, artwork details, marketplace design, mint, import/claim, send/cancel, and recovery flows. Its actions simulate product states and never submit a blockchain transaction. Uploaded images remain in memory in this prototype. Unique profile/item/home social-card templates are at `design/og-preview.html`.

## Proposed implementation stack

- React, TypeScript, Vite, viem, IndexedDB, and browser Web Crypto.
- Cloudflare Workers with Static Assets, R2, D1, and Durable Objects.
- Solidity with OpenZeppelin ERC-721/EIP-712/ECDSA and Foundry verification.
- ZVM devnet `7340469`; RPC `https://devnet.zenon.foo/zvm/rpc`.

Exact dependency versions, production contract addresses, and project license are set during implementation. The static prototype responds over HTTPS at the confirmed **zft.foo** domain. API, storage, sponsor, and contract deployment verification follow during implementation. `zvm.foo` was an earlier mistaken hostname and is not the app domain.

Frontend direction: NonFungible Cash’s page structure and flows with the [Zenon design system](https://github.com/digitalSloth/zenon-design-system). The prototype includes pinned MIT-licensed theme CSS/assets with attribution in `design/vendor/zenon/NOTICE.md`.

The original inspiration is [NonFungible Cash](https://nonfungible.cash/). ZFT v1 recreates the bearer-file experience with public ownership rotation. It does not claim Cashu compatibility or NonFungible Cash’s transfer privacy.
