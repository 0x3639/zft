# Cloudflare prototype deployment

The static design prototype is hosted at [zft.foo](https://zft.foo/). This deployment serves the contents of `design/` at the domain root. It does not deploy Solidity, an API, a vault, or live collectible operations.

## Git integration settings

| Setting | Value |
| --- | --- |
| Git account | `0x3639` |
| Repository | `zft` |
| Production branch | `main` |
| Build command | Empty; the prototype is plain HTML/CSS/JavaScript |
| Root directory | Repository root |
| Deploy command | `npx wrangler deploy --name zft-preview --assets ./design --compatibility-date 2026-10-04` |
| Worker name | Must match the name in the deploy command |
| Branch preview builds | Disabled initially; configure separately when a Wrangler config is committed |

The Worker name is independent of the public domain. If the actual configured Worker has a different name, use that exact name in the deploy command. Cloudflare's Git integration deploys pushes to the configured production branch. The custom domain is attached under the Worker's Settings → Domains & Routes.

No account token or sponsor key belongs in this repository. The Cloudflare-managed build integration supplies deployment authentication. The prototype uses no runtime secrets or storage bindings.

## Verify a push

Each test revision updates `design/version.json` and the matching `zft-preview-version` HTML meta tag. After pushing, compare both responses with the committed files:

```sh
curl --fail --silent --show-error https://zft.foo/version.json
curl --fail --silent --show-error https://zft.foo/
```

The expected marker is `2026-10-04.1` for the first Git-triggered deployment test. This marker identifies a preview revision; it is not a contract address, blockchain deployment, or build timestamp. Cloudflare deploys static assets as one deployment unit. Verify key CSS/JS/art resources and load the site in a browser as well.

GitHub checks may be absent even when the site is serving correctly. The Cloudflare build history is the source for build logs; the published marker proves which static revision reached the custom domain. A failed or pending build must not be reported as success based solely on Git push success.

## Full application deployment

The first implementation now has an explicit `wrangler.devnet.jsonc`, pinned tooling, React build, Worker API, R2/DO bindings, and a deployed contract manifest. The configuration is deliberately not named `wrangler.jsonc`, so the prototype deploy command above keeps serving static `design/` files. Follow [DEVNET-ALPHA.md](DEVNET-ALPHA.md) for setup and the eventual domain promotion. OG routes, profile/social parity, and production indexing remain beta gates in [IMPLEMENTATION.md](IMPLEMENTATION.md).

Official references: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
