# Local PS live health

This adds read-only monitoring to the persistent local issuer after merged PR #24 (`b89cf61c3961b55f8fff5631a72c1c5740bfd3d7`). It does not provision monitoring infrastructure, send alerts, change admission, or authorize hosting. The [operations policy](PS-LOCAL-OPERATIONS.md) and [release gates](PS-RELEASE-PREFLIGHT.md) still apply.

## Probe the running issuer

```sh
pnpm ps:persistent health /absolute/private/state
```

For a machine consuming stdout directly, run `node --experimental-sqlite research/ps-lab/local/persistent-cli.mjs health /absolute/private/state`; pnpm can add command banners. The CLI prints one JSON result. SQLite's experimental-feature notice can appear on stderr.

| Exit | Status | Meaning and response |
| --- | --- | --- |
| 0 | `ok` | Both live database handles answered the selected reads and no tracked warning is present. This does not establish cryptographic correctness, write availability or release readiness. |
| 2 | `attention` | A readable snapshot reports suspension, pending restore review, or capacity pressure/limit. Preserve state and inspect the warning keys. A deliberately suspended issuer can still support exact recovery. |
| 1 | `unavailable` | Missing/unsafe descriptor, wrong authorization or instance, invalid response, failed database read, closed listener or deadline. Diagnose the process and retained state; do not initialize a replacement issuer automatically. |

Each probe makes one request to the exact numeric loopback origin in the private descriptor. It uses a fresh 128-bit challenge, requires the current 256-bit process instance, rejects redirects and noncanonical/oversized responses, and has a five-second absolute network deadline. A trickling peer cannot extend that deadline. It rechecks the descriptor after receiving the response to reject an instance change. No retry, alert transport or polling schedule is installed. A future operator can schedule this command at a modest interval, for example every 30 seconds, after deciding alert ownership and maintenance windows.

The deadline applies once the request starts. Node startup, filesystem access and a blocked probe process are outside that timer. Running the probe as a separate process permits it to time out while the issuer's event loop is busy; it does not make the synchronous issuer cryptography nonblocking or qualify service latency under load.

## Credential and route boundary

Persistent startup acquires the existing issuer lock, validates retained public records, then atomically replaces a private mode-0600 `monitor.json` with format `zft-ps-local-monitor-v1`. It contains only format, fixed loopback origin, random instance and random monitoring token. It is independent of the launch capability and never appears in the product bootstrap or a static asset route. Unsafe or malformed stale descriptors abort startup; a valid stale descriptor is replaced only while holding the existing issuer lock.

The exact `GET /ops/health` route accepts the monitoring bearer token and a single `X-PS-Health-Challenge`. Existing exact Host checking remains. Duplicate authorization/challenge headers, request bodies, any Origin and browser fetch-metadata headers reject; CORS is not enabled. Responses are bounded to 8192 bytes, are `no-store`, and close the connection. Sampling failures return a fixed error without assertions, SQL, paths, request bodies or key material. Disposable mode exposes no health route.

The monitoring token cannot authorize `/issuer` or `/presentation`; the launch capability cannot read health. This is capability separation, not a new operating-system security boundary: a process with the same user's access to the entire private directory can also read the existing plaintext issuer keys. Do not distribute the directory to monitoring agents or publish the descriptor. Remote collection, TLS, operator identity and credential distribution require a separate design.

Normal shutdown removes its matching descriptor. After a crash a descriptor may remain, but it is not authority to remove `run.lock`; existing explicit dead-owner recovery rules still apply. Restart rotates token and instance. A probe never opens SQLite, reads `private.json`, acquires or steals the issuer lock, or writes issuer files. The server uses existing database handles and performs only bounded aggregate reads.

## Report semantics

The response format is `zft-ps-local-health-v1`. It includes process instance, echoed challenge, issuer-clock sample time, monotonic uptime, admission-enabled and restore-review flags, maximum committed operation sequence, aggregate counts, SQLite page information, `status` and a map of fixed warning names to `true`. It contains no realm, wallet, asset ID, nullifier, response, recovery capability, owner secret, private key or filesystem path.

