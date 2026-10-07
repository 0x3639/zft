# Sponsor operational qualification

R7.5, 2026-10-06. A stalled `sendRawTransaction` previously held the sponsor's global promise queue, blocking unrelated challenge creation, authentication and operation polling. A local workerd regression reproduces that blockage on merged baseline `20c2c40`: authentication exceeds the two-second test bound while broadcast is deliberately unresolved.

## Concurrency and storage

`Sponsor` retains the existing Durable Object namespace, name, SQLite storage, job keys, quotas and alarms. No migration, key rotation, binding or route change is required.

- Submission and alarm reconciliation retain one serial queue around all nonce/outbox reads, signing, durable persistence and broadcasts. Retries keep the same authorization digest and signed transaction bytes.
- Challenge creation and authentication use an independent serial queue. Signature verification, challenge deletion and both request quotas stay within that critical section. Invalid proofs do not consume a challenge. Valid proofs are consumed even if a later quota check refuses admission, matching the previous behavior. A rejected request does not poison subsequent work. Authentication counters and operation-budget counters have disjoint key prefixes.
- Status reads fetch the saved transaction identity, then verify deployment, receipt, canonical receipt block and confirmation depth independently. They cannot write a job, release an active nonce or broadcast. An older read completing after alarm reconciliation cannot regress the durable journal.
- Concurrent polls for one job share an observation. There are at most 16 outstanding job observations. At capacity, other jobs receive retryable 503. Each waiter times out after five seconds; the outstanding slot remains occupied until its underlying RPC promise settles. The shared RPC transport also retains its existing per-call timeout/retry limits.
- Polling never returns a cached confirmation during an outage. The existing 15-second alarm or a serialized submission retry advances the durable job and releases its active reservation. Clients can observe confirmation before the next alarm persists it, and can briefly receive “waiting for its previous transaction” on the next submission.

This design follows Cloudflare's distinction between [storage input gates and external asynchronous work](https://developers.cloudflare.com/durable-objects/api/state/). No object-wide `blockConcurrencyWhile` spans an RPC request. Separate application queues preserve the critical sections while the runtime can deliver unrelated requests during external I/O. This avoids a challenge migration and preserves outstanding proofs across deployment.

## Reproducible local evidence

Run `pnpm exec vitest run tests/sponsor.test.ts`. The fixture executes the production Sponsor in real workerd with SQLite Durable Object storage. Its public-client RPC methods are replaced in that isolated test bundle. viem's separate wallet client also performs a chain-ID read before local signing: the fixture now responds locally to that method and rejects any other outbound fetch. The published fixture key is a known test key; no transaction is sent to the real network.

Ten cases verify:

1. During a stalled broadcast, challenge creation and authentication complete within a two-second test bound; competing uses of the same proof yield exactly one 200 and one 401. A status read can observe a fresh confirmed receipt while delivery remains stalled.
2. Stalled status reads return 503 at five seconds, share one underlying RPC observation and leave authentication responsive.
3. A stalled old poll finishes after real alarm reconciliation and cannot overwrite its confirmed journal entry or clear a different active reservation.
4. An unknown job performs no RPC; a forked receipt fails closed.
5. Sixteen stalled observations exhaust admission; a seventeenth performs no RPC, and settling observations releases capacity.
6. Concurrent challenges cannot exceed their daily quota.
7. Concurrent valid proofs cannot exceed the IP request quota; replay is rejected after denial too.
8. Concurrent valid proofs cannot exceed the profile/path quota.
9. Duplicate and competing submissions remain serialized while gas estimation/broadcast is stalled. The durable job, active reservation and nonce exist before broadcast completes; duplicate submission returns the same operation, a competing operation waits, and errors leave both queues usable.
10. A fixture reset releases a leaked RPC wait, drains serialized delivery and clears the alarm before erasing storage. Teardown runs after failed assertions too, so a failing stall test cannot leave the next test queued behind it.

Full validation after PR #8 review: **218 app tests** and TypeScript pass. Runtime code is unchanged from the passing frontend build and Worker dry run. The frontend bundle is unchanged; the existing bundle-size warning remains tracked under R7.3. Contract code and OG rendering are unchanged.

## Hosted verification and recovery

