# Local PS encrypted file vault

`zft-ps-local-vault-v1` is an original, offline C5 research wrapper for the [local PS profile](PS-LOCAL-ENGINE.md) and [image adapter](PS-IMAGE-ENVELOPE.md), extending merged PR #18 (`96ed208`). It encrypts exported bearer records and exact pending-operation recovery snapshots in a separate file. It does **not** encrypt the live client/issuer/observer SQLite databases, change PS equations or integrate a browser. Public fixture issuer keys and the demo's public password are test material, unsuitable for real assets.

Implementation: [vault.mjs](../research/ps-lab/local/vault.mjs). [Historical PR #19 evidence](../research/ps-vault-validation.json) records source hashes and validation. The [independent-review packet](PS-REVIEW-PACKET.md) includes this boundary; the reviewer is unassigned and review remains pending.

## Format and password handling

The outer file is canonical UTF-8 JSON with exactly `format kdf cipher salt iv vault_id manifest ciphertext tag`. All binary values use canonical lowercase hex. The caller pins the complete PS manifest and the 16-byte vault ID separately; an imported file cannot establish those trust choices. The ID is an identity check, not a monotonic revision or rollback defense.

| Field | Value |
| --- | --- |
| `format` | `zft-ps-local-vault-v1` |
| `kdf` | Exactly `scrypt-n32768-r8-p1` |
| `cipher` | Exactly `aes-256-gcm` |
| `salt` | Fresh random 16 bytes per export |
| `iv` | Fresh random 12 bytes per export |
| `vault_id` | Random 16-byte identity retained across exports |
| `manifest` | Exact local `protocol realm keyset_id public_key` |
| `ciphertext`, `tag` | Encrypted content and exactly 16-byte authentication tag |

The key is 32 bytes from scrypt with N=32768, r=8, p=1 and a 64 MiB implementation memory ceiling. Files cannot choose different work factors. These fixed lab parameters follow the [scrypt construction](https://www.rfc-editor.org/rfc/rfc7914.html#section-6); production password policy, parameter tuning and device costs remain review work. Passwords are exact, well-formed Unicode encoded as UTF-8, 12–1024 bytes; there is no silent normalization. A byte minimum is not an entropy guarantee, and stolen vault files permit offline password guessing.

The canonical outer header excluding `ciphertext` and `tag` is the AES-GCM additional authenticated data. Node's [authenticated decryption API](https://nodejs.org/download/release/v22.12.0/docs/api/crypto.html#deciphersetauthtagbuffer-encoding) must finish successfully before plaintext is decoded or any records returned. Password/key and intermediate plaintext buffers owned by the wrapper are filled with zero on exit. JavaScript strings, caller-held copies, crypto-internal allocations, GC, swap and crash dumps are not reliably erased; `lock()` is an API access boundary, not secure-memory qualification.

The clear header exposes the issuer identity and stable vault ID; ciphertext length remains visible. The format has no wallet signature, issuer status receipt, URL, browser origin, expiry or claimed spent status. It is distinct from both `zft-vault/1` and the PNG bearer format. No migration or automatic format selection is provided.

## Bounded typed records

Decrypted content has exactly `format vault_id manifest records`, with content format `zft-ps-local-vault-content-v1`. The inner identity and manifest must match the pinned values. `records` is an object with at most **8 records**. Each key is SHA-256 of UTF-8 `kind + NUL + wire`; each value has exactly `kind wire`. Duplicate exact records are idempotent. No partially validated record set is exposed.

- `bearer`: the exact canonical local bearer JSON, reverified against pinned trust and the signed asset binding. Images remain part of that local envelope; callers use the image adapter to convert to/from PNG.
- `recovery`: the exact full canonical pending snapshot, including its request, destination secret, unblinding material and response-retrieval capability. The wrapper reuses `Client.validateSnapshot` without opening a database; restore repeats the existing engine validation.

Total canonical plaintext is limited to **1,048,576 bytes**; the entire hex-encoded encrypted JSON file is limited to **2,101,248 bytes**. Existing per-record bearer/recovery limits still apply. A record that would exceed the count or byte budget rejects before changing the unlocked set. Unsupported algorithms, extra fields, noncanonical JSON/hex, wrong lengths and malformed UTF-8 reject. Authenticated ciphertext still needs complete typed content validation.

## Local operations and recovery

`new LocalVault(manifest)` creates an unlocked empty vault with a fresh ID. `add(kind, wire)` validates then stores a record and returns its ID. `list()` exposes IDs/kinds; `read(id)` explicitly returns a plaintext copy of that record. `seal(password)` produces a fresh encrypted serialization without modifying the record set. `lock()` drops internal record references and blocks list/read/add/seal; reopen a saved serialization with `LocalVault.open(wire, password, manifest, expectedId)`.

`writeVaultFile(path, vault, password)` seals the unlocked vault and exclusively creates a new mode-0600 file. It refuses an existing path or leaf symlink and requests file fsync. It does not replace an existing backup. A failure can leave an unusable partial file; choose a new filename and retain prior backups. This is not atomic publication, directory-fsync qualification or a power-loss guarantee. The parent directory and running process must be trusted.

`readVaultFile(path)` uses a descriptor, refuses a leaf symlink, nonregular file or group/other permission bits, and bounds both the stat size and actual bytes read before strict UTF-8 decoding. The file helpers target local macOS/Linux semantics; Windows, hard-link attacks, hostile parent replacement, concurrent editing and hardware failure remain unqualified.

`acknowledgeRecoveryFile(client, digest, path, password, expectedId)` reads/decrypts/validates the saved file, requires that it contains the exact current snapshot, and only then calls the existing acknowledgment gate. Merely adding a record or sealing in memory does not acknowledge recovery. `restoreRecoveryFile(client, path, password, expectedId, recordId)` validates the entire vault before restoring the selected recovery record; it does not submit a new request. Call the existing `recover` operation to retrieve the original committed response.

The caller is responsible for copying each new unresolved operation into a saved vault and retaining the trusted ID and manifest. This wrapper is not an automatically synchronized client backup. Re-sealing with a new password leaves old exports valid under their original passwords; there is no revocation or deletion guarantee. An older valid export still opens and may omit newer operations. Encryption provides neither version freshness nor issuer anti-rollback protection. A cryptographically valid stored bearer may already be spent; issuer submission still decides whether it can be claimed.

## Run and evidence

```sh
pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
pnpm --dir research/ps-lab --ignore-workspace test:local
node research/ps-lab/local/check-controls.mjs
pnpm --dir research/ps-lab --ignore-workspace demo:vault
```

Twenty-two new tests cover exact encrypted records, fresh salt/IV, wrong passwords, altered tags/header/ciphertext, manifest/identity pins, hostile work-factor declarations, Unicode and size limits, lock behavior, authenticated malformed content, exclusive files/modes/symlinks, acknowledgment from actual encrypted-file readback and lost-response recovery into a third store. Valid older exports and password re-sealing explicitly demonstrate the lack of rollback protection and revocation. The combined suite has **148 local tests, 35 mutation controls and the same 21 actual process-kill locations**.

Seven new temporary controls omit GCM finalization/AAD, ignore pinned manifests, retain records on lock, acknowledge before encrypted readback, skip decrypted-record validation or weaken the KDF. Each must fail its named regression. RFC 7914 section 12's password/NaCl vector checks Node scrypt; WebCrypto decrypts exact generated AES-GCM bytes using independently assembled header input. Node and WebCrypto may share a backend; these are primitive/API checks, not independent review of the composed vault protocol.

The demo uses disposable files with public test keys/password, saves and verifies encrypted recovery before acknowledgment, deliberately loses a committed response, restores into a third plaintext working client, saves its new bearer encrypted, locks/reopens it and verifies the exact public image. It removes all temporary files and logs only outcomes. C1/C3/C4 remain partial or pending. Browser/phone acceptance, secure password entry, encrypted working stores, memory isolation, backup freshness, wallet endorsement, public custody approval, production trust/key lifecycle and C6 hosting remain open.


The [browser console](PS-BROWSER-LAB.md) reuses this format for encrypted downloads and verifies reselected content against identities pinned in the running lab. Browser file selection proves available bytes, not filesystem durability; browser-managed download saving remains unverified in the recorded in-app check. Its [current evidence](../research/ps-browser-validation.json) supersedes this historical manifest only for changed wrapper/docs files.
