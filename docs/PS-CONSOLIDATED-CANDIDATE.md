# Consolidated PS service candidate

User direction, October 9, 2026: complete the remaining authorized engineering on one local branch, checkpoint with unsigned development commits, then sign the final history and submit one consolidated PR. This supersedes the earlier per-increment signing/PR cadence. Use `git -c commit.gpgsign=false commit` for unpublished checkpoints; do not change global signing settings. Preserve an unsigned backup branch before final signing and verify the final tree and expected signer. Never rewrite published history, merge automatically or deploy an issuer.

Baseline: merged PR #29, `23df3222f9b3bd280b9947846eb78ba96d3d069c`, reviewed signed head `f981ce208356cba320096825771c770b5444bb5b`. Development branch: `feat/ps-consolidated-candidate`. The consolidated work is published in [PR #30](https://github.com/0x3639/zft/pull/30).

## Engineering completion checklist

Work below is one integrated candidate. Mark items complete only with implementation and reproducible evidence, not by adding another interface or describing a future design.

- [x] Protected records for session secrets and whole backups, with exact caller-selected scope, denied unwrap, tamper, lifecycle and size tests.
- [x] Durable asynchronous issuer execution: validate before secret work, recheck after await, atomically commit spend and exact response, recover rather than regenerate after ambiguous failure.
- [x] Durable asynchronous status observations: pinned raw signer, original observation time, commit-before-response and exact replay, recheck expiry and admission after await.
- [x] Provider-neutral custody integration from encrypted key files through protected session state, using explicit trusted execution/wrapping/signing boundaries and no plaintext fallback. Production qualification remains external.
- [x] Protected stopped backups and explicit restore/fencing/freshness review, without automatic admission or orphan adoption.
- [x] Authenticated participant/operator admission, exact origin/host/proxy policy, bounded rate/concurrency and sensitive-output controls in a separate service boundary. Loopback tests only until release gates permit hosting.
- [x] Bounded operational health, sanitized alert/retention adapters, operator recovery/rotation procedures and reproducible acceptance/runbooks.
- [x] End-to-end disposable service/client integration and race, crash, denial, late-result, resource and mutation regressions; preserve frozen protocol/reference modules and previous manifests.
- [ ] Final app/reference/service/preflight checks, one current evidence manifest, clear external dependencies, unsigned-history backup, batch signing and one PR with latest-head completed review/CI.

## Dependencies that implementation cannot self-certify

A provider/account/region/budget/operator decision, actual provider permissions/credentials, independently qualified secret backend/build, independent C1/C4 and PS-OWN-01 review, real MetaMask/Firefox/iOS/Android device acceptance and explicit staging authorization remain unprovided. No local fixture or CodeRabbit result closes those gates. Implement and test all work that does not require those inputs; do not invent results, select paid resources, contact reviewers or activate hosting. Record specific evidence still needed in the final candidate. Existing issuer keys/session secrets remain plaintext until an explicitly approved migration; this candidate creates only disposable test state.

Frozen local protocol/client/issuer/store/state/image/png/vault modules, earlier adapters, historical validation manifests, root dependencies, app UI/Worker/data/v1 and private demos remain unchanged. New service code lives in `research/ps-lab/service/`. Real deployment, migration and independent qualification are separate authorized actions; all locally executable engineering above belongs in the single final PR.

## Progress

Implementation checkpoint: protected execution/session state, durable issuer/status paths, stopped backup/restore and wrapping rotation, authenticated HTTP/client composition, health/alert/retention controls and operator procedures are implemented. The 74-test service suite passes. All 18 service mutation controls and the full baseline/app/reference/build/preflight checks pass. Final evidence records 184 current source hashes, 144 unchanged baseline artifacts, 21 unchanged historical manifests and 444 local documentation links. The signed consolidated PR is published; review fixes require fresh completed review and CI on their exact head. External gates below remain pending.

## Implemented service boundary

The separate [service modules](../research/ps-lab/service/) compose the earlier encrypted key file and status signer with a new SQLite schema. Existing persistent issuers, their plaintext stores, the browser product, original protocol modules and prior adapters are unchanged. There is no migration or implicit serving entry point. `initializeService` requires existing caller-provided private scalars, a complete public manifest, explicit wrapping/status configuration and an empty private directory. It publishes a public ready record last and starts suspended. `openService` requires the selected ready-record hash, checks the encrypted-key hash, takes a host-local exclusive lock and invokes explicitly supplied custody and status drivers. Missing/partial stores never initialize themselves.