Deployed to devnet as Worker **`4693920f-eeb2-427d-8b29-65f218e0d6e5`** on 2026-10-06. [Hosted evidence](../research/sponsor-isolation-deployment.json) records passing retained-operation, authentication/replay and frontend-configuration checks with point-in-time timings, not a latency guarantee. The exact frontend bundle and healthy six-block index are preserved.

After the existing devnet deployment command, run `pnpm exec tsx scripts/check-sponsor.ts`. It checks semantic health, frontend deployment configuration and enabled sponsorship, two retained SDK-canary operations, unknown-job behavior and the exact frontend bundle. The configuration comparison matches the frontend's pinned-manifest check. Unlike the health flag alone, `/api/config` also requires the sponsor key to be configured. One generated, unfunded identity signs an intentionally malformed operation request: reaching schema validation (400) proves authentication succeeded, and replay (401) proves consumption. It creates no profile, upload, NFT or chain transaction. Only challenge/admission counters change. Public results go to `research/sponsor-isolation-deployment.json`; the ephemeral key and proof are not saved.

PR #8 review of `89b44c8` confirmed two verification gaps. The fixture-cleanup regression fails on that reviewed fixture and passes with reset/teardown cleanup. Five frontend-configuration cases accept the pinned manifest and reject missing deployment, changed contract/genesis and disabled sponsorship. The strengthened hosted smoke passes against the existing Worker; these verification-only changes require no redeployment.

CI on follow-up `8a5a3ca` exposed the wallet client's previously unstubbed chain-ID read: one runner timed out waiting for broadcast while another passed. The transport guard removes that live-network dependency, and the submission test verifies that exactly one local chain-ID request occurs before the held broadcast. Application timing limits were not increased.

If status checks report 503, keep saved operation/destination keys and retry. Do not clear `active`, `lastNonce`, gas reservations or jobs to unstick a sponsor. Polls intentionally cannot repair or overwrite that state. Allow alarms to reconcile, or retry the exact saved operation once RPC recovers. Diagnose persistent nonce mismatches against pending/latest RPC counts and the durable outbox before any operator repair.

Rollback uses the previous Worker version with the same bindings and storage. No data rollback is needed; prior code understands all existing records. Rollback restores the old coupling between RPC waits and authentication/status.

## Crash and retry qualification (R7.1)

Run `pnpm exec vitest run tests/sponsor-recovery.test.ts`. This local-only suite starts Wrangler/workerd in a separate POSIX process group with a fresh temporary SQLite directory for each case. Fault injection sends SIGKILL to that owned group and asserts the launcher exited from SIGKILL. It restarts a new runtime using the same directory, without reseeding jobs or gracefully flushing/resetting storage. The RPC fixture remains offline and uses a known test key. Normal teardown kills the owned group and removes only its temporary directory. The CI runner is Linux; local validation also runs on macOS.

Seven cases cover:

| Boundary | Required observation |
| --- | --- |
| Kill during gas estimation, before the outbox | No job, nonce or gas reservation survives; the same operation can be submitted with nonce zero after restart. |
| Kill after durable persistence, before simulated RPC acceptance | Job, active nonce, gas budget and alarm survive together; retry and alarm use the original raw transaction. |
| Kill after simulated acceptance, before RPC response | The same durable transaction is recovered. New fee quotes cannot cause a second signature or a new nonce. A competing operation waits through five subsequent blocks; after six, reconciliation permits the next nonce. |
| Ambiguous broadcast followed by receipt RPC outage | HTTP 202 retains the submitted job after delivery throws; status returns 503 during the outage, the alarm retains/rearms its reservation, and recovery rebroadcasts the same bytes. |
| Pending/latest counts disagree | A new operation fails before signing, broadcasting or reserving gas. |
| Node count is behind the journal | The sponsor refuses reuse of its last nonce. |
| Node count has advanced beyond the journal | The sponsor stops rather than skipping an unexplained nonce. |

The fixture records transactions at the simulated RPC acceptance boundary, then independently holds or loses the response. It does not execute them on an EVM or establish ZVM mempool behavior. The tests verify raw transaction hash, decoded nonce/chain/contract and exact reserved gas cost; post-restart comparisons include operation quota, budget and original signed bytes. Receipt/confirmation events are injected separately. These are actual local process crashes with simulated chain responses, not evidence of Cloudflare replicated-storage failover or network finality.

