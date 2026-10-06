# Sponsor responsiveness qualification

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

Run `pnpm exec vitest run tests/sponsor.test.ts`. The fixture executes the production Sponsor in real workerd with SQLite Durable Object storage. Its RPC methods are replaced in that isolated test bundle; its published fixture key is a known test key and never reaches the real network.

Nine cases verify:

1. During a stalled broadcast, challenge creation and authentication complete within a two-second test bound; competing uses of the same proof yield exactly one 200 and one 401. A status read can observe a fresh confirmed receipt while delivery remains stalled.
2. Stalled status reads return 503 at five seconds, share one underlying RPC observation and leave authentication responsive.
3. A stalled old poll finishes after real alarm reconciliation and cannot overwrite its confirmed journal entry or clear a different active reservation.
4. An unknown job performs no RPC; a forked receipt fails closed.
5. Sixteen stalled observations exhaust admission; a seventeenth performs no RPC, and settling observations releases capacity.
6. Concurrent challenges cannot exceed their daily quota.
7. Concurrent valid proofs cannot exceed the IP request quota; replay is rejected after denial too.
8. Concurrent valid proofs cannot exceed the profile/path quota.
9. Duplicate and competing submissions remain serialized while gas estimation/broadcast is stalled. The durable job, active reservation and nonce exist before broadcast completes; duplicate submission returns the same operation, a competing operation waits, and errors leave both queues usable.

Full validation: **212 app tests**, TypeScript, frontend build and Worker dry run pass. The frontend bundle is unchanged; the existing bundle-size warning remains tracked under R7.3. Contract code and OG rendering are unchanged.

## Hosted verification and recovery

Deployed to devnet as Worker **`4693920f-eeb2-427d-8b29-65f218e0d6e5`** on 2026-10-06. [Hosted evidence](../research/sponsor-isolation-deployment.json) passes: retained mint and claim observations took 672 ms and 260 ms, and challenge/authentication/replay took 203 ms total. These are point-in-time measurements, not a latency guarantee. The exact frontend bundle and healthy six-block index are preserved.

After the existing devnet deployment command, run `pnpm exec tsx scripts/check-sponsor.ts`. It checks semantic health, two retained SDK-canary operations, unknown-job behavior and the exact frontend bundle. One generated, unfunded identity signs an intentionally malformed operation request: reaching schema validation (400) proves authentication succeeded, and replay (401) proves consumption. It creates no profile, upload, NFT or chain transaction. Only challenge/admission counters change. Public results go to `research/sponsor-isolation-deployment.json`; the ephemeral key and proof are not saved.

If status checks report 503, keep saved operation/destination keys and retry. Do not clear `active`, `lastNonce`, gas reservations or jobs to unstick a sponsor. Polls intentionally cannot repair or overwrite that state. Allow alarms to reconcile, or retry the exact saved operation once RPC recovers. Diagnose persistent nonce mismatches against pending/latest RPC counts and the durable outbox before any operator repair.

Rollback uses the previous Worker version with the same bindings and storage. No data rollback is needed; prior code understands all existing records. Rollback restores the old coupling between RPC waits and authentication/status.

## Still open

This closes R7.5's queue-isolation acceptance, not R7 as a whole. Process-kill/restart drills, ambiguous broadcasts, fee replacement, nonce gaps, controlled reorg/reset/deep rollback, hosted load/CPU limits and independent finality review remain R7.1–R7.4. The hosted smoke uses a healthy real RPC; artificial stalls stay local. MetaMask/phone, browser-restart/recovery and competing real claims remain R1.5/R1.6/R6. No new wallet signature or custody acceptance is claimed by these service tests.
