# Research and capability evidence

Current local increment: [public PS presentation](../docs/PS-PUBLIC-PRESENTATION.md), with separate credential proof, optional wallet signing-key endorsement and issuer snapshot. [Current source evidence](ps-presentation-validation.json) records 230 local tests, 63 lab controls, 241 app tests and precise browser limits. The product-interface manifest is now historical.

Observed 2026-10-04. Public services can change; rerun these checks before implementation/deployment.

## Sources

- [NonFungible Cash](https://nonfungible.cash/), [protocol explanation](https://nonfungible.cash/how-it-works?view=cryptography): image-embedded Pointcheval–Sanders credentials, blind issuance/transfer, atomic spent-nullifier tracking by an off-chain mint. The site explicitly documents issuer and served-JavaScript trust. These are documentation claims, not an independent audit.
- [Pillar Stance](https://www.0x3639.com/Pillar-Stance/), [linked evaluation context](https://www.0x3639.com/Pillar-Stance/evaluate-the-work.txt): source pointers and the site author’s assessment. An assessment is not independent implementation verification.
- [Sol’s ZVM proposal](https://forum.zenon.org/t/zenoglyphs-vm-zvm/2371): NoM-ordered deterministic EVM derivation, wallet lanes, milestone acceptance, and asset-exit limitations. Source publication/independent replay remain proposal dependencies.
- [Live explorer](https://devnet.zenon.foo/explorer/), [about](https://devnet.zenon.foo/explorer/about), [node](https://devnet.zenon.foo/explorer/node): current chain configuration and directly observable activity.
- [Karum](https://devnet.zenon.foo/karum/), [market explanation](https://devnet.zenon.foo/karum/about): an existing NFT market on the same RPC, with signed listings and on-chain purchases.
- [ERC-721](https://eips.ethereum.org/EIPS/eip-721), [EIP-712](https://eips.ethereum.org/EIPS/eip-712), [EIP-2537](https://eips.ethereum.org/EIPS/eip-2537): relevant primary standards.
- [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/), [R2](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [storage choices](https://developers.cloudflare.com/workers/platform/storage-options/), [Durable Object rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/): official hosting architecture references.

## Direct observations

JSON-RPC: `https://devnet.zenon.foo/zvm/rpc`.

| Check | Observed result |
| --- | --- |
| `eth_chainId` | `0x7001b5` / 7340469 |
| `web3_clientVersion` | `reth/v1.10.2-8e3b5e6/x86_64-unknown-linux-gnu` |
| Explorer NoM chain | 69 |
| Explorer finality parameter | 6 momentums |
| Existing collection ERC-165 ERC-721 query | True for both collections below |
| BLS G1/G2 addition and single-point MSM | Expected nonzero generator results |
| BLS pairing of generators | False, as expected |
| BLS pairing cancellation with opposite G1 points | True, as expected |

Existing collection addresses observed in the node’s public `/zvm/api/info` metadata:

- `0xac416fb3e090af9fcecdf730d3818e9ade7e9993`
- `0x6d4cb83aa825297c5131e7741a89341f1db3fb5c`

Exact calls/responses are saved in [bls-probe.json](bls-probe.json) and [erc721-probe.json](erc721-probe.json). Both use `eth_call`, which simulates execution without sending transactions. ERC-165 selector `0x01ffc9a7` was called with ERC-721 interface ID `0x80ac58cd`. BLS addresses `0x0b`–`0x0f` were checked against EIP-2537 generator/arithmetic expectations. These are capability smoke checks, not exhaustive cryptographic compliance or security tests.

The public GitHub repository listing for `sol-znn` showed no repositories with `zvm`, `glyph`, `karum`, or `evm` in their names at the time of inspection. This does not establish that the source is unavailable under every possible name or location. Obtain the actual running ZVM spec/source and canary deployment guidance before implementing against assumptions about fork support, limits, reorgs, or finality.

## Inferences and project choices

The live ERC-721 and BLS responses support feasibility of EVM-based collectibles and further signature research. The proposed v1 uses ordinary ECDSA ownership rotation and does not depend on BLS. Moving PS verification on-chain alone cannot conceal an issuer’s signing secret in a public EVM; a faithful blind-signing version would still need an issuer or a different protocol.

ZFT’s specifications and interface are original proposed designs, not inspected NonFungible Cash or ZVM source forks. The first product has public transfer history and relies on current ZVM devnet services. Source/license checks and production security review belong to implementation/release acceptance.


## PS reference snapshot on October 6 2026

The user has moved PS/BLS12-381 parity from a deferred expansion to the next design milestone. [The proposal](../docs/PS-CREDENTIAL-PROTOCOL.md) preserves the existing public ERC-721 alpha while specifying an isolated PS prototype and its issuer/native-NFT tradeoff.

[Current snapshot evidence](ps-reference-2026-10-06.json) traces the reference HTML to its current app, wallet and PS modules and records hashes. The wallet requests committed issuance v3 and calls blind transfer; help text still explains an older issuance path. Static client inspection cannot establish server enforcement, exact interoperability or security. No reference transactions were executed and no reference code is vendored. C1 must freeze licensed sources, exact transcripts and independent vectors before claiming equivalence.


## PS reference-core fixtures on October 6 2026

[Validation evidence](ps-profile-validation.json) records the first isolated C1 fixture set, exact source hashes, 42 passing verifier tests, Python reproduction and three broken-check controls. [The profile](../docs/PS-CRYPTOGRAPHIC-PROFILE.md) distinguishes static reference observations, derived lab issuer equations and additional validation policy. The [dependency inventory](ps-lab/dependencies.json) records pinned artifacts and retained license notices. Neither these same-author transcript implementations nor their distinct curve backends establish independent review or live reference interoperability. C1 remains in progress; no deployment is performed.


## Local PS engine on October 7 2026

[Local engine validation](ps-local-engine-validation.json) records 28 lifecycle/recovery tests, four deliberately broken controls, the ephemeral walkthrough and source hashes at PR #13. The [local profile](../docs/PS-LOCAL-ENGINE.md) introduces scoped ZFT attributes/transcripts and dedicated issuer/client SQLite stores without modifying the frozen reference verifier, generator or vector bytes. Its actual process kills and concurrent writers cover selected local boundaries, not independent cryptographic review, all storage failure modes or hosted/device behavior. The older [profile evidence](ps-profile-validation.json) remains a historical record of its source revision; each evidence file hashes its own recorded source revision. ZVM availability is not needed and no deployed resources change.

## Local PS recovery boundaries on October 7 2026

[Historical recovery validation](ps-recovery-validation.json) records the PR #13 merge baseline and PR #14 source hashes for the expanded C3 harness: 47 local tests, 14 actual process-kill locations, eight negative controls and bounded SQLite FULL/READONLY/BUSY failures. Exact recovery survives client/issuer transaction interruption, and replaying an older completed recovery does not revive a later-spent credential. Temporary page limits do not simulate a full host disk, hardware failure or malicious rollback. The [local profile](../docs/PS-LOCAL-ENGINE.md#validation-and-remaining-gates) lists the tested boundaries and remaining gates. Earlier source manifests remain historical. No cryptographic transcript, frozen fixture, application runtime or deployed resource changes.

## Local PS signed state observations

[Historical state validation](ps-state-validation.json) records the PR #14 merge baseline and PR #15 source hashes for the separate `zft-ps-local-state-v1` profile: 76 local tests, 16 SIGKILL locations and 14 mutation controls, including 29 new observation tests and six new controls. It covers a separately pinned Ed25519 key, full showing/context binding, short-lived challenges, durable one-use acceptance and remembered sequence checks. The RFC 8032 first Ed25519 test vector checks primitive behavior; same-author protocol composition remains independently unreviewed. A fresh observer accepting an older issuer snapshot and an unspent receipt remaining acceptable briefly after a later spend are explicit tested limits. See [encoding, acceptance and trust scope](../docs/PS-LOCAL-STATE.md). Earlier manifests, frozen reference artifacts, credential/issuer store logic and deployed resources are unchanged.

## Local PS observer recovery

[Historical observer recovery validation](ps-observer-recovery-validation.json) records the PR #15 merge baseline and PR #16 source hashes: 88 local tests, 21 actual process-kill locations and 17 mutation controls. Twelve new cases exercise challenge/request/receipt interruptions, bounded SQLite FULL/READONLY/BUSY errors and expiry after a failed persistence attempt. Three mutations demonstrate partial preparation/request commits and missing rollback after a failed COMMIT. [Qualification details](../docs/PS-LOCAL-STATE.md#observer-recovery-qualification) retain the limits: no power-loss, real disk exhaustion, arbitrary I/O, corruption/rollback or device qualification. The earlier manifests are historical; cryptographic encodings, keys, fixture bytes and transaction ordering are unchanged. Added boundary callbacks are inert by default, and no deployed resources or application code are changed.

## Local PS parser boundaries

[Historical parser validation](ps-parser-validation.json) records the PR #16 merge baseline `32d84dd` and PR #17 source hashes: 101 local tests, 21 unchanged process-kill locations and 21 mutation controls. Thirteen new tests cover ten artifact families, 471 fixed malformed variants / 578 rejected calls, exact UTF-8 byte limits, depth/numeric encodings and maximum asset recovery/export. Each rejection preserves the participating database rows; valid operations still succeed. Four temporary parser mutations fail named regressions. [Scope and limits](../docs/PS-LOCAL-ENGINE.md#parser-boundary-qualification) distinguish this selected same-author corpus from exhaustive fuzzing or independent review. No implementation correction was required. Earlier manifests and all cryptographic/storage implementation files remain unchanged; prior app/reference results are inherited evidence and PR CI runs them again.

## Local PS PNG envelope and review preparation

[Historical image validation](ps-image-validation.json) records the PR #17 merge baseline `a7427d4` and PR #18 source hashes: 126 local tests, 28 mutation controls and 21 unchanged process-kill locations. Twenty-five new image tests and seven new controls exercise versioned PNG parsing, full digest and PS asset binding, pinned trust, claim/cancel/recovery, stale copies and public-copy envelope removal. An initial chunk-capacity regression failed before reserving space for the envelope and passes afterward. Three original normalized fixtures reproduce exactly against the unchanged root codec; pixel decoding, v1 rejection of the new private format and v1 roundtrip checks pass. The image lifecycle demo, frozen lab install, typecheck and all 229 app tests also passed locally. Reference lab validation remains explicitly inherited evidence; CI reruns its checks.

The [file specification](../docs/PS-IMAGE-ENVELOPE.md) bounds inputs and records plaintext bearer and research limitations. The [review packet](../docs/PS-REVIEW-PACKET.md) organizes independent handoff with no reviewer or result claimed. All six earlier manifests, frozen reference artifacts, local credential/state implementations, root dependencies, v1 runtime and deployed resources remain unchanged.

## Local PS encrypted file vault

[Vault validation](ps-vault-validation.json) records merged PR #18 (`96ed208`) and current source hashes: 148 local tests, 35 mutation controls and the same 21 process-kill locations. Twenty-two new tests cover encryption, password/tamper/lock checks, pinned identity, bounded schemas, exclusive private files, exact encrypted recovery readback and lost-response recovery; seven temporary mutations prove targeted regressions detect weaker handling. The RFC 7914 scrypt vector and a WebCrypto AES-GCM payload check qualify primitive/API behavior, not independent protocol composition. Older valid exports and old-password copies remain readable by design.

The [vault specification](../docs/PS-LOCAL-VAULT.md) distinguishes encrypted export files from plaintext working databases and records limits on memory, fsync, rollback, browser/device and password qualification. Earlier app/reference checks are inherited evidence from PR #18 and rerun by CI. Seven prior PS validation manifests, reference artifacts, credential/state/image implementations, root dependencies, v1 runtime and deployed resources remain unchanged.


## Local PS browser console, 2026-10-08

[ps-browser-validation.json](ps-browser-validation.json) records the isolated browser/controller/loopback HTTP increment over merged PR #19. It covers 160 local tests, 40 mutation controls, unchanged 21 kill locations, source/baseline hashes and explicitly partial browser acceptance. The encrypted recovery used in the UI restore check came from the actual API; automated browser saving was not confirmed. All eight earlier PS manifests remain frozen historical evidence. The October 8 product direction accepts ZFT-managed PS credentials initially and defers a possible MetaMask display Snap.

## Browser PS vault protection

[Current browser-vault evidence](ps-browser-vault-validation.json) records the PR #20 merge baseline `b859b3e`, 180 local tests, 45 mutation controls, 21 unchanged SIGKILL locations and seven separate real IndexedDB checks. The [browser vault](../docs/PS-BROWSER-VAULT.md) adapts unchanged validators, runs scrypt/WebCrypto in a worker and saves only ciphertext/revisions. Actual browser open, re-encrypt, commit, lock and reopen passed. Brave console download/reselection passed; in-app browser-vault download capture still timed out. Root app/reference checks are inherited from PR #20 CI and rerun by PR CI. All nine older manifests remain historical. Full browser proof execution, independent review, devices, wallet/product integration and hosting remain open.

## Browser PS credential execution

[Current browser-client evidence](ps-browser-client-validation.json) records merged PR #21 baseline `2a2bc71`, 203 local tests, 52 controls and 21 unchanged SIGKILL locations. [Browser client](../docs/PS-BROWSER-CLIENT.md) constructs proofs in a Worker, stores encrypted journals and submits only protocol requests/retrieval capabilities to the loopback issuer. A real Worker-generated recovery download/reselect, acknowledgment, lost-return submission and third-client recovery passed; seven separate real IndexedDB checks passed. App/reference checks remain inherited from PR #21 CI and are rerun by PR CI. Ten earlier manifests are historical. [PS-OWN-01](../docs/PS-REVIEW-PACKET.md#open-review-item-former-holder-and-cross-asset-forgery) remains open for independent review; no release or cryptographic security conclusion is implied.

## Browser PS artwork increment

[Historical browser-artwork evidence](ps-browser-artwork-validation.json) records the isolated PNG/display increment after PR #22: 216 local tests, 58 controls, 21 unchanged SIGKILL locations, exact generated source hashes and actual desktop PNG download/claim/cancel/reopen checks. [Scope](../docs/PS-BROWSER-ARTWORK.md) distinguishes the Node decoder test adapter from native browser acceptance and leaves general normalization, devices, resource qualification and independent PS-OWN-01/C1/C4 review open. Eleven earlier PS manifests are historical records; app/reference checks are inherited locally and rerun in CI.


## PS product interface

[Current product-interface evidence](ps-product-interface-validation.json) records baseline PR #23 (`673f89d`), 235 app tests, 218 lab tests, 58 lab controls and three app controls. The [React interface](../docs/PS-PRODUCT-INTERFACE.md) adds bounded JPG/PNG normalization, scoped item views and recovery-driven operations. Actual desktop download/reselection, recipient claim, cancellation and third-client restore are distinct from Node test adapters. Twelve previous PS manifests remain historical. No hosted issuer or independent review completion is claimed.
