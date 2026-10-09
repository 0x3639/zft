# PS target acceptance matrix

This is release step 6. The proposed first-release targets below remain pending; Codex desktop checks do not establish extension/phone support. Every acceptance report must identify the candidate commit/tree, browser/OS/wallet versions, test identities, expected and actual results, failures, and evidence artifacts without passwords or private bearer/recovery bytes. Use disposable test artwork only.

| Target ID | Required scope | Current result |
| --- | --- | --- |
| `chromium-desktop-metamask` | Chrome/Brave-class desktop, actual MetaMask selection and exact public-message signing | Pending real extension; selected Codex Chromium UI checks are narrower |
| `firefox-desktop-metamask` | Firefox desktop with actual MetaMask; PNG decoder acceptance or clearly supported alternative | Pending |
| `safari-ios` | Real iPhone/iPad Safari file save/reselect, encrypted copy, receive/recovery, lifecycle | Pending; mobile wallet injection/signing is not assumed |
| `chrome-android` | Real Android Chrome file save/reselect, encrypted copy, receive/recovery, lifecycle | Pending; mobile wallet injection/signing is not assumed |

Changing this target set is an explicit release-scope decision. A 390px desktop viewport is a layout check, not phone acceptance. Do not silently replace a failing target with an easier browser or a Node decoder.

## Exercise each supported target

1. Open the exact reviewed local/staging launch route with its pinned trust. Confirm private material is not in URL/query/history after bootstrap. Create and reopen the encrypted browser copy; test wrong password without overwriting it.
2. Normalize supported JPG/PNG artwork, mint with an actual saved/reselected encrypted recovery file and verify first acknowledgment before submission. Download public/private copies separately; compare public bytes and inspect private-file labeling.
3. Transfer the actual saved file to a second supported browser/device. Save/reselect its separate recovery file, claim, and reject stale copies. Repeat cancellation with a separately verified backup. A file handover without recipient refresh is not a completed transfer.
4. Lose a committed response deliberately, close the page, restore in the third client and retrieve the exact operation result. Repeat with issuer outage/restart. Never bypass recovery gating or extend expiry just to complete a test.
5. Prepare public evidence, review disclosure, and publish only after explicit consent. On wallet targets verify exact message/account/chain, rejection, account change, chain change, disconnect and expiry. Signing should not call the down ZVM RPC. Contract-wallet support is not claimed.
6. Open the public link without private capability or vault. Verify credential proof, optional wallet signing key, artwork hash and timestamped issuer report separately. Observe expiry and a later spend; the page must not claim current ownership or reservation. Inspect initial sharing metadata and actual target-platform preview where in scope.
7. Test lock, hidden/pagehide, idle, browser restart, competing tabs, back/forward navigation and a fresh launch fragment in an already-open tab. Confirm passwords clear, object URLs and Workers are released and late completion cannot reopen private state.
8. Exercise keyboard/focus, screen-reader labels, touch controls, narrow/large text layouts, storage quota/eviction/abort and unavailable file saving. Preserve recovery artifacts and clearly explain recovery/expiry conflicts. Record unsupported behavior rather than calling it accepted.

Some browser automation calls have stalled despite short timeouts. Record the actual saved/reselected file separately from download-event API success. Automation timeout alone is not proof that the browser failed to download, nor is a scripted file write proof of a native download/reselection roundtrip.

## Current evidence limits

The [product interface](PS-PRODUCT-INTERFACE.md) has selected native desktop mint/claim/cancel/third-client recovery checks. [Public evidence](PS-PUBLIC-PRESENTATION.md) has native public-page verification from a scripted HTTP publication; complete publish UI and real wallet signing remain pending. [Persistent local state](PS-PERSISTENT-LOCAL.md) has native empty-copy reopening after an actual server restart and automated full issuer recovery. [Operations](PS-LOCAL-OPERATIONS.md) has offline snapshot/restore tests; no new native restore lifecycle is claimed. No report here closes independent cryptographic review, storage hardware faults or target phones.
