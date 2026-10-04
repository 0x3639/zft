# ZFT

**Collect a picture. Send the file. Pass it on.**

ZFT is a bearer-file collectible app on Sol’s Zenoglyphs VM (ZVM), built for Cloudflare. A PNG carries a disposable ownership key. Claiming the file rotates ownership on-chain, invalidating previously exported copies. JPG and PNG inputs are normalized locally into canonical PNGs.

**Status: first real devnet implementation.** The React app, encrypted vault, transferable PNG codec, Solidity contract, Worker API, R2 storage adapter, and sponsor Durable Object are implemented. The contract is deployed on ZVM devnet; the app runs locally against that deployment. [Devnet alpha setup and limitations](docs/DEVNET-ALPHA.md) describe what works and what still precedes a public beta.

The static prototype at [zft.foo](https://zft.foo/) remains the public review site. It uses sample data. This implementation branch does not replace that deployment automatically.

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

Start with [the implementation runbook](docs/DEVNET-ALPHA.md). The linked specifications remain the full release target; profile editing/social features, unique OG images, and the production event index are not implemented in this first slice. Private transfers, sales, and encrypted claim links remain separate work.

## Run the real devnet app

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec wrangler dev --config wrangler.devnet.jsonc --env local --port 8787
# In a second terminal:
pnpm dev
```

Open `http://localhost:5173`. Sponsorship requires a dedicated funded devnet key in `.dev.vars.local`; see the runbook. No item or recovery keys are uploaded to the Worker.

```sh
pnpm typecheck
pnpm test
pnpm contracts:test
pnpm worker:check
```

## Preview the frontend

No dependency installation is required:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/design/`. The prototype contains the homepage, gallery, public profiles, collection/sent/activity tabs, artwork details, marketplace design, mint, import/claim, send/cancel, and recovery flows. Its actions simulate product states and never submit a blockchain transaction. Uploaded images remain in memory in this prototype. Unique profile/item/home social-card templates are at `design/og-preview.html`.

## Implementation stack

- React, TypeScript, Vite, viem, IndexedDB, and browser Web Crypto.
- Cloudflare Workers with Static Assets, R2, and Durable Objects. D1 indexing is a later milestone.
- Solidity with OpenZeppelin ERC-721/EIP-712/ECDSA and Foundry verification.
- ZVM devnet `7340469`; RPC `https://devnet.zenon.foo/zvm/rpc`.

Dependencies are pinned in `pnpm-lock.yaml`; the devnet deployment is pinned in `packages/protocol/deployment.json`. Project source remains UNLICENSED pending the license decision. The app domain is **zft.foo**.

Frontend direction: NonFungible Cash’s page structure and flows with the [Zenon design system](https://github.com/digitalSloth/zenon-design-system). The prototype includes pinned MIT-licensed theme CSS/assets with attribution in `design/vendor/zenon/NOTICE.md`.

The original inspiration is [NonFungible Cash](https://nonfungible.cash/). ZFT v1 recreates the bearer-file experience with public ownership rotation. It does not claim Cashu compatibility or NonFungible Cash’s transfer privacy.
