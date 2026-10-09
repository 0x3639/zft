# Persistent local PS issuer

The third [release increment](PS-RELEASE-PLAN.md) keeps issuer trust and registry state across local restarts. It remains a single-operator research server bound only to `127.0.0.1`. It is not a hosted issuer or production keystore. Independent review, PS-OWN-01, operational qualification and target-device acceptance stay open.

## Initialize and run

Build the product, then choose a new canonical absolute directory and an unused unprivileged loopback port. Existing directories are never adopted or overwritten. On macOS use the real path (for example `/private/tmp`, not its `/tmp` alias). Use disposable test artwork and an appropriate private persistent location for longer experiments.

```sh
pnpm build
pnpm ps:persistent init /absolute/private/ps-local-state 54123
pnpm ps:persistent serve /absolute/private/ps-local-state
```

Open the printed launch link. It includes a fresh per-process capability in its fragment; do not publish that link. Reopening with a new launch link locks/remounts an existing product tab and removes the fragment after bootstrap. The fixed origin, complete manifest and Alice/Bob/Restored identifiers keep encrypted IndexedDB copies addressable across restart. These roles belong to one operator; they do not provide multiuser authorization. Browser passwords, bearer authority and recovery snapshots stay in the browser-owned flow. The older Node custody console and `/api` are disabled in this mode.

`pnpm ps:local` still starts the original disposable fixture-key mode. No default directory, implicit initialization, shared GPG change, contract, external RPC, Worker deployment or v1 data migration is introduced.

## Private state and identity

Initialization generates new nonzero PS scalars and a separate Ed25519 status key from OS randomness. These are not the public fixture keys. `private.json` contains plaintext private key material; the directory is mode 0700 and files are mode 0600, owned by the current user. This is filesystem isolation, not encrypted key storage, a hardware module, secure memory or protection against a malicious local user/process with the same privileges. Never use real assets here.

`pins.json` fixes the complete public PS/status manifests, role identities and port. A final `ready.json` records hashes of the private configuration and public pins after both databases initialize. Incomplete initialization, missing databases, mismatched key/pin/configuration, symlinks, unsafe permissions and malformed files fail closed. Startup never recreates a missing registry. The file checks do not establish resistance to a concurrent malicious same-user filesystem adversary, storage rollback or replacement of all trust files together.

The core local issuer, client, store, PS equations/transcripts and vault/PNG formats remain unchanged. Issuer sessions, operation responses, asset reservations and spent nullifiers retain the existing SQLite transaction behavior. Observation challenges, requests and receipts stay in their existing observer database; new public metadata references those exact rows. A committed observation can be replayed after interruption before the API return. Public records are inserted atomically and fully reverified at startup before serving public artwork or evidence. Their signatures can remain valid as historical reports after expiry; they never prove current ownership.

## Ownership and bounds

An exclusive `run.lock` admits one local process for this directory. Normal shutdown closes stores and removes the lock without deleting state. A crash deliberately leaves the lock. Inspect the process/state first, then explicitly recover only a confirmed dead process on the same host:

```sh
pnpm ps:persistent recover-lock /absolute/private/ps-local-state
pnpm ps:persistent status /absolute/private/ps-local-state
```

PID reuse, unknown host or a still-running owner blocks recovery. The lock is not a distributed lease and cannot prevent forks made from copied directories on other hosts. It also does not protect against an administrator deliberately editing/removing it. SQLite integrity checks are not authenticated rollback detection.

Admission is bounded to 128 completed operations, 512 total retained issuer sessions, 64 observation challenges and 64 public records. Each database has a 16 MiB page limit. Existing HTTP body/header/connection/capability limits remain. Exact authorized operation replay/recovery remains available at admission caps; no oldest-row eviction or new request regeneration occurs. Synthetic test rows exercise quota decisions independently from cryptographic vector validity. Page limits are not total disk/temporary-journal or CPU/memory qualification; synchronous crypto can delay server timers.

The operator may stop new work while retaining exact response recovery:

```sh
pnpm ps:persistent suspend /absolute/private/ps-local-state
pnpm ps:persistent resume /absolute/private/ps-local-state
```

The read-only [health command](PS-OPERATIONS-HEALTH.md) can inspect the running process without acquiring its lock.

These maintenance commands require the serving process to be stopped and acquire the same directory lock. Suspension persists across restart. It does not erase credentials, revoke already issued files, invalidate historical receipts or stop public observation. Production incident, rotation and restore policy requires separate review.

## Validation and remaining gates

[Current evidence](../research/ps-persistent-validation.json) records 242 local tests, 68 lab mutation controls and 22 actual process-kill locations. Twelve new cases cover private initialization, missing/changed/unsafe files, exclusive ownership, stable pins/client identities/origin, changed capabilities, exact response/spent-state recovery, retained observations/publication, corruption rejection, admission limits and suspension. One new test actually SIGKILLs the serving process after a response commits, then verifies explicit lock recovery and exact authorized response retrieval. It does not simulate hardware power loss or a kill inside every transaction.

Five new deliberate mutations remove missing-database rejection, private-file permissions, exclusive ownership, committed receipt replay or operation admission. Each must fail its named assertion. Typecheck/build pass. The 241 app tests and three bridge controls are inherited from the immediately preceding public-presentation increment; their executable test targets are unchanged. A fresh native desktop browser check creates and reopens an encrypted empty copy at the same origin across actual server restart; full artifact/recovery lifecycle across restart remains automated rather than native UI acceptance.

An initial restart HTTP test hit a stale test-client keep-alive connection after the server closed it. The regression now opens fresh connections per request; no server timeout was extended or production retry hidden. Browser testing found a same-document launch-fragment issue; the product now locks and reloads when a new capability fragment arrives. Source-hashed evidence distinguishes final verification from these setup/implementation findings.

Private keys are still plaintext at rest, operations are not side-channel qualified, logs/retention and key lifecycle are not production-ready, and neither a local lock nor the private configuration hash supplies global rollback/equivocation protection. Offline backup/restore drills and operator recovery policy follow this increment. A saved client recovery file cannot restore a lost issuer database. No real asset issuance or hosted release is authorized by these local checks.
