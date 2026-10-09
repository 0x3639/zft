# Local PS operations and restore policy

This increment adds offline backup/restore drills to the [persistent local issuer](PS-PERSISTENT-LOCAL.md). It prepares release step 5 while independent step 4 review remains unassigned. It does not qualify a hosted service, operator staffing, production key custody, hardware durability or global rollback protection.

## Backup

Stop the serving process normally. The command acquires the same exclusive directory lock, checks registry integrity and retained public evidence, closes both SQLite connections while retaining the lock, then copies exactly five bounded private files into a new mode-0700 directory. Each output file is mode 0600 and fsynced. The backup includes plaintext private keys; treat the entire directory as secret. Existing destinations are never overwritten.

```sh
pnpm ps:persistent status /absolute/private/state
pnpm ps:persistent backup /absolute/private/state /absolute/private/new-backup
```

The final `snapshot.json` has format `zft-ps-local-backup-v1`. Its canonical body contains realm/keyset, timestamp, registry sequence/counts/admission flag and exact size/SHA-256 for `private.json`, `pins.json`, `ready.json`, `issuer.db` and `presentations.db`. The separate status key signs the domain-framed body. The command returns its full SHA-256 checkpoint and nonsecret registry metadata; it never prints private keys or response capabilities. Retain that checkpoint separately in a trusted operator record. Copying the backup and its checksum from the same untrusted location does not establish authenticity or freshness.

A backup does not include browser IndexedDB, browser passwords or client recovery files. Those need their own protected copies. Do not copy live SQLite files, publish the backup directory, infer successful remote backup from local fsync, or use this format as an encrypted offsite storage protocol. Interrupted backup may leave an incomplete destination; it is not silently resumed or overwritten.

## Restore and review

Restore requires the independently retained exact checkpoint and a nonexistent destination. It verifies all bounded files, complete pins, the signature and registry metadata before marking the destination ready. Restored public evidence is reverified. Admission is persisted as suspended, and a restore-review marker blocks new sessions, new submissions and new observation preparation. Exact already-committed response recovery remains available. Existing historical public records remain historical.

```sh
pnpm ps:persistent restore /absolute/private/backup /absolute/private/new-state EXPECTED_CHECKPOINT
pnpm ps:persistent status /absolute/private/new-state
```

Interruption before the final ready marker leaves an unservable incomplete directory. Restore never deletes or replaces an existing directory. Keep the original stopped issuer and backup until the drill is reviewed; do not run two copies of the same issuer keys/registry on different machines. The local lock cannot prevent such forks.

Before resuming, establish whether the checkpoint is the latest trusted state, compare the retained operation sequence and external operator records, account for any requests accepted after the snapshot, confirm the old issuer cannot still run, and evaluate key compromise or database rollback. A valid older snapshot can omit a later spend. This case is explicitly tested: signature validity does not make the snapshot safe to resume. If freshness cannot be established, keep admission suspended. Public key compromise, unseen accepted operations, equivocation and cross-host fencing require an independently reviewed recovery/retirement design before hosting.

Only after that assessment does the operator acknowledge the matching checkpoint and separately resume:

```sh
pnpm ps:persistent approve-restore /absolute/private/new-state EXPECTED_CHECKPOINT
pnpm ps:persistent resume /absolute/private/new-state
pnpm ps:persistent serve /absolute/private/new-state
```

The approval command is an explicit local operator acknowledgment, not automated proof of global freshness or a cryptographic audit. It leaves admission suspended until `resume`. The application shows when restore review is required. The same-user administrator can modify files or bypass this tooling; the gate prevents accidental activation, not malicious administration.

## Outages, limits and incidents

- **Response lost:** preserve the exact encrypted recovery file and request. Reopen/recover that operation; do not mint a new replacement request simply because a response was lost. Exact replay remains available at quota limits and while suspended.
- **Process crash:** retain state, confirm the local owner is dead, use the explicit dead-lock recovery command and inspect status. PID reuse/unknown host/live owner blocks lock recovery. Actual SIGKILL evidence is distinct from power loss.
- **Capacity reached:** stop admitting work. No automatic deletion or age-based eviction is implemented; responses/spent markers remain necessary. The current caps are small local research limits, not a production capacity plan.
- **Possible corruption/rollback:** stop serving new work, preserve copies and logs, compare a trusted checkpoint and involve the reviewer. Do not simply regenerate keys, blank the registry or relabel files as a repair.
- **Key compromise:** suspend and isolate the issuer; assume signatures and stored authority may be forged. No automatic rotation/migration protocol is implemented. Fresh keys do not repair old signed authority or silently migrate credentials.
- **Public record removal:** no deletion/retention API is provided. Before hosting, define retention, privacy obligations and incident response without deleting spend/recovery evidence needed for safety.

Offline `status` emits counts, enabled state, realm and restore-review status and requires the same exclusive lock. The separate [live health probe](PS-OPERATIONS-HEALTH.md) now reads aggregate status while the issuer runs, with a distinct monitoring capability and bounded deadline. Hosted telemetry/alerts, on-call ownership, authenticated administration, admission identity, KMS/rotation, retention and backup transport remain release work. No external telemetry or secret logging is added.

## Evidence

[Current operations evidence](../research/ps-operations-validation.json) records eight new regressions: exact offline files/checkpoint, suspended restore/review/resume, tampering/checkpoint rejection, signature verification independent of content hash, exclusive ownership/no overwrite, incomplete restore interruption, demonstrated old-snapshot risk and actual HTTP recovery/admission behavior. Five temporary mutations disable file hashing, checkpoint signatures, suspended restore, resume review or observation review; each must fail a named assertion.

Combined totals are 250 local tests and 73 lab controls, with the existing 22 actual process-kill locations unchanged. The interruption in this slice is an injected exception before readiness, not another SIGKILL or hardware event. Root typecheck/build pass; prior 241 app tests, three app bridge controls and reference/contract/demo checks remain explicitly inherited. No new real-browser restore lifecycle or target-phone acceptance is claimed. Independent C1/C4 review, PS-OWN-01 and production operational acceptance stay open.
