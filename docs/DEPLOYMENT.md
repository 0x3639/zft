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
| Preview command | `npx wrangler preview` |
| Branch preview builds | Enabled; `wrangler.jsonc` supplies the static assets and required `previews` block |

The Worker name is independent of the public domain. If the actual configured Worker has a different name, use that exact name in the deploy command. Cloudflare's Git integration deploys pushes to the configured production branch. The custom domain is attached under the Worker's Settings → Domains & Routes.

No account token or sponsor key belongs in this repository. The Cloudflare-managed build integration supplies deployment authentication. The prototype uses no runtime secrets or storage bindings.

The first app-branch build failed because the existing preview command had no `previews` configuration. The root `wrangler.jsonc` now configures only the static prototype and its branch previews. The real app always uses the explicit `wrangler.devnet.jsonc`; prototype previews have no sponsor, API, or database bindings. See Cloudflare's [preview configuration](https://developers.cloudflare.com/workers/previews/configuration/).

## Verify a push

Each test revision updates `design/version.json` and the matching `zft-preview-version` HTML meta tag. After pushing, compare both responses with the committed files:

```sh
curl --fail --silent --show-error https://zft.foo/version.json
curl --fail --silent --show-error https://zft.foo/
```

The expected marker is `2026-10-04.1` for the first Git-triggered deployment test. This marker identifies a preview revision; it is not a contract address, blockchain deployment, or build timestamp. Cloudflare deploys static assets as one deployment unit. Verify key CSS/JS/art resources and load the site in a browser as well.

GitHub checks may be absent even when the site is serving correctly. The Cloudflare build history is the source for build logs; the published marker proves which static revision reached the custom domain. A failed or pending build must not be reported as success based solely on Git push success.

## Full application deployment

The real alpha is hosted separately at [devnet.zft.foo](https://devnet.zft.foo/) using `wrangler.devnet.jsonc`. It includes the API, R2/D1, sponsor/indexer Durable Objects, profiles, social actions, and unique sharing images. Routes `zft.foo/art/*` and `zft.foo/metadata/*` serve canonical media from the app Worker; the apex homepage still uses the prototype Git integration above.

Follow [DEVNET-ALPHA.md](DEVNET-ALPHA.md) for the actual resources, secret handling, migrations, deployment command (`pnpm run deploy`), and remaining beta gates. This milestone has not changed the prototype's Git settings or merged the app branch.

Official references: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
