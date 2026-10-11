# Shielded desktop browser acceptance

The unchanged opt-in app from merged [PR32](https://github.com/0x3639/zft/pull/32), baseline `05d26554219650798d09b4779cf0d9d77660dcd4`, completed a local desktop lifecycle on October 11, 2026. End users retain spending secrets; the local verifier contracts enforce the transfers. This increment records evidence and adds an offline export comparison tool. It changes no application, protocol, circuit, contract, dependency or deployment configuration.

[Current validation](../research/shielded-browser-validation.json) pins source and evidence. The [PR32 manifest](../research/shielded-app-validation.json) and its partial in-app-browser trial remain historical and unchanged. The successful download path in this trial was native Brave; the in-app browser's earlier download limitation has not been fixed or qualified.

## Observed lifecycle

| Surface                        | Observed result                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brave 151.1.93.138, macOS      | Public configuration/runtime pins checked; disposable browser fee wallet connected; browser prepared a creation with a fresh secret and encrypted recovery.                                                                                                                                                  |
| Native Save/Open dialogs       | Creation recovery was downloaded and the exact file selected again. Proof and submission were unavailable before acknowledgement. All exports used a new temporary directory; Downloads originals were untouched.                                                                                            |
| Browser worker and local Anvil | Real creation proofs drove the explicit commitment and reveal, separated by an explicit two-block test advance. Creation became observed. No public chain transaction occurred.                                                                                                                              |
| Receive in Brave               | Original bearer imported; a fresh secret/randomness and claim recovery prepared; exact saved-file acknowledgement preceded the real spend proof and submission. The successor became observed.                                                                                                               |
| Old bearer                     | Preparing another claim from the original bearer was rejected. A separate local-chain read confirmed its nullifier was spent and the expected successor was published and unspent at the recorded block.                                                                                                     |
| Separate in-app browser        | An empty journal imported the saved claim recovery without connecting a fee wallet. Proof/submission stayed disabled pending observation/acknowledgement. Observation recovered the same operation as observed.                                                                                              |
| Reload of the recovery browser | Configuration and password were required again. Unlocking the persisted operation required explicit observation again; the same operation returned to observed.                                                                                                                                              |
| Fresh Node process             | Decrypted both recovery exports with Node's PBKDF2/AES-GCM APIs, then validated them with the unchanged protocol code. Creation/source/destination matched the saved bearers exactly; secret/randomness changed while image/metadata/asset remained identical. The public PNG was exactly canonical artwork. |

The [browser record](../research/shielded-browser/evidence/browser.json) pins the source and exact served bundle. The bundle is byte-identical to PR32's recorded final build. [Export checks](../research/shielded-browser/evidence/exports.json), [local-chain observation](../research/shielded-browser/evidence/chain.json), [four rejected input combinations](../research/shielded-browser/evidence/negative.json), and a [reload screenshot](../research/shielded-browser/evidence/reload-recovered.png) retain the public results. No bearer, decrypted record or password is committed.

The Brave tab was reloaded, but user activity moved to another page before restoration. Completed reload recovery refers specifically to the separate in-app browser. Both browsers used one operator, one machine and the same disposable chain; this is not an independent-operator disappearance drill. The test password was generated by the test controller and entered locally; spending secrets were generated by the browser app. The injected fee wallet is not MetaMask.

## Reproduce locally

Follow the [existing integration reproduction](SHIELDED-APP-INTEGRATION.md#reproduction), including the frozen local circuit setup and opt-in build checks. Start the disposable local server, select its printed `config.json` and `picture.png`, then exercise the sequence above using native browser save/open dialogs. Keep the original and successor bearer files separate. The local test server's public-address funding and block-advance controls are absent from both product builds.

The offline checker accepts seven explicit paths, in this order:

```sh
node --import tsx research/shielded-browser/verify-exports.mjs \
  CONFIG_JSON CREATION_RECOVERY_JSON CLAIM_RECOVERY_JSON \
  ORIGINAL_BEARER_PNG SUCCESSOR_BEARER_PNG PUBLIC_PNG TEST_PASSWORD_FILE
```

Use disposable fixtures only. The password file contains the exact test password bytes without a trailing newline and should be private. The checker performs no RPC/network requests. It prints only public hashes and boolean results; failures use a fixed message without assertion operands, paths or decrypted material. Owned byte-buffer clearing is best effort; strings, runtime memory and other copies are not erased. The four recorded negative runs substitute a public PNG for a bearer, the old bearer for the successor, creation recovery for claim recovery, or incorrect password bytes. Every run rejects with the fixed message and empty standard output.

Random browser exports stay local. Their committed hashes bind this observation but do not let another operator reproduce those secret bytes. Reproduction creates new fixtures and checks the same relationships. Automated controller tests, mutation controls and CI remain separate evidence; this manual trial adds no process-kill, power-loss or adversarial-circuit cases.

## Remaining gates

- Actual MetaMask, Firefox, iOS and Android; in-app-browser downloads; measured device latency/memory/download budgets.
- Independent protocol/circuit/contract review and reproduction, production ceremony/setup, artifact provenance and dependency licensing.
- Independently qualified ZVM submission/finality and a second operator recovering and spending with ZFT frontend/index/sponsor/backup unavailable.
- Exact release candidate and explicit staging approval. The normal build still excludes the shielded implementation; no hosted activation occurred.

RPC observation is not a light client or finality guarantee. Hashes do not establish availability. Recovery files and old bearers can race until chain enforcement resolves them. Trusted delivered JavaScript, wallets and proving code remain part of the user's security assumptions. No production privacy, independent audit, memory zeroization or hardware durability is claimed.
