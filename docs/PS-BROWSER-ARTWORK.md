# PS browser artwork prototype

This C5 increment follows merged PR #22 (`32e4472`) and adds PNG file handling and selected-credential artwork display to the isolated [browser client](PS-BROWSER-CLIENT.md). Owner secrets and proofs remain in its dedicated Worker; encrypted working journals remain in IndexedDB. **Public fixture issuer keys; no real assets or deployed integration.** [Current evidence](../research/ps-browser-artwork-validation.json) records this revision. [PS-OWN-01](PS-REVIEW-PACKET.md#open-review-item-former-holder-and-cross-asset-forgery) remains open for independent review.

## Use the local workflow

Start `pnpm --dir research/ps-lab --ignore-workspace browser:local`, open the printed launch link and choose **Browser client**. The issuer and pinned trust disappear when the disposable server stops; downloads cannot restore that lost issuer registry. Use only public test passwords and disposable artwork.

1. Create or reopen Alice's encrypted browser copy. Use a built-in artwork or select a normalized PNG and choose **Prepare mint from normalized artwork PNG**.
2. Create the encrypted recovery download, save it, reselect the saved file and verify it with its password. Only then submit the exact request.
3. Select the resulting credential and **View artwork**. This displays only verified original image bytes. **Download public artwork PNG** saves those same bytes. **Download private bearer PNG** explicitly exports plaintext bearer authority with a warning.
4. Bob selects that private PNG and prepares a claim. Bob must separately save and verify the claim recovery file before submitting. File handover alone does not transfer exclusive control; a copied file can race until a recipient refresh commits.
5. Bob can cancel to a fresh secret using the same recovery gate. Previously spent credentials disappear from the local active list; the issuer rejects stale source claims. Viewing a locally active image is not a fresh unspent-status check.

Encrypted transfer and recovery files continue using the existing vault format. PNG inputs are limited to already normalized, noninterlaced RGBA8 images of at most 65,536 bytes and 262,144 pixels. There is no JPEG conversion or general artwork normalizer in this slice. Shape checks do not prove normalizer provenance or pixel-canonical identity.

## Exact file and authority boundary

The existing [PNG envelope](PS-IMAGE-ENVELOPE.md) stays `zft-ps-png-lab-v1`: one bounded canonical UTF-8 JSON `zfPC` chunk over the exact original image. The complete caller-pinned PS manifest, full image SHA-256 and signed scoped asset attribute are verified. No imported file chooses an issuer URL, realm or key. File/payload/chunk limits remain 69,644 bytes, 4,096 bytes and 128 total chunks; public input reserves an envelope slot (at most 127 chunks).

The [fixed ESM builder](../research/ps-lab/web/modules.mjs) adapts the unchanged local image-envelope source to asynchronous browser calls. The new [portable PNG validator](../research/ps-lab/web/png.mjs) checks signature, chunk structure/order/count, lengths, CRC, shape, pixel limits, decompressed scanline length and filter bytes. Input bytes are copied before asynchronous decoding. This is a same-author port, not an independent implementation review.

The [client methods](../research/ps-lab/web/client.mjs) validate images before pending journal writes and retain lock/epoch checks across asynchronous work. Existing proof construction, exact recovery acknowledgment, issuer spend/response transactions and encrypted state persistence are unchanged. The Worker releases public preview bytes or explicitly requested private/export bytes, never private PNG bytes as a preview. Page Blob URLs are revoked on replacement/lock; this does not erase saved files, OS copies, memory or steganographic content. Same-origin scripts and extensions remain trusted.

## Browser decompression boundary

The browser uses native `DecompressionStream("deflate")`. The [WHATWG Compression Standard](https://compression.spec.whatwg.org/#supported-formats) requires errors for incomplete streams, invalid checksums and bytes following the zlib stream. Before accepting any image, a cached compatibility check verifies a known valid stream and rejects one trailing byte, concatenated streams and truncation. Unsupported engines fail closed. These probes detect selected incompatibilities, not every possible decoder defect.

The development Node 22.12.0 native decoder accepted trailing bytes and concatenated streams. Automated portable-image tests therefore explicitly use a **test-only strict Node zlib adapter** with consumed-input and output-length checks. Those tests do not qualify native browser decompression. Actual desktop browser acceptance separately exercised the native decoder, valid private PNG claim/display and trailing-data rejection. No fallback silently relaxes validation.

Compressed input and retained output are bounded; the reader cancels on excess output. Native decoder internal allocation, scheduling and aggregate CPU are not qualified as a production resource policy. No decoder dependency or lockfile changed.

## Validation and acceptance

**216 local tests and 58 mutation controls pass**, including 13 new tests and six new controls. The 21 actual SIGKILL locations are unchanged. New tests cover three exact fixture images, nonzero-offset buffers/input ownership, decoder incompatibility, CRC, malformed/trailing/concatenated/truncated/checksum/overlong inflation, filters, pixel/chunk/file bounds, Node/browser exact envelope bytes, canonical payloads, caller trust, full digest, signed asset substitution, public/private output separation, pre-write rejection, lock during decode, claim/cancel/reopen and stale issuer rejection. Controls independently remove CRC, decoder rejection, preview separation, issuance validation, full digest or signed-asset verification and must fail named assertions.

Actual Codex desktop browser acceptance completed fixture mint, encrypted recovery download/reselection and acknowledgment, public display, public/private PNG downloads, Bob's claim from the downloaded private PNG, separately saved/reselected claim recovery, cancellation with its own saved/reselected recovery, and lock/reopen at revision 9 with the replacement credential. Displayed images decoded at 2×2; public downloaded bytes exactly match the original fixture, and the private download adds exactly one envelope. A trailing-deflate PNG mint attempt rejected without changing revision 9. Password fields cleared; observed console warnings/errors were empty. Checked 1280px and 390px layouts had no horizontal overflow; the latter is a desktop viewport, not phone acceptance.

The initial in-app picker call stalled, triggering normal idle lock. A native Brave fallback did not complete acceptance. Later bounded, separate chooser calls succeeded in the in-app browser; no timeout/expiry or file-picker code was changed. Actual files were saved and reselected rather than inferred from download-event notifications. The full normalized-file mint UI path, stale-copy rejection through UI, broader browsers/phones, quota/eviction/crashes and every lock handler remain unqualified; selected automated tests cover those protocol paths without replacing device acceptance.

App/reference checks are inherited locally from PR #22 CI and rerun by this PR's CI: 43 reference tests, three controls, exact Python fixtures, 13-dependency inventory, root typecheck, 229 app tests, v1 image compatibility and build/contracts/Worker checks. Existing demos and manual IndexedDB test matrix were not rerun in this slice. Eleven prior validation manifests remain frozen historical records.

## Remaining gates

C5 still needs general artwork normalization, broader collection/product routes, public showing/state UI, wallet identity and device acceptance. C1/C3 remain partial; C4 including PS-OWN-01 needs independent review; C6 hosting, production trust/key lifecycle, admission/retention and incident recovery are unimplemented. Public fixture keys, unqualified secret BigInt side channels, stale snapshots, observer/issuer rollback and malicious-origin/issuer assumptions remain. No audit, production privacy, live interoperability, ordinary MetaMask NFT custody, Snap, deployment or v1 migration is claimed.
