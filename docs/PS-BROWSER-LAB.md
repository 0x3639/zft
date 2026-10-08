# Local PS browser console

This C5 prototype adds a browser interface to the existing local Node engine after merged PR #19 (`e0a8beb`). It is a **single-operator, disposable test console**, not a browser cryptographic client, hosted mint, account system or production wallet. It uses public fixture issuer keys, a new random realm on each start, three plaintext SQLite client stores and the unchanged PS/image/vault implementations. No ZVM or external issuer request is made.

## Start and try

```sh
pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
pnpm --dir research/ps-lab --ignore-workspace browser:local
```

Open the complete launch URL printed in the terminal in a desktop browser. It contains a temporary control capability in its fragment. The page removes the fragment from its address and keeps the capability only in memory. Reloading requires opening the complete launch link in a new tab. Do not share it. Browser extensions, the local process and anyone with this capability can control all three clients; Alice, Bob and Restored are workflow roles, not isolated authenticated accounts.

1. Select Alice and prepare one of the three original normalized test artworks. Arbitrary-image normalization is outside this slice.
2. Enter a test password and request encrypted recovery. Use the resulting **Save** link, then reselect the saved file and enter its password. Download generation never acknowledges the operation. Password fields clear after each attempted action.
3. Submit the prepared request. Optionally simulate an issuer commit whose return is lost. A successful ordinary submission verifies and saves the credential.
4. Export a private bearer PNG for Bob to import, or an encrypted credential file for the encrypted-file claim form. Prepare a fresh claim and its own verified recovery backup before submission. Public-image export returns only the original image bytes.
5. Prepare cancellation to swap to a fresh local secret. It has its own recovery gate and can lose to a competing bearer claim. A locally active label is not a fresh issuer-state assertion.
6. To recover a lost response, reselect the encrypted recovery under the workbench's expected backup identity and restore into the third client. Recover the original response; do not create a different request. The same issuer process must remain running.

The wrapper remembers each generated backup's random vault identity, record identifier, actor and operation in memory. A selected file cannot establish its own identity or issuer trust. Up to four independently encrypted exports per source record are retained in this identity list; each remains selectable. A maximum of 24 tracked operations bounds this disposable workflow. Restart to start a new experiment, not to continue an old one.

**Stopping the process destroys the issuer and clients.** Ctrl-C/SIGTERM closes stores and removes the private temporary directory. SIGKILL, power loss or a process crash can leave plaintext temporary files; no secure deletion or crash cleanup is claimed. The next start creates a different realm and cannot recover prior files. Encrypted credential/recovery exports do not recreate the issuer registry or its committed responses. Disconnect console drops this page's capability and visible files; it does not revoke other tabs' capability or lock/erase Node's databases.

## Local HTTP boundary

[The server](../research/ps-lab/local/browser-server.mjs) listens only on `127.0.0.1` with an OS-selected port. There is no configurable bind address, hosted route, directory browser, arbitrary file path or remote issuer URL. Only fixed console assets, the browser-vault module closure/styles and retained noble license notices are served. Every API action uses POST `/api` with:

- an exact single `Host` for this loopback port;
- an exact single same-origin `Origin`;
- a random 256-bit launch capability in `Authorization: Bearer ...`;
- unencoded `application/json`, canonical bounded JSON and an action-specific exact field set.

