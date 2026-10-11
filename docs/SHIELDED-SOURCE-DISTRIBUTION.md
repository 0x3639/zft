# Shielded client source distribution

The project owner approved **GPL-3.0-only** for the ZFT-owned shielded client and its required source/build files on October 11, 2026. The exact scope is [license-scope.json](../research/shielded-host/license-scope.json); the grant and exclusions are in [SHIELDED-LICENSE.md](../SHIELDED-LICENSE.md). Existing third-party licenses and prior grants remain intact. This is not a repository-wide license change.

The prepared app provides a **Source and licenses** link at `/shielded/source/index.html`. It serves the GPL text, exact project source archive, dependency source archives, preserved notices, a hash inventory and this reconstruction guide on the same static host. Downloads require no account, wallet or secret. Hosting remains inactive; license approval does not approve deployment.

## Package construction

The builder enumerates physical Vite inputs from both the main and worker builds, the selected snarkjs library, the conservative production dependency closures of snarkjs/ffjavascript, and circuit/contract source dependencies. It checks every installed file against the selected package tree hashes. Package identities, legacy `licenses` declarations, original notices and dependency edges remain in the public inventory. The closure is conservative: browser stubs exclude some packages, so membership does not prove each package executes in the browser.

The project archive uses an explicit allowlist. Unlisted build inputs fail packaging. Directory traversal, links, special files and duplicate archive names are rejected. Archives use fixed USTAR metadata and contain regular files only. No recursive project copy, private working directories, recovery exports, fee keys, browser journals, raw transactions or Downloads are read. This protects the packaging boundary; it is not an isolation guarantee against a compromised build process or malicious same-user filesystem races.

Installed npm sources are preserved in each dependency archive's `package/` directory. Where npm omits preferred-source build metadata or notices, exact upstream Git files are included under `upstream/`. Each supplement has a pinned HTTPS URL, Git commit, Git blob identity, byte count and SHA-256. Preparation verifies these bytes and never executes fetched code. The source index records which installed source files match the selected upstream commit. Some packages have no standalone license file in their selected upstream source; their original package license/author metadata is retained rather than inventing a copyright notice.

The GPL license text is the canonical SPDX `GPL-3.0-only` text. Zenon design CSS retains its MIT license/notice; fonts retain OFL notices; all dependency declarations and existing grants remain unchanged. The selected brand SVGs are included only to reconstruct the existing app and remain outside the software license grant. Replace them for an independently branded distribution. No trademark rights are granted.

## Reconstruct the selected app

Use the Node version in `.node-version` and pnpm version in `package.json`. Unpack `zft-shielded-source.tar.gz` into an empty directory and enter `zft/`. Its file inventory is in `inventory.json`; verify downloaded archive SHA-256 values against a separately trusted copy of that inventory. Hash consistency by itself does not authenticate a publisher.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir research/shielded-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
node research/shielded-host/prepare-sources.mjs
node research/shielded-host/build.mjs --ui-only
```

These commands install the locked build toolchain from package registries. Dependency archives preserve the supplied runtime sources even if those registries become unavailable, but this is not a fully vendored offline compiler/toolchain. The UI-only package deliberately omits the selected proof artifacts and deployment manifest. It cannot replace the full candidate. The builder refuses an existing output directory; preserve it before an intentional rebuild.

For a full reconstruction, obtain the **seven exact public artifacts** identified by `research/shielded-devnet/evidence/app-config.json` and copy each to the corresponding local path in `research/shielded-host/artifacts.mjs`. Six files live under `research/shielded-lab/build/`; the snarkjs library comes from the locked package. Their lengths and hashes must match the unchanged configuration before building:

```sh
node research/shielded-host/build.mjs
pnpm exec wrangler deploy --config research/shielded-host/wrangler.jsonc --dry-run
```

The full package carries these artifacts at the configuration's exact relative URLs; source archives accompany them under `/shielded/source/`. A dry run does not deploy. No deployment command is part of this acceptance.

To reconstruct an upstream package tree, start with its `package/` files and overlay `upstream/` files at the same relative paths in an empty working directory, retaining both originals. The inventory identifies any divergent npm/Git file. Upstream package locks and build configuration are supplied where selected; inspect their scripts before choosing to run them. This increment does **not** execute upstream build scripts or independently reproduce the opaque published bundles. Exact installed-source hashes and matching Git files do not prove that a prebuilt binary was generated from those sources.

## Circuit and setup limits

The archive includes the unchanged creation/spend/note circuits, isolated registry/adapter contracts, circuit/setup/contract build scripts, tool pins and lockfiles. Circuit dependencies are supplied in the circomlib archive, and contract imports in the OpenZeppelin archive. Bootstrap pins circom 2.2.3 and the public powers-of-tau input. The exact selected public proving keys and verification keys accompany the full app; no user spending secrets or setup entropy are included.

Running the unchanged setup script generates **new random disposable keys**. It cannot reproduce the existing devnet keys byte-for-byte and must not overwrite them or be substituted under their pins. The selected ceremony is experimental, not independently reproduced or production-qualified. Compilation provenance and the existing devnet evidence retain their original scope.

## Validation and remaining acceptance

Current validation is recorded in [shielded-distribution-validation.json](../research/shielded-distribution-validation.json). A source-archive rebuild initially failed because the separate Vite worker graph was absent from the main module list. Packaging now captures that graph, requires the proof worker entry and includes its unchanged source. This failure is retained as regression evidence.

Validation covers source-scope enforcement, package/hash mismatch rejection, archive safety and deterministic reconstruction, public download/header behavior, full/UI-only builds and unchanged proof/configuration bytes. All earlier evidence manifests remain historical and unchanged.

No new chain transaction, hosted activation, actual wallet/device trial or independent review is implied. Remaining acceptance includes independent protocol/circuit/contract review and source/build reproduction, real MetaMask/Firefox/iOS/Android budgets, second-operator service-disappearance and independently qualified devnet finality, plus explicit approval to activate the concrete `devnet.zft.foo/shielded` host. RPC remains `https://devnet.zenon.foo/zvm/rpc`. No production or mainnet release is proposed.