Counts cover retained sessions, currently active unconsumed sessions, completed operations, reserved assets, spent entries, observation requests and public records. Active sessions use the same expiry/completion predicate as the core issuer. Capacity warnings start at 80% of the existing count limits (512 retained sessions, 100 active sessions, 128 operations, 64 observation requests and 64 public records); reaching a limit has a distinct warning. SQLite reports page size, allocated pages, freelist pages and configured maximum pages. Page warnings conservatively use allocated pages: free pages may be reused, and an apparently low count does not prove the next transaction can write.

This is a synchronous sample within one issuer event-loop turn, not an atomic cross-database checkpoint. It does not rerun startup signature/integrity verification, test recovery or write a synthetic operation. It does not measure free host disk, journal overhead, CPU, memory, event-loop lag, backup freshness, durable fsync, key safety, external availability or global state freshness. A nonce prevents accidental response reuse; this local HTTP report is not a signed ownership receipt or protection against a malicious local administrator. No automatic pruning, resume, failover, restore or key rotation follows from a warning.

## Operator follow-up before hosting

| Signal | Next operator action |
| --- | --- |
| `admission_suspended` | Confirm whether suspension is intentional; exact recovery may remain useful. Resume only through the existing reviewed maintenance procedure. |
| `restore_review_required` | Keep new admission blocked. Establish checkpoint freshness and fence the previous issuer before acknowledging restore. Health does not perform that review. |
| Count/page `*_pressure` or `*_limit` | Review admission and measured capacity. Do not delete spend markers, pending recovery responses or issuer identity to make room. |
| `unavailable` | Check process ownership and local access, retain evidence, and follow outage/recovery procedures. A failed probe is not evidence that the old issuer is dead. |

Hosting topology, production secret-operation backend and key custody, alert destination/on-call ownership, maintenance suppression, resource measurements, retention/recovery guarantees and cross-host fencing remain unselected or unqualified. Independent C1/C4 review and PS-OWN-01 stay open. Monitoring does not close any of those gates.

## Validation

[Current evidence](../research/ps-health-validation.json) records 15 focused tests (14 real-loopback/CLI cases and one filesystem fault-injection regression) and five temporary mutations. The tests cover read-only file hashes, aggregate output shape, permission separation, HTTP rejection, real issuance/recovery during suspension, capacity warnings, restored state, generic errors, restart rotation, unsafe files, CLI exit codes, route isolation, loopback pinning, malformed/replayed responses and absolute timeout. Synthetic capacity rows only test counting policy; they are not valid credential transcripts. A retained descriptor simulates a crash artifact; no new SIGKILL location is claimed.

The mutation controls bypass monitor authorization, hide restore review, skip challenge binding, postpone capacity warnings or remove the deadline; each must fail a named assertion. These checks are local engineering evidence, not an independent review or production acceptance. Previous release/app/browser evidence is preserved at its original revisions.

## PR review follow-up

[PR #25's initial review](https://github.com/0x3639/zft/pull/25#pullrequestreview-5471105332) identified a startup-error diagnostic bug: if a descriptor write or rename failed and removing its temporary file also failed, cleanup could replace the original error. Startup now attempts cleanup on failure and rethrows the original error. A test-only synchronous filesystem regression injects write and rename failures, each with successful and failed cleanup; it checks original error identity, cleanup attempts and absence of a published descriptor. It fails on the reviewed implementation and passes after the repair. This is selected error-path coverage, not a real disk-failure or crash qualification.

The README now identifies health monitoring and its current evidence at the top and labels prior records as historical. The combined local suite contains 265 tests; the 78 mutation controls and 22 actual SIGKILL locations are unchanged. Independent review, PS-OWN-01 and hosting approval remain open.