Validation: **225 app tests**, TypeScript and diff checks pass. [Recorded evidence](../research/sponsor-recovery.json) includes the case results and source hashes. As a negative control, temporarily moving durable persistence after broadcast causes both broadcast-boundary tests to fail on the missing job; the restored production implementation passes. Runtime code is unchanged from merged PR #8, so this verification-only increment does not require another deployment.

### Recovery procedure and remaining replacement work

1. Keep the user's saved operation and destination/recovery keys. Record the operation ID and transaction hash from its journal/API response. Do not request or copy wallet private keys.
2. When delivery times out, retry the saved operation or allow its alarm to run. A missing receipt alone is not evidence that the transaction was never accepted; the sponsor rebroadcasts its stored bytes. Status polling is read-only.
3. Compare the pinned deployment, receipt block hash, current confirmation depth and sponsor pending/latest transaction counts. Wait through the application confirmation window. RPC errors or deployment/nonce discrepancies require reconciliation before new signing.
4. Repeated delivery rejection, unknown nonce consumption or a transaction priced below the current relay requirement is an operator incident. Preserve the outbox, `active`, `lastNonce` and gas reservation. Do not clear them, share the sponsor gas account with another outbox, or send an unrelated transaction to bypass the block.
5. There is currently no automatic fee-bump or nonce-repair endpoint. Raising a current gas quote does not rewrite an existing job. A replacement protocol still needs a reviewed same-nonce transaction lineage, bounded additional gas reservation, tracking of receipts for every candidate hash, crash-safe journaling and controlled-chain race/expiry tests. Until that exists, this case remains pending rather than claiming automatic recovery.

## Still open

R7.5 queue isolation is complete and merged in PR #8 at `1dedcf5`. The R7.1 local process-crash, ambiguous-delivery, exact-retry and nonce-refusal cases are now covered. Automatic fee replacement, controlled-chain transaction/replacement execution and hosted failover evidence remain open under R7.1. Controlled reorg/reset/deep rollback, hosted load/CPU limits and independent finality review remain R7.2–R7.4. MetaMask/phone, browser-restart/recovery and competing real claims remain R1.5/R1.6/R6. No wallet/device acceptance is claimed by these service tests.

## Reverted-receipt confirmation window

The next recovery check found that `observe()` classified any reverted receipt as `failed` immediately. Serialized reconciliation consequently released `active`, while client code allowed renewed authorization, before six subsequent blocks. A reorg could still remove that revert.

Both successful and reverted receipts now remain `included` until the same six-subsequent-block application window has elapsed. After that, a successful receipt becomes `confirmed` and a reverted receipt becomes `failed`. Receipt-block hash checks still precede classification; a missing receipt returns to `submitted` with its original transaction bytes and nonce. Only serialized alarm/submission reconciliation can release the active reservation. A read-only poll can report a terminal observation without updating the journal.

Four workerd regressions fail on merged baseline `1dedcf5` and pass with the fix: reverted inclusion at zero and five subsequent blocks, a removed revert followed by successful re-inclusion, and a legacy failed job rechecked against current depth while another job holds the active reservation. The original fix passed **222 app tests**, including fourteen sponsor cases, plus typecheck, build and Worker dry run. PR #9 merged at `da5185e`; its seven additional crash tests and extended fixture are now integrated. The combined suite passes **229 app tests** across 25 files, plus typecheck and diff checks. [Integration evidence](../research/sponsor-recovery-integration.json) records the combined fixture hashes; the original evidence files retain their historical hashes and counts. Runtime source is unchanged from `37d24d9`, so the existing build, Worker dry run and deployment remain applicable.

No schema or job-format migration is needed. Existing jobs are re-observed rather than trusting their saved state. The fix cannot undo a retry or nonce release performed by the prior Worker, and deliberately does not overwrite a different active job. Rollback to Worker `4693920f-eeb2-427d-8b29-65f218e0d6e5` preserves data but restores premature revert classification. Controlled-chain reorgs, finality assumptions and real-wallet recovery acceptance remain open.


Deployed to devnet as Worker **`129889f1-0cb8-49d4-9c1d-8f1ff5c1d092`**, preserving all bindings, routes and data. [Before/after local regression evidence](../research/sponsor-revert-confirmations.json) and [hosted smoke](../research/sponsor-revert-deployment.json) record the validation. The hosted check exercises healthy retained operations, configuration, one-use authentication, unknown-job handling and exact frontend bytes; it does not manufacture a hosted revert/reorg.
