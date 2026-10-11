# Shielded devnet static app candidate

This package prepares the existing shielded interface for the user-selected ZVM devnet. It is **built and tested locally, not activated on Cloudflare**. The original package was prepared against merged PR34, `6c9d0d007445603ffe9f664351697e64d0fafc5b`; its [validation record](../research/shielded-host-validation.json) is historical and unchanged. The [current configuration-pinning validation record](../research/shielded-host-pins-validation.json) covers the packaging fix against merged PR35, `84d268dfa71579de1beb1f593edda3364e1a2303`.

## Selected deployment and interface

The standalone entry opens only the shielded collection, creation, receive and recovery pages. Its “Use ZVM devnet” button selects the exact [public configuration](../research/shielded-devnet/evidence/app-config.json) from the [completed devnet experiment](SHIELDED-DEVNET-VALIDATION.md): RPC `https://devnet.zenon.foo/zvm/rpc`, chain 7340469 and registry `0x94bd9f5181a28120f2a02cb5cbc276b641ad6da0`. The public file remains canonical and byte-identical; it can be downloaded separately. The generic opt-in app retains its configuration-file selector and v1 navigation. Normal v1 builds still exclude shielded implementation.

An optional host presentation property in the shared app supplies this configuration and branded links. Configuration reads retain the generation/lock checks before and after asynchronous work. This changes presentation and deployment selection, not the protocol, circuits, contracts, controller, wallet, proof worker, recovery encoding or saved-file acknowledgement. All note secrets and passwords remain client-side. An injected real wallet is required for fees and public creation authorization; the host has no fee wallet, funding/mining shim, sponsor or signing service.

## Exact public package

`research/shielded-host/build.mjs` first requires the complete canonical configuration to match the fixed SHA-256 `0x9a1a07626e19c3174c2c8261495f54b2603a4fee0b79fb2bc0096b6eaa803559`, verified against merged PR34. This pins every contract address/code hash, deployment block, artifact hash/length/path and network field. It then validates the existing deployment's seven public proof artifacts before building. Missing, changed, oversized or symlinked files fail; it never creates another setup or substitutes fresh proving material. Each artifact's exact length and SHA-256 must match the selected configuration. Generated public routes are enumerated in `asset-manifest.json` with type, length and digest. The package contains 43 public files, 14,832,838 bytes in total. The largest file is the 4,619,114-byte spend proving key. These fit Cloudflare's documented [25 MiB individual static-asset limit](https://developers.cloudflare.com/workers/platform/limits/).

The standalone Vite entry uses `/shielded/` paths and no public-directory copy. Only generated UI assets, three selected brand images, the canonical public configuration and seven pinned proof files enter the public directory. The test wallet, legacy application entry, PS issuer and existing sponsor API are excluded. The unchanged public proof worker fetches and hashes exact bytes before executing the selected library and proving locally.

The build writes a separate dependency inventory and copies available top-level notices from 19 package versions used by the build, including the prebuilt snarkjs package. This is a partial provenance inventory, not a complete transitive license assessment. The installed snarkjs 0.7.6 and circomlibjs 0.1.7 packages declare GPL-3.0; project source remains UNLICENSED pending the existing license decision. Notices currently accompany the local package and are not public app routes. **Public redistribution/provenance acceptance is still open for a hosted test package; using devnet does not resolve it.** No upstream website bundle was copied.

## Proposed hosting boundary

The prepared [Worker configuration](../research/shielded-host/wrangler.jsonc) proposes a separate Worker named `zft-shielded-devnet-test`, with only an ASSETS binding, at `devnet.zenon.foo/shielded*`. Workers.dev and preview URLs are disabled. The [Worker](../research/shielded-host/worker.mjs) accepts GET/HEAD for exact app pages and listed public assets. Unknown routes, queries, encoded paths and write methods fail closed. It has no RPC proxy, request-body upload, cookie/authentication service, secret binding, database, cron, fee key or storage mutation. Existing `/zvm/rpc`, `/explorer/`, v1 Worker and apex routes are outside the proposed route.

The Worker executes before static assets, following Cloudflare's [asset-binding configuration](https://developers.cloudflare.com/workers/static-assets/binding/). It constructs a fresh ASSETS request without caller cookies, authorization, ranges or conditional headers. Missing assets fail instead of falling back to app HTML. Every response uses no-store, nosniff, no-referrer, noindex and cross-origin isolation headers. CSP permits the selected RPC, same-origin public files, verified Blob proof code and WebAssembly. Browser-delivered JavaScript and Cloudflare remain trusted for delivery; these headers do not protect against a compromised host or another compromised application on the same origin. Applications at `devnet.zenon.foo` share an origin and can access origin-scoped browser storage. Platform request metadata may still be visible to the hosting provider.

