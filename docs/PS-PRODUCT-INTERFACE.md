# Local PS product interface

The ZFT React application now has an isolated `/ps/` interface over the existing browser credential Worker. It includes a collection, issuer-scoped item views, JPG/PNG preparation, mint, receive, cancel and recovery. This is step 1 of the [release sequence](PS-RELEASE-PLAN.md), running against a disposable loopback issuer. No hosted issuer or devnet PS feature is enabled.

## Run and trust boundary

```sh
pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
pnpm ps:local
```

Open the launch link printed by the command. It builds the application and serves fixed assets at `http://127.0.0.1:<random-port>/ps/` alongside the existing lab Worker modules and `/issuer`. A 256-bit launch capability is required, removed from the address fragment and held in page memory. Host, Origin and capability checks remain enforced. Product mode serves only a fixed startup asset map and known PS routes; it does not map request paths to the filesystem. The ordinary lab mode retains exact URL matching. Build files reject symlinks and have a 64 MiB/2048-file cap.

The root application lazily selects the PS interface only for `/ps` or `/ps/…`. Other routes retain the existing v1 application. A hosted PS page fails the loopback launch gate before creating a credential Worker or contacting an issuer. The local launch has public fixture keys and disposable Alice/Bob/Restored roles; stopping it loses the issuer registry. The encrypted browser copy and saved files do not restore that registry. Do not use real assets.

## Artwork and recovery workflow

1. Create or open an encrypted test-role browser copy. The existing Worker validates the full issuer manifest and client identity, keeps secrets/proofs inside the Worker, and stores only encrypted journal records in IndexedDB.
2. Select a JPG or PNG. The existing codec normalizes it in a separate Worker. Original input is at most 10 MiB; the unchanged PS image profile requires normalized RGBA8 PNG at most 65,536 bytes and 262,144 pixels. Oversized results reject; no silent resizing or cryptographic format change occurs.
3. Prepare the mint. Download its encrypted recovery file, select that actual saved file and verify the password before submission becomes available. Claim and cancellation use the same gate and unchanged verify-before-persist behavior.
4. The collection and `/ps/item/<realm>/<credential-id>` show only fully verified original public image bytes. A local active flag is explicitly distinguished from a fresh issuer status check.
5. Export a public PNG, an encrypted transfer file, or an explicitly consented plaintext private bearer PNG. A private file enables a competing claim; sharing a file does not complete a recipient refresh. Cancellation competes with recipient claims and cannot undo a completed claim.
6. After an uncertain response, retry or retrieve the exact saved operation. A separately opened client can restore a saved encrypted recovery file with its expected ID and retrieve the committed replacement from this same running issuer.

The UI serializes Worker actions. Message IDs/actions cannot be overridden by caller data. Replies from terminated Workers cannot affect the current view. Explicit lock, hidden/pagehide and five-minute idle lock terminate the Worker, abort normalization, clear input fields and revoke object URLs. The 90-second Worker timeout leaves the encrypted journal available for recovery. Navigation links pause during active work; history navigation during work locks the view. These controls do not promise secure memory erasure, eviction survival or hardware durability.

## Validation and remaining acceptance

[Current evidence](../research/ps-product-interface-validation.json) records 235 app tests, 218 lab tests, 58 existing lab mutation controls and three new app bridge controls. Six app tests exercise launch/route scoping, late replies, serialization/reserved message fields, timeout and encrypted-file limits. Two lab tests exercise fixed asset selection/symlink rejection and isolation from ordinary lab mode. An initial full run detected that product query handling accidentally relaxed ordinary lab URL matching; the correction restores its existing regression and all 14 affected HTTP tests pass.

Actual Codex desktop browser acceptance uses an original synthetic 32×32 JPG, normalized to a 2652-byte PNG. Mint, saved recovery download/reselection/first acknowledgment, private PNG download and Bob's claim passed. Cancellation with a third separately saved/reselected backup passed, followed by encrypted-copy reopening and restoration into a third client. This exercises native browser PNG decoding, real Blob files and IndexedDB, separately from automated Node adapters. The final title/logo and navigation guard revision is identified separately in the evidence; no claim is made that every lifecycle handler was manually exercised.

Encrypted transfer export/import is implemented over unchanged tested Worker actions; this increment does not claim every transfer UI path, every supported image input or a full target-browser/phone matrix. The earlier IndexedDB race/fault matrix, reference fixtures and demos are historical evidence unless explicitly rerun. The current record distinguishes each run. Wallet identity, public proofs, persistent production trust, operational/device qualification and hosting follow in later steps. [Independent review](PS-REVIEW-PACKET.md), including PS-OWN-01, remains open.