`reference-custody.mjs` is an explicitly selected, unqualified implementation for local experiments. It unwraps the encrypted PS scalar file, protects each new session scalar in a separate AES-256-GCM record and uses the unchanged PS equations. Trusted injected JavaScript sees secrets and is not sandboxed. No shipped transport connects to a cloud provider, creates provider keys, proves permissions, or qualifies constant-time secret execution. A real driver must enforce pinned immutable key ownership, context binding, permissions and authorization in addition to this interface.

The shared asynchronous boundary allows one request per adapter, no queue or automatic retry, a default five-second monotonic provider interval (configurable 100–5000 ms), cancellation and fixed sanitized errors. Timer checks plus checks before dispatch and acceptance reject a late result even if JavaScript was blocked. Aborting a promise does not establish that remote work stopped. Input validation, synchronous filesystem work and some local cryptography are outside provider deadlines. Calls that perform wrap and unwrap have two intervals; there is no whole-operation hard latency, resource or zeroization guarantee.

## Protected records and response validation

`ProtectedRecord` binds format, purpose, full PS manifest, configuration ID, wrapping-key reference and caller-selected record ID. Session records hold at most 512 bytes; backup records hold at most 64 MiB. Each seal uses fresh 32-byte data key, 12-byte IV and 16-byte AES-256-GCM tag. The scope, wrapped key and IV form the authenticated header. The injected wrapping transport must actually protect the data key and bind the context. The response is bounded, key/operation checked and copied into owned ordinary ArrayBuffer storage. Only fully authenticated plaintext is returned. Native copying ignores caller iterators. Owned buffers are cleared best-effort; strings, provider copies and cryptographic runtime memory are not guaranteed erased.

The execution adapter validates the original request proof before secret work and checks the returned response using the original public parameters. Its internal response additionally supplies `K2 = k G2` and `YsK2 = k Ys2`. For the already selected session `U = k G1`, it verifies:

- `e(U, G2) = e(G1, K2)` and `e(U, Ys2) = e(G1, YsK2)`.
- Issuance: `e(v, G2) = e(U, X2) e(b, K2) e(s, YsK2)`.
- Swap: `e(v, G2) = e(U, X2) e(b, Yh2) e(s, YsK2)`.

These are rearrangements of the unchanged local `issueResponse` formulas, with strict canonical subgroup point validation. The two internal points are neither credential fields nor client outputs and are not persisted. They reject selected incorrect provider results before spending; this construction is still same-author work requiring independent review. It does not prove provider authorization, non-exportable custody, privacy or the unresolved PS ownership assumptions.

## Durable asynchronous operations

The service database stores public sessions plus protected session records, exact responses, recovery hashes, assets, spent nullifiers and status observations. It has no plaintext session-scalar column. A response is released only after the spend/asset insertion and exact response commit in one transaction. Custody runs outside SQL transactions. Admission generation, request authorization, expiration, clock direction, session identity, uniqueness and capacities are checked again inside the commit transaction. Competing claims have one winner. Duplicate identical requests recover that winner's bytes. Explicit capability-based recovery remains possible after suspension or expiration and does not call custody again.

Status observation first commits a snapshot containing the original time, sequence, showing hash, nullifier and state. Signing is asynchronous through the existing pinned raw Ed25519 signer. The receipt commits before release. Denied signing preserves the snapshot for an explicit retry without refreshing its time. Admission, authorization and challenge lifetime are rechecked before receipt commit. Cached snapshots and signatures are validated before reuse. The unchanged `StateObserver` accepts these receipts. They remain historical observations, not reservations or proof of current ownership.

Selected caps are 512 sessions (100 simultaneously live/unconsumed), 128 committed operations, 256 observations, 128 admission grants and a 16 MiB SQLite page limit. Each issuer and status instance admits four provider operations. The database uses foreign keys, FULL synchronous mode and DELETE journals. Tests do not qualify these limits for production throughput, storage latency or adversarial resource load.

## HTTP and client integration

`createCandidateServer` constructs a server but does not bind it. The caller must select the binding, origin, TLS termination and operational ownership. The only tested bindings are disposable numeric loopback listeners. Server construction sets an 8192-byte header limit, 32 headers, 16 connections, a five-second header timeout, fifteen-second request timeout and one request per connection. The handler has eight authenticated requests in flight, 20,000-byte request bodies, 32,768-byte responses and a fifteen-second monotonic request deadline. Same-process stalls still delay timers.

