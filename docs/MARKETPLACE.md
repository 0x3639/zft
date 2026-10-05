# Marketplace expansion proposal

Draft 0.1. The full project includes the reference’s Market surface and listing/offer/purchase journeys. The prototype previews the page structure; live trading follows the gift/claim beta and a review of the deployed Karum source, order schema, payout behavior, and settlement assumptions.

## Recommended integration

The user confirmed ZVM assets and MetaMask as the expected wallet direction on 2026-10-04. MetaMask is the primary external wallet for wallet custody and planned approvals, purchases, and payout receipt. The alpha connects to MetaMask-compatible providers for address, pinned network and devnet balance. Both file-to-wallet and wallet-to-file custody transitions are implemented and deployed; automated tests and the hosted SDK round trip pass, while actual MetaMask extension/phone acceptance remains open. Marketplace approvals and settlement are still planned. ZFT NFTs are ERC-721 tokens on ZVM; no separate fungible ZFT token is required. Gas currently uses Devnet ZNN in the app configuration. Choose and validate the actual market payment asset against the exchange rather than treating gas currency, an ERC-20 quote token, and native Zenon L1 ZNN as interchangeable.

Integrate the existing [Karum market](https://devnet.zenon.foo/karum/) on the same ZVM when its source/API and contract compatibility are verified. Do not deploy a new exchange merely to reproduce a page. Contract requirements for listings, order cancellation, approvals, royalties, and payouts must be checked against the actual deployment.

V1 ZFT is an ERC-721, which is a starting compatibility condition rather than proof an exchange will support every flow. A new marketplace contract is only justified by an identified gap and gets its own spec/review before implementation.

## Custody boundary for trading

**Disposable bearer keys must never receive or hold sale proceeds.** Anyone with an old file knows that old key. If sale funds were paid to it, a former file holder could steal the proceeds even after NFT ownership rotated.

Recommended initial trading path: move an item from file custody to a connected, non-exported wallet using the signed ownership transition. This invalidates outstanding exports. List/sign/approve from that wallet through the verified exchange. Sale proceeds go to that wallet; its private key never enters a picture. A buyer receives the NFT in their wallet and may explicitly move it to a freshly generated file-custody address. The app presents these two custody modes clearly.

A later wallet-free sale flow would require a separately controlled payout address and exchange support binding it into the seller’s order, plus meaningful fund recovery. It must not repurpose profile or old item keys as payout wallets without review. This is an unresolved compatibility condition, not a implemented promise.

## Pages and flows

- Market: public listings, search/filter/sort, creator/collection links, explicit prices in the actual settlement asset, network/fee context.
- Item listing/offer panel: ask, offer, seller, expiration, order status, current ownership, and approval status.
- List: select wallet-custody item, price/expiry, royalty/fee preview, scoped approval, signed order, cancellation.
- Buy: quote price/fees/settlement asset, wallet balance, bounded approval if needed, simulate exchange call, included/finalized receipt states.
- Offer: funded/token-approved signed offer, expiration, maker cancellation, seller acceptance; only after exact exchange semantics are verified.
- History: actual indexed sales/ownership transitions; do not fabricate volume statistics from listing counts.

Buying/selling never silently becomes a file gift operation. Concurrent file rotation, listing consumption, cancellation, approval revocation, or reorg must resolve from exchange and NFT state. The app refuses file export while a known marketplace/operator approval exists and offers a fresh-key rotation path after leaving trading custody.

## Gates

Obtain verified exchange source/deployment and EIP-712 order types; test ZFT approvals/transfers/nonce invalidation; validate payout destinations and residual approval revocation; exercise listing/cancel/purchase/offer race paths; document royalty support; choose the real settlement asset. ZNN bridge/withdrawal limits are explicit if represented ZNN is used. BTC/Cashu payment support is a different integration and is not implied by copying NonFungible Cash’s market layout.

Mainnet sales require an independent security/operational review and explicit launch decision. The full project proposal includes this expansion so architecture and UI do not paint the app into a corner, while first proving collectible ownership transfer.
