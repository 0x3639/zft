# ZFT

**Public pictures. Private spending keys.**

ZFT is a shielded collectible app on Zenon ZVM devnet. The public site contains a gallery of completed shielded creations. Create, My collection, Receive and Recover use the existing user-held-key shielded client. A fee wallet signs creation and pays transaction fees; the spending keys stay in the browser’s encrypted collection and recovery files.

This source tree replaces the mixed legacy frontend. The old wallet/profile gallery, social feeds, profile editing and their public APIs are retired. Old stored data is left untouched and is not listed, migrated or backfilled. The historical contracts, research and private local demos remain for reproducibility.

New creations are **public by default**, with a notice before creation: the sanitized picture, title, description and creator fee account are published after creation is observed. The gallery verifies the exact public content against the pinned shielded registry. It records creation provenance, not the current holder or guaranteed finality. Publication can be retried without another blockchain transaction.

**Status: tested devnet candidate; separate release approval required.** The live app is [devnet.zft.foo](https://devnet.zft.foo/). This branch does not activate its new gallery or replace the live Workers. Real MetaMask/device qualification, independent review and resource/finality gates remain open. See the [shielded-only site contract](docs/SHIELDED-PUBLIC-GALLERY.md).

## Development and review

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm worker:check
```

The root build is the public gallery. It excludes the proof worker, recovery decoder and spending controller. The separately packaged `/shielded` client uses the same origin’s public gallery API after creation.

For a fully disposable local lifecycle with existing proof artifacts:

```sh
node research/shielded-app/check-builds.mjs
node --import tsx research/shielded-app/local-server.mjs
```

This prints a loopback URL and a temporary directory containing a sample picture and public deployment configuration. It uses local Anvil, generated disposable fee accounts and an in-memory public catalog. It never funds or sends a transaction on live devnet. The fixture can simulate one failed gallery upload with `ZFT_PUBLICATION_TEST_FAILURE=1`.

## Source and protocol

- [Shielded protocol](docs/SHIELDED-ZVM-PROTOCOL.md) and [accepted plan](docs/SHIELDED-ZVM-PLAN.md)
- [User-held-key app integration](docs/SHIELDED-APP-INTEGRATION.md)
- [Public gallery behavior and validation](docs/SHIELDED-PUBLIC-GALLERY.md)
- [Separate shielded host](docs/SHIELDED-DEVNET-APP.md) and [source distribution](docs/SHIELDED-SOURCE-DISTRIBUTION.md)
- [Historical usability validation](docs/SHIELDED-USABILITY.md) and [earlier evidence](research/EVIDENCE.md)

Contracts, circuits, recovery formats, dependency locks and the selected deployment are unchanged by the public gallery. The selected RPC is `https://devnet.zenon.foo/zvm/rpc`, chain ID `7340469`. Deployment pins are in [the selected app configuration](research/shielded-devnet/evidence/app-config.json).

ZFT-owned shielded files listed in [the scoped license](SHIELDED-LICENSE.md) are GPL-3.0-only. Third-party licenses, earlier grants, brand marks and user artwork exclusions remain intact. The original interface reference is [NonFungible Cash](https://nonfungible.cash/); this app does not claim its protocol compatibility or privacy guarantees. Older ERC-721, PS and design documents describe historical implementations, not the current public site.