CORS is not enabled. Responses use no-store, nosniff, no-referrer, same-origin resource policy, frame denial and a restrictive CSP with only local scripts/styles/connections and local image blobs/data. No inline script or third-party resource is loaded. The expected origin is constructed by the server, never copied from a request. See the primary [Node HTTP API](https://nodejs.org/download/release/v22.12.0/docs/api/http.html) and [Origin header behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin).

Actual streamed request bytes are capped at 2,109,440, independently of Content-Length. Existing decoded vault/PNG/PS limits apply after transport framing. Header size is 8 KiB, active body reads are limited to two, connections to eight, and request/header/socket timeout settings to ten seconds. These are local test bounds, not aggregate resource or denial-of-service qualification; synchronous pairings/KDF work blocks the event loop and delays timers. Error responses deliberately omit assertion details, secrets, submitted passwords and filesystem paths. The server logs no requests; its startup prints the launch capability for the local operator.

The [controller](../research/ps-lab/local/browser-lab.mjs) validates imported images before opening issuer sessions, keeps the existing recovery gate, and uses exact pinned vault readback before acknowledgment. Restore verifies the selected encrypted recovery before using the unchanged client restore operation. Status lists contain the public pinned manifest, identifiers, local flags, counters and public fixture images, not credential scalars or pending snapshots. Private bearer downloads intentionally contain authority; public export must not.

This surface transports passwords and exported files over loopback HTTP to Node. It does not give browser-only secret generation, encrypted working storage, Web Worker isolation, extension resistance, TLS, wallet endorsement, cross-machine access, multiuser isolation or issuer restart recovery. Do not expose it through a proxy, tunnel or public bind address.

## Validation and acceptance limits

[Historical PR #20 evidence](../research/ps-browser-validation.json) records **160 local tests** (12 new), **40 mutation controls** (5 new) and the same **21 actual process-kill locations**. New tests drive both the controller and actual loopback HTTP: recovery gating, exact encrypted files, lost-return recovery, stale claims/cancellation, encrypted bearer claims, secret-free status, malformed inputs, actor/backup substitution, operation/export caps, private-directory cleanup and different-realm restart rejection. The new controls accept a foreign origin, accept a wrong capability, acknowledge before decrypting the selected file, leak bearer authority in public export, or expose recovery snapshots in status. Each must fail a named assertion.

Manual in-app browser checks prepared a mint and encrypted download link, selected an actual encrypted file, verified the submission gate, simulated a lost response, restored into the third client and recovered the committed credential. Password fields were cleared afterward. Desktop 1280px and narrow 390px layouts had no horizontal overflow. This is desktop viewport testing, not phone qualification.

**PR #20 did not qualify browser-managed download saving.** The in-app browser's download event/API timed out on the generated Blob links, with no confirmed saved file. The file used for the subsequent UI upload/restore check was instead saved by a test script through the actual loopback API. Do not describe this as a verified browser download–reselect roundtrip. Save-link completion in ordinary target browsers and actual two-device flows remain acceptance work. Node HTTP tests independently verify exact encrypted bytes and recovery semantics. Existing app/reference checks are inherited from PR #19 and rerun in PR CI; this slice changes no app runtime or root dependency.

## Product direction and remaining work

The user confirmed on October 8, 2026 that ZFTs do not need initial MetaMask inventory display. The [protocol direction](PS-CREDENTIAL-PROTOCOL.md#decision-for-review) is ZFT-managed PS credentials with MetaMask identity; a possible [later display Snap](PS-CREDENTIAL-PROTOCOL.md#deferred-metamask-snap) follows the core experience. No Snap or wrapper is implemented here.

Next C5 work includes moving credential computation and protected working storage into the browser, secure password UX, normalizing arbitrary artwork, wallet-authenticated publication, product routes and real browser/device acceptance. C1/C3 remain partial; independent C4 review and C6 production keys/admission/retention/hosting are still open. This local HTTP console does not approve a hosted issuer, migration or apex promotion. Public fixture keys and unqualified secret BigInt operations remain unsuitable for real assets.

## Browser vault follow-up

The [separate browser-vault page](PS-BROWSER-VAULT.md) now handles existing encrypted records inside a browser worker and IndexedDB. The original console still uses Node for its operations/passwords. [New evidence](../research/ps-browser-vault-validation.json) also records a successful real Brave console download/reselection using keyboard Save-link activation, while the new in-app vault download remains unverified. Older evidence above is preserved for its original scope.
