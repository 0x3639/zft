# Local encrypted PS key file

This isolated storage experiment starts from merged PR #28 (`0259f76e78abdc1ee85d9e58e839531215302e35`). [PsKeyFile](../research/ps-lab/local/key-file.mjs) composes the unchanged [key-envelope contract](PS-KEY-ENVELOPE.md) with a create-only private ciphertext file. It is a library with disposable tests, not a serving-issuer storage change. The existing `private.json`, SQLite session secrets, status keys and backups remain unchanged.

## Inputs and trust

Construct `PsKeyFile(directory, envelopeConfig)` with an existing absolute or resolvable directory and the envelope's caller-pinned manifest, configuration identifier, exact wrapping-key reference and injected transport. The resolved directory must be its canonical real path, a nonsymlink directory owned by the current UID with no group/other permission bits. The module does not create a missing directory, generate an issuer identity, choose a provider or read a plaintext fallback.

Directory device/inode identity is captured at construction and checked again after asynchronous provider work and before filesystem operations. File opens use no-follow flags; reads also use nonblocking mode to reject nonregular paths without waiting on a FIFO. These checks cover selected accidental substitution and unsafe paths. They are not descriptor-relative `openat` operations, and path checks can race a malicious local actor. Same-user code, a privileged process or a writer able to change ancestors is outside this boundary. Callers must control the directory and its parent path, keep final records immutable and use a reviewed local filesystem.

The fixed final name is `ps-keys.enc.json`. There is no user-selected filename, overwrite, rotation, import, migration, cleanup command, status/session-key file or global lock. An injected transport still must genuinely protect the data key and bind its context. The test provider uses a public wrapping key; it is never suitable for real keys. All limits and caveats of the envelope adapter continue to apply.

## Create and publication

`await file.create(secrets, { signal })` accepts the envelope's exact three canonical PS scalars and returns a frozen `{ sha256, bytes }` only after these steps:

1. Check the private directory and absence of any final path, including a dangling symlink or directory.
2. Seal the pinned scalars, then unwrap/authenticate the result through the same adapter before writing anything. Denied or unusable unwrap prevents disk publication.
3. Open a fresh random `.ps-key-<32 hex digits>.tmp` with exclusive creation, no-follow and mode `0600`. Write only the bounded ciphertext record, handling short writes, then synchronize and close the file.
4. Recheck the directory and temporary inode. Publish the final name with `linkSync`, which fails if that name already exists. Competing creators may both contact the provider and write candidates, but only one can publish the final name on the tested local filesystems. The loser removes only its own temporary link.
5. Synchronize the directory, unlink the owned temporary name, and synchronize the directory again. Return the ciphertext digest and byte length.