Every route requires an exact configured Host and Origin, one lowercase-hex bearer token, exact method/path, and its role. HTTPS origins or HTTP numeric loopback origins are accepted in configuration. Duplicate headers, cookies, proxy/forwarding metadata, cross-site fetch metadata, encoded bodies, wrong media types and unknown fields fail. Proxy headers are never used to infer identity or origin. There is no CORS grant, browser cookie session, implicit wallet identity, body/error logging or anonymous operations endpoint. Response errors are fixed; responses use no-store and restrictive content/security headers. The tested client rejects redirects, bounds response bytes, aborts overdue requests and does not automatically retry.

| Access role | Routes                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Participant | POST `/api/ps/session`, `/api/ps/submit`, `/api/ps/recover`, `/api/ps/observe`, `/api/ps/receipt` |
| Operator    | POST `/ops/admission`, `/ops/grant`, `/ops/revoke`, `/ops/retention`                              |
| Monitor     | GET `/ops/health`                                                                                 |

Roles are separate. Access grants have random 32-byte tokens, stored only as hashes, a maximum one-hour lifetime and explicit revocation. Unknown or pruned grant hashes are rejected; repeating revocation of a retained known grant is idempotent. A trusted offline operator must bootstrap the first operator grant with `grant`; there is no default password/token or public bootstrap route. Handler limits are 30 requests per grant and 120 authenticated requests per process per monotonic minute. These counters reset at restart and are not distributed abuse controls. Tokens are not Ethereum identities. The guard repeats at durable commit, so a revoked/expired grant cannot commit delayed custody work.

`ServiceClient` bridges asynchronous requests to the unchanged durable `Client`. It requires the caller to preserve and acknowledge the exact recovery snapshot before submission. It never silently acknowledges custody, replaces a pending operation, follows redirects or regenerates a response. Real HTTP tests complete mint, claim, cancellation, stale-copy rejection, state observation and exact response recovery; this is Node/loopback acceptance, not browser or MetaMask acceptance. The existing product has not been switched to this service.

## Stopped backup, restore and wrapping-key rotation

`backupService` takes the same exclusive local lock as serving, verifies the selected ready/key hashes, recovers and checks SQLite, closes it, refuses remaining journal/WAL/SHM sidecars, and packages the database, encrypted PS key file and public ready record. The whole archive is encrypted and roundtrip-checked before create-only publication in a separate private directory. It returns ciphertext hash, record ID, ready-record hash and operation sequence. Keep these in a separately governed checkpoint record. An authentic selected archive still does not prove it is globally newest.

`restoreService` requires that selected tuple and a new empty private destination. It checks the ciphertext hash before unwrap, authenticates the archive, checks the selected plaintext/ready hashes, schema identity, key-file hash, unwrap and sequence. It clears all admission grants and sets suspended plus mandatory restore review before publishing the ready record last. Failed directories stay incomplete; they are not automatically deleted, repaired or adopted. A successful restore may be inspected and exact historical responses recovered, but enabling admission fails until `acknowledgeRestore` records an explicit operator-selected checkpoint, minimum sequence and external fencing-evidence reference. This records an assertion, not a proof that another writer was fenced. Admission remains disabled after acknowledgement and needs a separate deliberate enable.

`rotateWrappingKey` is a stopped copy-to-new-directory operation for this candidate schema. It preserves PS/status public identities, exact responses and pending sessions, rewraps the PS scalar file and every session secret under the new explicitly supplied wrapping identity, roundtrip-checks the results and publishes a new ready record last. It clears grants and requires the same explicit checkpoint/fencing review before enabling. Before publishing readiness, rotation enables SQLite secure deletion for replacements and compacts the destination to remove copied free-page remnants. This applies to the resulting logical database file, not erased journals, storage snapshots, media or the deliberately retained source/backups. The original directory is unchanged. Provider revocation is external and must wait until retained backups/recovery obligations have been assessed. Rotation of PS cryptographic identity or status signing identity, legacy issuer migration and distributed failover are not performed by this operation.

## Operator procedures