A Worker dry run confirms only the ASSETS binding and a bundle of approximately 11 KiB. It does not establish account/zone access, route conflicts, actual Cloudflare asset behavior or publication. Worker-first requests can consume the account's Worker request allowance, as described in [Cloudflare's billing documentation](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). No resource or route has been created.

## Validation and reproducibility

Six focused offline tests cover wrong deployment identity, internally consistent substitutions of every contract/artifact pin, artifact corruption/missing files, exact route selection, rejected write methods, stripped credentials, HEAD handling and fail-closed missing assets. Type checking covers both the shared application and standalone entry. The UI-only CI build deliberately omits all deployment proof material and emits no deployable asset manifest; fresh disposable CI setups are never substituted for the deployed pins.

Existing regression checks passed: 249 app tests, eight shielded controller tests and eight mutation controls, plus default/opt-in build separation. Those existing suites use their disposable local fixtures, including simulated local chains; they are regression evidence, not new devnet transactions or acceptance on another live network. New browser deployment verification reads only the selected actual ZVM devnet. No wallet was connected and no signature, faucet request, deployment or transaction occurred in this increment.

The recorded in-app browser loaded the exact final static package, rendered the selected devnet interface, verified the real deployment's code/relationships, showed chain 7340469 and the selected registry, and had no console errors during that check. All brand images loaded at its default 595-pixel viewport without horizontal overflow. Navigation and lock were checked. A later Worker-only refinement sanitizes asset-binding exceptions; it has focused unit and dry-run coverage, not a repeated browser trial. Public package bytes are unchanged. This is a local HTTP preview with real devnet RPC reads, not a hosted HTTPS, real MetaMask, new browser proving/download/submission or phone qualification. [Browser evidence](../research/shielded-host/evidence/browser.json) and the [package inventory](../research/shielded-host/evidence/package.json) pin its scope.

```sh
node --test research/shielded-host/host.test.mjs
pnpm exec tsc --noEmit --project research/shielded-host/tsconfig.json
# Nondeployable UI-only CI check:
node research/shielded-host/build.mjs --ui-only
# Exact existing devnet proving files must already be available:
node research/shielded-host/build.mjs
pnpm exec wrangler deploy --config research/shielded-host/wrangler.jsonc --dry-run
node research/shielded-host/preview.mjs
```

Build outputs are create-only under the ignored `research/shielded-host/build/` directory. Preserve or explicitly remove only the generated output before rebuilding. Do not regenerate the deployed setup. The local preview serves only the prepared files, binds loopback and has no injected wallet, local chain, funding or mining route. Stop it after inspection.

## Activation and remaining work

Before publication, resolve the recorded source/dependency redistribution acceptance, verify the exact build and account/zone/route selection, and obtain explicit approval for this new Worker and only `devnet.zenon.foo/shielded*`. The earlier six-contract transaction approval does not authorize this hosting change. Then perform HTTPS asset/hash/header checks and real-wallet/device trials using disposable devnet assets under a separately agreed transaction budget. An independently checked second-operator service-disappearance drill remains open.

Independent protocol/circuit/contract review, actual MetaMask/Firefox/iOS/Android and resource budgets, independent chain/finality evidence and availability remain open. Production/mainnet launch and ceremony are separate future work. No additional contract deployment, protocol migration, custody service, marketplace or Snap is introduced.

## PR review follow-up

PR35 merged before the following fix was published; this follow-up addresses its unresolved [CodeRabbit finding 4241358263](https://github.com/0x3639/zft/pull/35#discussion_r4241358263). The review identified that the original packaging guard checked only RPC, chain, genesis and registry address. Another contract pin or a mutually consistent artifact/hash substitution could therefore pass. The guard now additionally compares the entire canonical configuration with the fixed digest above; the original network/registry checks remain. The approved file and all public package bytes remain unchanged.

A new regression tests 34 syntactically valid configuration variants: every contract address/code hash, all seven artifact hashes (with matching inner pins), lengths and paths, plus deployment block. Against reviewed commit `97e8968`, 33 unselected variants were accepted and the test failed with the named assertion `packaging must reject every unselected configuration`. The corrected guard rejects all 34 while accepting the original configuration. All six host tests pass. Both the complete package and UI-only check rebuild successfully; the complete public asset inventory and dependency inventory match the prior package byte-for-byte. This packaging-only repair adds no browser, provider, device, live transaction or crash qualification. The earlier browser trial remains scoped to its recorded source and public bundle hashes.
