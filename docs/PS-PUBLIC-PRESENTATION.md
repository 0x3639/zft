# Local PS public presentation

The second release increment adds opt-in public artwork evidence to the [local product interface](PS-PRODUCT-INTERFACE.md). It uses `zft-ps-presentation-lab-v1`, alongside unchanged credential, file/vault and signed-observation profiles. This is an original, same-author composition awaiting [independent review](PS-REVIEW-PACKET.md). No hosted issuer, wallet login session, NFT wrapper or MetaMask inventory integration is supplied.

## Claims and trust

A report separates three claims:

- **Credential proof:** the showing verifies against the caller-pinned complete PS manifest, asset attribute and full observation context. Public PNG bytes match both their full SHA-256 and the signed asset binding.
- **Optional wallet signing key:** a strict low-S 65-byte [ERC-191](https://eips.ethereum.org/EIPS/eip-191) personal signature endorses this exact public presentation. The message includes protocol, origin, chain, address, realm, image digest, challenge, expiry and a hash of all unsigned evidence. UTF-8 byte length is used. This proves control of a signing key; no contract-wallet code/state lookup or [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) verification occurs. `contractWalletChecked` remains false. This is not a [SIWE](https://eips.ethereum.org/EIPS/eip-4361) login session.
- **Issuer report:** a separately pinned Ed25519 key signs the exact request/showing, nullifier, sequence, timestamps and spent/unspent snapshot. Publication requires the original 60-second interval. Later viewing labels expired evidence historical. Even a still-in-interval unspent report can precede a subsequent spend; it is not a reservation or guaranteed current ownership.

The audience hashes the canonical origin and chain ID. Anonymous evidence uses an all-zero wallet context and chain zero. Wallet-endorsed evidence requires a nonzero chain ID bounded to uint32. There is no RPC dependency, automatic wallet connection, chain switch, `eth_getCode` call or credential transfer from signing. Account/chain/disconnect changes invalidate the selection; account and chain are checked before and after signing.

Imported records cannot select keys or an issuer URL. The running origin supplies the complete trust manifests, and both private and public Workers compare the origin with their own. This is bootstrap trust in that origin, not independent key distribution. Public viewers have no durable global sequence floor; rollback, equivocation, compromised issuer, replaced origin trust and manipulated clocks remain outside the guarantee.

## Wire and publication boundary

Canonical UTF-8 JSON has exactly `format`, `origin`, `chain_id`, `context`, `showing`, `receipt`, `image`, `image_sha256` and `wallet_signature`, bounded to 150000 bytes. `context` is the existing signed-observation schema; showing and receipt are canonical wire strings; image is the public normalized PNG in hex. The record contains no credential owner secret, bearer wire, recovery snapshot or vault password. It does expose the artwork, showing/nullifier, issuer scope, status and any signing address. It provides no public unlinkability promise.

The credential Worker prepares and verifies the showing and receipt. The page receives only the report and exact endorsement text until explicit publication; optional wallet signing happens only after consent. The Worker verifies the final signature and proof again before posting. Lock drops its in-memory draft and invalidates asynchronous completion. The issuer service requires an exact observation it previously admitted, verifies the complete presentation, and returns its SHA-256 content ID.

`POST /presentation` shares the lab's exact Host/Origin and launch-capability checks, no CORS, bounded canonical JSON, fixed actions and body-reader/connection limits. The presentation body limit is 166384 bytes. Per-run caps are 64 observation requests and 64 public records. Rows/maps are not pruned and the service is disposable. Publication does not make the loopback server accessible remotely; synchronous cryptography and decoder costs are not production DoS qualification.

Public routes require no capability:

| Route | Content |
| --- | --- |
| `/ps/trust.json` | Current origin and complete public trust manifests |
| `/ps/proof/:sha256` | Public React verification page with bounded initial sharing metadata |
| `/ps/evidence/:sha256` | Exact canonical evidence and publication time |
| `/ps/art/:sha256.png` | Exact verified public artwork bytes |

IDs are lowercase 64-digit hex; unknown IDs, arbitrary suffixes and queries reject. Initial HTML metadata uses fixed labels, the validated ID and local origin. The public page checks the content hash, uses a separate stateless Worker, and displays only verified public PNG bytes. Its fetch and verification are bounded and cancellation prevents late completion after unmount/timeout. No bearer unlock or wallet is needed to view. A normalizer or sharing platform may further transform a downloaded public copy; this implementation does not claim steganographic erasure.

## Evidence and remaining work

[Current evidence](../research/ps-presentation-validation.json) records 230 local tests (12 new), 63 lab mutation controls (five new), 241 app tests (six new) and the three existing app bridge controls. New cases isolate receipt signatures from wallet signatures, cross-asset substitution with a fresh wallet signature, caller pins, malformed schemas, expiry, historical status after spend, HTTP admission/public bytes and generated Worker publication through actual loopback HTTP. viem-produced ERC-191 signatures cross-check the noble verifier. Both implementations and composition share an author.

Node Worker tests use mock persistence and an explicit strict test PNG decoder; they do not establish native browser or IndexedDB acceptance. The real Codex desktop browser separately verified a script-created anonymous public record using native PNG decoding, rendered its 2×2 artwork, and showed the report at 1280px and 390px without horizontal overflow or observed console warnings/errors. The fixture was minted and published through the actual local API by a test script, not through the publish UI.

A file-picker automation call stalled for roughly 6.3 hours despite short requested timeouts, interrupting the complete publish UI attempt and causing normal idle lock. No lock/expiry rule was relaxed. Real wallet extension signing, the complete consent/sign/publish UI, other browsers/phones, sharing-platform previews and lifecycle/storage failures remain acceptance work. Public records and the status key are lost on server restart; persistence is the next engineering increment. User profile management, discovery/curation and durable public history are not implemented here. PS-OWN-01 and independent C1/C4 review stay open before real assets or hosting.