1. **Admission and custody:** qualify real drivers and storage first; independently verify ready/key/public identity pins. Initialize an empty private candidate directory explicitly, keep it suspended, securely provision short-lived grants, validate exact origin/TLS/proxy behavior and only enable after the release gates are approved. No fixture key or reference driver qualifies production custody.
2. **Uncertain response:** retain the client's acknowledged recovery snapshot. Query exact recovery with the existing digest/capability. An unknown result is not permission to invent a new credential or discard pending state. Preserve the original request and reconcile committed state before an explicit retry.
3. **Uncertain file publication:** stop admission, retain final and orphan ciphertext, record the returned digest where available and inspect under the exclusive lock. Readback after a failed sync does not prove durability. Do not overwrite/adopt an orphan or remove a final file merely to retry. Recover into a separately selected empty directory only after checkpoint/fencing review.
4. **Dead lock:** inspect the host, process and exact lock hash. `reclaimDeadLock` requires the same host, a confirmed absent PID and that selected hash; a live/reused PID, foreign host, malformed lock or permission uncertainty blocks it. Host-local locks only coordinate callers using these APIs. They do not fence another host, uncontrolled raw SQLite access, a malicious same-user process or privileged filesystem races.
5. **Backup and restore:** stop the service, record an external checkpoint and invoke the stopped backup. Retain keys and immutable pins needed for that archive. Restore to a new private directory, inspect exact sequence/recovery, independently fence all old writers, record evidence and acknowledge the selected checkpoint. Issue new access grants; do not reuse restored grant tokens. Enable separately after approval.
6. **Retention and capacity:** health warns at 80% of tracked caps and allocated database pages (including potentially reusable freelist pages). The only implemented deletion is explicit dry-run/apply removal of revoked/expired admission grants. Do not prune spends, committed responses, observations or session history to gain space; those preserve recovery and anti-reuse evidence. Stop admission at capacity, retain snapshots and approve a continuity/migration plan with the independent reviewer and operator. Backup deletion and provider-key revocation require separately selected objects and a reviewed recovery retention policy.
7. **Alerts and incidents:** `HealthAlert` accepts an explicit injected sender, delivers only fixed warning codes/sequence, suppresses successfully acknowledged unchanged state and sanitizes provider errors. It creates no scheduler or real destination and never retries or changes admission itself. Configure and qualify polling/on-call/delivery externally. An `ok` health result means selected aggregate reads have no tracked warnings; it is not a write probe, crypto validation, freshness guarantee or release approval.
8. **Wrapping rotation:** stop and fence source use, select a new immutable provider wrapping identity, rotate into a new directory, verify exact responses and pending sessions, record the new ready hash and external checkpoint, then review and enable separately. Preserve the original state and required old provider keys until retention/recovery obligations are explicitly discharged. Never rotate by editing a pinned ready record in place.

## Reproducible acceptance

Run from the repository root with Node 22.12 and the frozen isolated lab dependencies:

```sh
pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
pnpm --dir research/ps-lab --ignore-workspace test:service
pnpm --dir research/ps-lab --ignore-workspace test:service-controls
pnpm --dir research/ps-lab --ignore-workspace test:local
node research/ps-lab/local/check-controls.mjs
pnpm ps:release-test
```

The current service suite has 74 tests and 18 mutation controls. The controls remove scope/authentication/size/deadline/response-equation checks, async expiry/admission checks, original-time/cached-signature checks, backup digest/restore review, role/Host/Origin/commit-time authorization or safe retention. Every weakened disposable copy must fail its named assertion. The suite includes 18 new actual SIGKILL boundaries; specifically, three protected-session, four spend/response, five snapshot/receipt, three backup and three restore locations. Together with the unchanged 29 baseline locations this gives 47 selected process-kill locations. Fixtures also exercise publication uncertainty, two-connection claim races, duplicate convergence, stalled upload, active cancellation, delayed revocation, wrong keys/scopes/signatures, retained original observation time and wrapping rotation with a pending session. Disposable directories, fixed public wrapping/status keys and unqualified same-author secret execution are used throughout. No user private state is read. These tests do not simulate hardware power loss, qualify network filesystems, hostile same-user races, production traffic, real providers or physical devices.

[Candidate source evidence](../research/ps-consolidated-validation.json) records final checks and current source hashes. All prior validation manifests remain historical and unchanged. Final evidence excludes itself and is pinned by the signed Git tree. Release preflight must continue to block on the actual external approvals and exact-head review/checks; local completion must not manufacture those approvals.

## PR review follow-up

The first completed review of signed head `5a57bf0` identified four valid issues. Publication instructions now consistently use unsigned local checkpoints followed by one final batch-signing/PR pass; the remaining preflight baseline reference now names PR #29. Grant revocation now checks that the selected hash matched a row instead of reporting success for an unknown/pruned hash. Rotation explicitly enables secure deletion before replacement and compacts the destination before readiness publication.

Both behavior regressions fail with named assertions on the reviewed implementation and pass after correction. The rotation fixture uses public test wrapping material with long opaque padding so old records occupy overflow pages, verifies selected old bytes exist in the source, then verifies their absence in the finished destination while preserving the source and pending-session behavior. Removing destination compaction still fails that assertion even with secure deletion enabled. The two added mutation controls also require these named failures. This is selected logical-file evidence, not forensic erasure or hardware qualification; SQLite describes its [secure-delete and vacuum behavior](https://www.sqlite.org/pragma.html#pragma_secure_delete).