The implementation uses the [Node filesystem APIs](https://nodejs.org/docs/latest-v22.x/api/fs.html#fslinksyncexistingpath-newpath). A hard-link publication avoids replacing a concurrent winner. If the filesystem rejects hard links or directory sync, the operation fails; no weaker rename/overwrite fallback exists. Temporary and final names refer to the same encrypted inode during publication. A changed temporary inode is not unlinked by cleanup.

This sequence provides selected local publication and process-crash evidence. `fsync` is not a promise that every device, kernel, mount, network filesystem or power failure has been qualified. No hardware power-cut, device-cache flush, network filesystem or Windows acceptance is claimed. If a directory or syscall stalls, this synchronous phase can stall the JavaScript thread.

## Open and selected digest

`await file.open(expectedSha256, { signal })` requires a separately selected 32-byte lowercase hexadecimal ciphertext SHA-256. It opens only the fixed final name, checks owner/private mode and regular-file type, bounds the record to 16384 bytes, handles partial reads and compares the entire ciphertext digest before contacting unwrap. It then requires strict UTF-8 and all unchanged envelope scope, AEAD and scalar/public-manifest checks before returning scalar strings.

A missing final file returns `MISSING`; it never initializes state or consults a temporary file. A malformed digest returns `INPUT`; mismatched bytes return `DIGEST` before provider dispatch. Public-mode, symlink, FIFO, directory, empty, oversized or unreadable records fail. Digest selection is a caller responsibility: deriving the expected value from an untrusted file defeats its selection purpose. A returned creation digest is not automatically an independently stored checkpoint.

A digest authenticates selected bytes only in combination with trusted selection and the envelope checks. It proves neither global freshness nor permission to resume an issuer. An old authentic record remains readable if the caller selects its old digest and unchanged scope. Rollback policy, revocation, rotation, external checkpoint authority, distributed writer fencing and durable admission remain open.

## Failures and interrupted calls

File-layer errors have fixed `ERR_PS_KEY_FILE_` codes and fixed messages; no filesystem path, provider message or cause is returned. Existing sanitized `ERR_PS_KEY_ENVELOPE_` failures propagate from sealing/opening.

| File error | Meaning |
| --- | --- |
| `CONFIG` | Invalid directory or envelope configuration at construction |
| `INPUT` | Invalid selected digest or signal options |
| `EXISTS` | A final path already exists, including a concurrent publication; never replaced |
| `MISSING` | Open found no final path |
| `DIGEST` | Read ciphertext differs from the selected digest |
| `IO` | Unsafe file/directory or filesystem failure before this call publishes a final link |
| `UNCERTAIN` | This call published the final link but could not finish synchronization/cleanup; includes only its ciphertext `sha256` in addition to the fixed code/message |
| `BUSY`, `CANCELLED`, `CLOSED` | Overlapping call, pre-aborted input, or explicitly closed file adapter |

Before publication, failure attempts to remove only this call's matching temporary inode. If cleanup also fails, an orphan remains and the original fixed failure classification is preserved. After publication, failure never deletes the final file or claims rollback. `UNCERTAIN` retains the final record and its digest for an operator's explicit inspection. A later create encounters `EXISTS`. Reading and authenticating that digest can inspect bytes; it does not repair or prove durability after the failed sync, select a globally current record or authorize admission. This increment supplies no automatic uncertain-write recovery.

A killed process returns no result. Before publication it may leave an empty or partially written encrypted temporary file. After publication it may leave a complete final file and its temporary hard link. All orphan temporary names remain inert: no automatic adoption, deletion, age-based cleanup or fallback loading. Cleanup, retention and reconciliation need an approved stopped-owner procedure; the library never guesses which candidate is authoritative.

One operation may be outstanding per object; concurrent calls reject without queueing. `close()` closes the envelope boundary and prevents new calls. A pre-aborted signal never dispatches and leaves an idle object usable. Active provider cancellation, timeout or close retains the envelope's permanent-close semantics and discards late results. Abort cannot prove remote work stopped. The envelope bounds each transport operation; create involves both wrap and unwrap. Constructor/input validation and synchronous filesystem work are outside those deadlines. There is no single whole-create latency bound or cancellation that preempts filesystem syscalls.

Only ciphertext reaches this library's filesystem writes. Scalar strings and crypto/provider memory remain plaintext in-process and are not guaranteed zeroized. A wrapping function that returns an unprotected data key can undermine the record's confidentiality; roundtrip success cannot prove provider custody. Existing issuer/session stores are still plaintext. No constant-time backend, non-exportable key, production privacy or independent crypto review follows from this library.

## Evidence

The [focused suite](../research/ps-lab/local/key-file.test.mjs) has 22 tests, including private/digest/unsafe-path rejection, unwrap denial before any write, directory replacement during provider work, cancellation/busy/close, partial reads/writes, sync order, prepublication failures, uncertain postpublication failures, failed cleanup, substituted temporary inodes and a two-process publication race. Disposable fault injection uses Node filesystem replacements in tests only; it is not a production fault interface or actual disk-exhaustion evidence.

The [worker](../research/ps-lab/local/key-file-worker.mjs) stops at seven filesystem boundaries so the parent can send actual `SIGKILL`:

| Boundary after call | Expected selected process-crash observation |
| --- | --- |
| Exclusive temporary open | No final file; inert empty temporary |
| Temporary write | No final file; inert candidate temporary |
| File sync | No final file; inert candidate temporary |
| Publication link | Complete final record; temporary link may remain |
| First directory sync | Complete final record; temporary link may remain |
| Temporary unlink | Complete final record only |
| Second directory sync, before acknowledgement | Complete final record only; caller received no acknowledgement |

Every case reopens or recreates with disposable pinned configuration and verifies no final overwrite or orphan adoption. Postpublication test digests computed from the fixture are inspection inputs, not a claim of trusted operator recovery. A separate fresh process opens a successful record; the public test wrapper and same-author fixtures do not qualify a real provider. Existing 22 process-kill locations remain unchanged, bringing the selected total to 29.

Seven temporary mutation controls omit the selected digest, prepublication unwrap, file sync, directory sync, temporary-inode cleanup check, private file mode check or captured directory identity. Each must fail its named regression with an assertion. [Current evidence](../research/ps-key-file-validation.json) records source/baseline/output hashes, affected tests and explicit inherited app/reference evidence. All previous manifests are historical and unchanged.

Qualified secret execution, actual provider identity/permissions and transports, protected session state/whole backups, durable asynchronous issuer commit/recovery, hosted operations, real target devices and independent review remain release dependencies. Independent C1/C4 and [PS-OWN-01](PS-REVIEW-PACKET.md#open-review-item-former-holder-and-cross-asset-forgery) stay open. No serving issuer, migration, cloud resource or staging activation is added or approved.
