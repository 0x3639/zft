# Local PS image envelope

`zft-ps-png-lab-v1` is an isolated file prototype over the [local PS credential profile](PS-LOCAL-ENGINE.md), extending merged PR #17 (`a7427d4`). It embeds plaintext bearer authority in a small PNG without changing the credential equations or image bytes. It is implemented in [image.mjs](../research/ps-lab/local/image.mjs) and [png.mjs](../research/ps-lab/local/png.mjs). Public fixture issuer keys, plaintext recovery files and unqualified secret BigInt operations make this unsuitable for real assets. No app route, browser vault, wallet endorsement, server or deployment is added.

[Historical PR #18 evidence](../research/ps-image-validation.json) records this image slice. The [encrypted export vault](PS-LOCAL-VAULT.md) now wraps the existing local bearer/recovery records without changing the PNG format; [current vault evidence](../research/ps-vault-validation.json) records the later revision. The [review packet](PS-REVIEW-PACKET.md) prepares material for independent review; it does not claim that review has happened. The public custody decision in the [proposal](PS-CREDENTIAL-PROTOCOL.md#decision-for-review) remains open.

## Run the prototype

From the repository root, with Node 22.12 or later and the existing pinned lab dependencies:

```sh
pnpm --dir research/ps-lab --ignore-workspace install --frozen-lockfile --ignore-scripts
pnpm --dir research/ps-lab --ignore-workspace test:local
node research/ps-lab/local/check-controls.mjs
pnpm --dir research/ps-lab --ignore-workspace demo:image
```

The demo creates private temporary stores and files, mints an original test PNG, exports it, prepares a claim, deliberately loses the committed response, restores the exact saved recovery file into another client, cancels to a fresh credential and rejects stale copies. It checks that the public image is byte-identical to the initial image. Files are created exclusively with mode 0600, outcomes alone are logged, and the temporary directory is removed. These file writes do not constitute fsync, power-loss, encrypted-backup or real-device qualification.

## Image identity and limits

This adapter accepts already-prepared RGBA8, noninterlaced PNGs. It is not a JPEG/PNG normalizer. Callers must normalize before issuance; import/export never re-encode a minted image. The unchanged [ZFT normalizer](../packages/file-codec/index.ts) produces compatible small inputs, checked by [three original pixel fixtures](../research/ps-lab/local/image-fixtures.json). Validation recognizes a restricted PNG shape, not proof that arbitrary bytes came from that normalizer. Different encodings of identical pixels remain different byte assets.

| Boundary | Limit or rule |
| --- | --- |
| Underlying image | At most 65,536 bytes, matching the existing local PS asset limit |
| PNG pixel count | At most 262,144; width and height nonzero |
| Pixel format | 8-bit RGBA, compression/filter methods zero, no interlacing |
| Image chunks | Exactly IHDR, consecutive IDAT chunks, empty IEND; at most 127 total |
| Bearer PNG chunks | Same image plus exactly one `zfPC` after the last IDAT and before IEND; at most 128 total |
| Envelope payload | At most 4,096 bytes of canonical UTF-8 JSON |
| Complete bearer file | At most 69,644 bytes |
| Inflation | Exact `(4 * width + 1) * height` scanline bytes; at most 1,310,720 under the pixel limit |

PNG signature, chunk lengths/names, CRCs, ordering, headers, filter bytes and complete stream consumption are checked. Metadata, animation, unknown chunks, legacy `zfTA`, mixed envelopes, duplicate envelopes, trailing file/deflate bytes and concatenated compressed streams reject. Inflation uses Node's [bounded synchronous zlib API](https://nodejs.org/download/release/v22.12.0/docs/api/zlib.html#class-options); consumed-input length must equal the concatenated IDAT length. This bounds individual inputs, not aggregate CPU/admission or production resource qualification.

The new `zfPC` name uses PNG's ancillary/private/unsafe-to-copy flags; the [PNG specification](https://www.w3.org/TR/2025/REC-png-3-20250624/#5Chunk-naming-conventions) defines those bits. Ordinary decoders can ignore the envelope and display the artwork. Editors may discard it; changing critical image chunks invalidates the asset binding. This prototype deliberately accepts a strict subset, not every standards-compliant PNG.

## Exact envelope

The `zfPC` payload contains exactly these keys, serialized by the existing local canonical JSON rules:

| Field | Meaning |
| --- | --- |
| `file_protocol` | Exactly `zft-ps-png-lab-v1` |
| `protocol` | Exactly `zft-ps-local-v1` |
| `realm`, `keyset_id`, `public_key` | Complete local issuer identity; checked against caller-pinned trust |
| `type` | Exactly `bearer` |
| `image_sha256` | Lowercase 32-byte SHA-256 hex of the complete envelope-free PNG, including its signature and chunk framing |
| `credential` | Exact existing `keyset_id u v h s` credential object, including the private owner scalar `s` |

There is no URL, title, wallet signature, status receipt or pending-operation material in this format. Duplicate/extra keys, alternate JSON representations, BOM and invalid UTF-8 reject. The image bytes already live in the PNG; the payload does not repeat their hex. Import reconstructs the existing local bearer envelope with `asset = hex(image)` and calls the existing credential verifier.

Two checks serve different purposes: `image_sha256` detects an inconsistent full digest, while the PS verifier recomputes the scoped asset attribute and checks the signed credential. Merely substituting another valid PNG and recomputing the full digest cannot make its old credential valid. The caller supplies the trusted manifest; the file cannot choose a new issuer, key or network endpoint. CRC is a container integrity check, not cryptographic authorization.

## Operations and public copies

| API | Behavior |
| --- | --- |
| `prepareImageIssue(client, session, image)` | Validate the bounded image and reserve chunk space for its future envelope before writing the pending operation |
| `exportImage(envelope, manifest)` | Verify a local bearer envelope, extract its image, and return a new PNG containing the versioned payload |
| `importImage(file, manifest)` | Validate container, digest, pinned identity and credential; return independent image bytes, local bearer envelope, dimensions and digest |
| `prepareImageClaim(client, session, file)` | Fully verify the image file before calling the existing client claim preparation |
| `publicImage(file, manifest)` | Fully verify, then return only the underlying IHDR/IDAT/IEND image bytes |

Import is offline. It does not assert that the credential is unspent, reserve ownership or contact an issuer. Old files can still be structurally and cryptographically valid after a spend; authoritative claim/cancel submission rejects the consumed nullifier. Backup acknowledgment, exact request replay and atomic replacement persistence continue to use the existing client/issuer machinery. Recovery remains a separate private snapshot with the image and complete pending material. Exporting a bearer PNG is not a substitute for saving an unresolved claim's snapshot.

The original input is never overwritten. `publicImage` emits no credential envelope, keyset, secret, capability or recovery metadata; its return value is just the original image bytes. It does not erase steganographic information intentionally encoded in pixels or compression choices, nor remove visible private content from artwork. Unknown metadata is rejected rather than silently published. Callers must keep private bearer files and returned bearer envelopes out of uploads, logs, caches and public proofs.

## Evidence and remaining work

The 25 new image tests cover exact fixture bytes, shifted input buffers, full lifecycle/recovery/cancel, two prepared claims from copies, unchanged stores on invalid input, image substitution despite a recomputed digest, trust/credential mutations, payload ambiguity, v1/mixed formats, CRC/truncation, bounded inflation and reserved envelope capacity. At PR #18 the combined local suite had **126 tests**, **28 mutation controls** and **21 actual process-kill locations**; later totals are tracked in the [vault evidence](PS-LOCAL-VAULT.md#run-and-evidence). The image-copy competition test prepares both requests before submitting sequentially; existing engine tests supply multiprocess race evidence.

Seven new temporary controls remove CRC, deflate-consumption, PS asset-binding or full-digest checks, return the private PNG from the public-copy API, select one duplicate envelope, or omit the pre-issuance chunk reserve. Each fails its named regression. The chunk-limit regression failed on the initial local adapter and passes with the correction; it prevents minting a 128-chunk image that would exceed the file limit after adding its envelope.

With root dependencies installed, `pnpm exec tsx research/ps-lab/check-image-codec.ts` reproduces the three normalized fixtures exactly, verifies decoded pixel values through fast-png, checks display of a container carrying the new chunk, rejects that container from v1 import/normalization/public upload, and checks a real v1 roundtrip. That root compatibility check uses a placeholder payload to isolate decoder behavior; the separate image suite verifies real PS payloads. CI runs both. `--write` explicitly regenerates only these new image fixtures; default execution compares committed bytes.

C5 has an offline file prototype, not a public integration. Independent C1/C4 review, custody approval, browser/phone recovery, production vault integration, wallet endorsement, authenticated public proofs, production trust/key lifecycle, normalized-input policy and hosted resource/retention qualification remain open. Earlier frozen reference artifacts, PS equations/transcripts/stores, v1 runtime and deployed resources remain unchanged.
