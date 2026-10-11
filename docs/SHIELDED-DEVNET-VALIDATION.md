# Shielded ZVM devnet validation

[Current validation](../research/shielded-devnet-validation.json) pins this increment; all earlier manifests remain historical and unchanged.

The current target is **only `devnet.zenon.foo`**, as directed on October 11, 2026 after merged [PR33](https://github.com/0x3639/zft/pull/33), baseline `0c0ff318559282895b6c703baf9a7a10acf7583c`. ZVM is a development network. Its test results must not be described as production acceptance. Mainnet launch and production readiness are separate future work; they do not prevent bounded experiments with disposable test assets.

All chain-backed validation in this phase uses `https://devnet.zenon.foo/zvm/rpc`, chain ID **7340469**, genesis `0x2a55e0b69e552a105d559e99b12e0cae28d6e07a3c7a9f264a1543a040ef8ea4`. Offline unit checks remain local. No alternative chain, Anvil lifecycle, production endpoint or automatic network fallback is selected for this phase. The site currently serves the public ZVM explorer at `/explorer/`; the existing ZFT Worker uses the separate `devnet.zft.foo` app domain. Selecting the ZVM network does not authorize rewriting either site's hosting routes.

## Read-only results

The [fresh runtime report](../research/shielded-devnet/evidence/runtime.json) passes seven positive/negative BN254 cases and eight generated create/spend verifier cases on the selected devnet. Verifiers were supplied through `eth_call` state overrides; their code was not deployed. The recorded block hash was rechecked. These results qualify selected execution behavior, not transaction inclusion or finality.

The [preparation report](../research/shielded-devnet/evidence/preparation.json) simulates all six constructors in dependency order, estimates their gas, and records proposed addresses and runtime hashes including constructor immutables. Earlier simulated runtimes are supplied as temporary code overrides to later constructors. The simulated account balance/nonce are overrides, not faucet funding. Constructor storage effects are not persisted. That preparation report contains no faucet, signature, transaction broadcast or receipt evidence; the later deployed results are recorded separately below.

The new [preparation tool](../research/shielded-devnet/prepare.mjs) has a fixed endpoint and identity check, a read-only RPC method allowlist, redirect rejection, per-request timeout/response limits, fresh-account/address checks, source and artifact hashes, gas/fee ceilings and block-hash recheck. Four [offline boundary tests](../research/shielded-devnet/prepare.test.mjs) cover forbidden transaction methods, wrong chain/genesis, malformed/oversized/error responses and gas/fee rejection. These are not new circuit or process-kill tests.

```sh
node --test research/shielded-devnet/prepare.test.mjs
node research/shielded-devnet/prepare.mjs NEW_PRIVATE_DIRECTORY NEW_PUBLIC_REPORT
```

The second command creates one new private test fee key locally and performs only reads. The directory must not exist. It does not read existing wallets or spending secrets. Failed runs may leave the new fee key, which must not be printed or committed. The report path is create-only. Store these files on a controlled local filesystem; this tool does not claim malicious-local-user isolation or secure erasure.

## Approved isolated devnet experiment

The user approved the six isolated contracts and their mint/claim/recovery transactions, with disposable faucet funds and a total fee cap of **1 devnet ZNN**. The experiment uses the already-built disposable Groth16 setup exclusively for valueless test assets. Six new contracts are deployed; existing v1 contracts, metadata, user files and hosted application are unchanged by this work.

| Contract          | Deployed address                             |
| ----------------- | -------------------------------------------- |
| Poseidon hasher   | `0xc9824722021e95e15ced67e00500589e44dd3289` |
| Creation verifier | `0x2b2230fadb9368808531b23144974c4e5fa7aea5` |
| Creation adapter  | `0x068c40ba0fc2fe80f4eacdd1d22df8c69a749542` |
| Spend verifier    | `0xb25fda52beb688a1c703aa8ab23796540e1565c2` |
| Spend adapter     | `0x899341433e981e4e7b14af100ecf20fc6db0a31a` |
| Shielded registry | `0x94bd9f5181a28120f2a02cb5cbc276b641ad6da0` |

These addresses were created by disposable fee account `0x2adeC7860E6e2Dc02877c429cd0f8EAE55aefDcE` at nonces 0–5. The account holds only disposable transaction-fee authority, never end-user spending authority. At the recorded 50.0024 gwei fee and gas estimates plus 20% margin, the six deployment gas limits total **0.397003805268 devnet ZNN**. This is an observed plan, not a guarantee or monetary quote. The relay floor is inherited from earlier devnet observations and must be revalidated before broadcasting.

## Transaction and recovery results

The [deployment report](../research/shielded-devnet/evidence/deployment.json) records six successful receipts with exact addresses/runtime hashes and checked registry/adapter relationships. The [lifecycle report](../research/shielded-devnet/evidence/lifecycle.json) records three subsequent transactions: creator commitment, creation reveal after naturally produced devnet blocks, and claim to fresh authority. Each receipt was observed with two descendant blocks and its block hash rechecked; this is an RPC observation rule, not an independently qualified finality claim.

| Check              | Result                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation           | A local disposable client generated a note, encrypted/saved/read back its recovery, produced a real Groth16 proof and submitted the commitment/reveal to the new devnet registry. The image/metadata-bound asset was observed.                                       |
| Fresh-secret claim | The saved bearer was reopened, a fresh secret/randomness and destination recovery saved/read back, a witness rebuilt from public events, and the real spend accepted.                                                                                                |
| Rejection cases    | Read-only calls rejected reveal before commitment, unknown root, changed nullifier, changed output, the consumed exact proof and a distinct valid proof made from the consumed bearer. These six checks are `eth_call` execution results, not reverted transactions. |
| Recovery           | A new Node process reopened the saved claim, verified deployment/asset pins, rebuilt events directly from the same devnet RPC, and recovered the original successor as observed and unspent. It did not read the fee key or require a ZFT index/sponsor.             |
| Limits             | No real MetaMask/browser/mobile acceptance, independent operator, actual network-response-loss injection, reorg, power-loss or new SIGKILL qualification is claimed. The client and fee wallet were scripted disposable local processes.                             |

The [fee report](../research/shielded-devnet/evidence/fees.json) rechecks all nine receipts. Actual fees were **0.430768925916 devnet ZNN**; the sum of signed transaction gas limits times fee prices was **0.5215868849688 devnet ZNN**, below the approved cap. The faucet was requested once. Initially its HTTP success arrived before funds became visible; the first run stopped before signing/sending, then resumed after the balance appeared. A bounded funding wait was added. No fee-replacement transaction or second faucet request was used.

## Harness and reproduction

The new [runner](../research/shielded-devnet/runner.mjs) accepts only the fixed chain identity, the six approved init-code hashes and zero-value calls to the isolated registry's three experiment methods. It uses a dedicated private fee directory and exclusive process lock. Before dispatch, it signs and saves the exact transaction in an exclusive, synced journal, reserves its maximum fee under the aggregate cap and revalidates chain/nonce/target. Resumption reuses the original raw transaction/hash; an unrecognized consumed nonce stops the run. There is no automatic fee replacement. A stale lock after process death needs explicit operator inspection, not automatic deletion. Filesystem paths and locks assume a controlled local machine; they do not defeat a malicious same-user race or establish hardware crash durability.

Eight offline tests (the [runner cases](../research/shielded-devnet/runner.test.mjs) plus the preparation cases) cover read-only RPC restrictions, network identity, RPC bounds/errors, fee ceilings, exact signed transaction binding, no-overwrite journals and canonical devnet app configuration. CI runs only these offline cases; it never funds or broadcasts to devnet. The actual devnet sequence was run once; receipt/recovery readbacks are separate checks. Existing protocol, app, circuits and contracts are unchanged.

```sh
node --test research/shielded-devnet/*.test.mjs
# Only for the explicitly approved retained experiment and private test directories:
node research/shielded-devnet/deploy.mjs PRIVATE_FEE_DIRECTORY NEW_REPORT --execute-approved-devnet
node --import tsx research/shielded-devnet/lifecycle.mjs PRIVATE_FEE_DIRECTORY PRIVATE_CLIENT_DIRECTORY NEW_REPORT --execute-approved-devnet
# Fresh-process read-only recovery needs no fee key:
node --import tsx research/shielded-devnet/recover.mjs PRIVATE_CLIENT_DIRECTORY PINS_FILE
```

The deployment runner is intentionally bound to this approved preparation record/account. It is not a general deployment command. Another deployment requires a separately selected plan and authorization. Private key/password/bearer/recovery files remain outside Git; committed records contain only public hashes, receipts, pins and results. The client saved/read back encrypted recovery before submission. This is automated file acknowledgement, separate from PR33's native browser save/reselection evidence.

A [canonical public app configuration](../research/shielded-devnet/evidence/app-config.json) passes the unchanged app parser and pins this actual devnet deployment. Its relative artifact URLs require a separately prepared opt-in app host serving the exact pinned files; it does not claim that the explorer or existing ZFT Worker serves those assets. No hosted app build was activated here.

## Remaining acceptance

Real MetaMask and Firefox/iOS/Android flows, device budgets, independent protocol/circuit/contract reproduction, artifact licensing/provenance, and a second operator spending with ZFT services unavailable remain unqualified. Production ceremony and mainnet release remain future gates. This devnet transaction experiment does not claim to close them. End users continue to hold spending keys; Cloudflare and the test fee account do not become custodians.
