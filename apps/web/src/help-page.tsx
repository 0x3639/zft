import React, { useEffect, useRef } from "react";
import { helpPage } from "../../../packages/protocol/help";
import { CANONICALIZER, RPC_URL } from "../../../packages/protocol";
import manifest from "../../../packages/protocol/deployment.json";
import { CopyPublic } from "./public-copy";

const button = "nom-btn nom-btn--outline nom-btn--default";
export function HelpPage({
  path,
  nav,
}: {
  path: string;
  nav: (path: string) => void;
}) {
  const page = helpPage(new URL(path, location.origin))!;
  const technical = page.view === "cryptography";
  const tabs = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${page.title} · ZFT`;
    const anchor = location.hash.slice(1);
    if (["files", "recovery", "verification", "trust"].includes(anchor))
      document.getElementById(anchor)?.scrollIntoView();
    else window.scrollTo(0, 0);
    return () => {
      // Direct loads already have the help title from the Worker HTML.
      document.title = "ZFT · The collectible is the file";
    };
  }, [page.view]);
  function link(to: string, text: string, primary = false) {
    return (
      <a
        href={to}
        className={
          primary ? "nom-btn nom-btn--primary nom-btn--default" : button
        }
        onClick={(e) => {
          if (
            !e.metaKey &&
            !e.ctrlKey &&
            !e.shiftKey &&
            !e.altKey &&
            e.button === 0
          ) {
            e.preventDefault();
            nav(to);
            if (to.startsWith("/how-it-works"))
              heading.current?.focus({ preventScroll: true });
          }
        }}
      >
        {text}
      </a>
    );
  }
  return (
    <div className="help-page">
      <section className="help-hero">
        <p className="text-ledger">A field guide to ZFT</p>
        <h1 ref={heading} tabIndex={-1}>
          {page.title}
        </h1>
        <p className="help-intro">
          {technical
            ? "The public record says who owns it. The key lets them pass it on."
            : "Start with a picture in your wallet. Make a file when you want to pass it on."}
        </p>
        <div
          ref={tabs}
          className="segment-control help-tabs"
          role="tablist"
          aria-label="Help views"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const next =
              e.key === "Home" ? 0 : e.key === "End" ? 1 : technical ? 0 : 1;
            nav(next ? "/how-it-works?view=cryptography" : "/how-it-works");
            tabs.current
              ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
              [next]?.focus();
          }}
        >
          {(["basics", "cryptography"] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              id={`help-${view}-tab`}
              aria-controls={`help-${view}`}
              aria-selected={page.view === view}
              tabIndex={page.view === view ? 0 : -1}
              onClick={() =>
                nav(
                  view === "basics"
                    ? "/how-it-works"
                    : "/how-it-works?view=cryptography",
                )
              }
            >
              {view === "basics" ? "Basics" : "Technical"}
            </button>
          ))}
        </div>
      </section>
      <section
        id={`help-${page.view}`}
        role="tabpanel"
        aria-labelledby={`help-${page.view}-tab`}
        tabIndex={0}
      >
        {technical ? (
          <>
            <div className="help-grid">
              <article className="panel">
                <p className="text-ledger">01 / The picture</p>
                <h2>One image, one token.</h2>
                <p>
                  JPG and supported PNG inputs become a canonical RGBA PNG
                  locally using <code>{CANONICALIZER}</code>. The SHA-256 digest
                  of those PNG bytes is the token ID, interpreted as an unsigned
                  integer. Re-minting the same canonical bytes is rejected.
                </p>
                <p>
                  Metadata has its own SHA-256 digest over canonical JSON. The
                  contract records that digest and the creator; changing a
                  downloaded title or image does not change the on-chain record.
                </p>
              </article>
              <article className="panel">
                <p className="text-ledger">02 / The authority</p>
                <h2>A signature moves ownership.</h2>
                <p>
                  The ERC-721 owner is either your wallet or an independent
                  secp256k1 file key. A transferable PNG carries that key and
                  its ownership epoch in a <code>zfTA</code> chunk. It is a
                  bearer credential, not an encrypted preview.
                </p>
                <p>
                  EIP-712 authorizations bind the chain ID, contract, action,
                  recipient, nonce and deadline. Minting uses the creator’s
                  nonce; a claim or cancellation uses the current ownership
                  nonce. Every post-mint ERC-721 transfer advances that nonce.
                </p>
              </article>
            </div>
            <article className="panel help-section" id="verification">
              <p className="text-ledger">03 / Verify for yourself</p>
              <h2>A proof is a snapshot.</h2>
              <ol className="help-list">
                <li>
                  Open an artwork’s details and download{" "}
                  <strong>Public proof</strong> and <strong>Save image</strong>.
                  These downloads contain public evidence, never the
                  transferable key.
                </li>
                <li>
                  Hash the canonical public PNG and metadata, then compare their
                  digests with the proof and the contract’s token ID and{" "}
                  <code>metadataHashOf</code>.
                </li>
                <li>
                  Check <code>ownerOf</code> and <code>ownershipNonce</code>{" "}
                  against an independent RPC at a known block. A historical
                  proof can be valid while its owner or epoch is no longer
                  current.
                </li>
                <li>
                  For a published file holding, verify the owner’s
                  signed-message statement binding the profile, deployment,
                  token, epoch and expiry. A valid signature alone does not
                  establish present ownership.
                </li>
              </ol>
              <div className="help-network">
                <div>
                  <span className="text-ledger">Deployment</span>
                  <p>ZVM devnet · chain {manifest.chainId}</p>
                  <code className="wrap">{manifest.contract}</code>
                </div>
                <CopyPublic value={manifest.contract} label="Contract address">
                  Copy contract
                </CopyPublic>
              </div>
              <details>
                <summary>Network and source details</summary>
                <dl className="help-details">
                  <dt>RPC</dt>
                  <dd>{RPC_URL}</dd>
                  <dt>Canonicalizer</dt>
                  <dd>{CANONICALIZER}</dd>
                  <dt>Signature domain</dt>
                  <dd>ZFT / version 1 / chain ID / verifying contract</dd>
                </dl>
                <p>
                  Compare the chain ID, genesis block, contract and runtime code
                  hash with the deployment manifest before trusting a different
                  endpoint. The app stops writes when its deployment checks
                  disagree.
                </p>
                <div className="actions">
                  <a
                    href="https://devnet.zenon.foo/explorer/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    ZVM explorer ↗
                  </a>
                  <a
                    href="https://github.com/0x3639/zft/blob/main/packages/protocol/deployment.json"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Deployment manifest ↗
                  </a>
                  <a
                    href="https://github.com/0x3639/zft/blob/main/contracts/src/ZFT.sol"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Contract source ↗
                  </a>
                </div>
              </details>
            </article>
            <div className="help-grid">
              <article className="panel" id="recovery">
                <p className="text-ledger">04 / Local custody</p>
                <h2>Your browser is not a backup.</h2>
                <p>
                  Session file keys stay in memory. Optional remembered storage
                  encrypts records with AES-256-GCM; PBKDF2-SHA-256 with a
                  random salt and 600,000 iterations protects the vault root.
                  Protected storage locks after 15 minutes of inactivity.
                </p>
                <p>
                  The recovery download is a secret, unencrypted snapshot, even
                  when browser storage has a password. Save a new snapshot when
                  keys change. It cannot recover keys created after it was
                  saved, reverse a transfer, or restore a reset devnet.
                </p>
                {link("/recovery", "Open recovery")}
              </article>
              <article className="panel" id="trust">
                <p className="text-ledger">05 / Trust and availability</p>
                <h2>Public history. Explicit dependencies.</h2>
                <p>
                  Cloudflare serves the app, public images, profile data and the
                  chain index. The sponsor pays devnet gas and submits signed
                  actions; it can limit or stop submissions. Neither the sponsor
                  nor a profile signature restores missing file keys.
                </p>
                <p>
                  You trust the delivered app code with unlocked file keys. A
                  browser password protects saved storage, not a compromised
                  page or device. Wallet identity and file ownership are
                  separate; the app never asks for your MetaMask private key.
                </p>
                <p>
                  Ownership changes are public on ZVM. The app waits for six
                  subsequent EVM blocks; that is an app confirmation policy, not
                  a promise against reorgs or devnet resets. An index or sharing
                  image may lag behind the chain.
                </p>
              </article>
            </div>
          </>
        ) : (
          <>
            <div className="help-grid help-steps">
              <article className="panel">
                <p className="text-ledger">01 / Make it yours</p>
                <h2>Mint a picture.</h2>
                <p>
                  Connect MetaMask on ZVM devnet, choose a JPG or PNG, and mint
                  into your wallet. Your wallet address is your public identity.
                  The sponsor submits your signed authorization and covers
                  devnet gas when available.
                </p>
                {link("/mint", "Mint a picture", true)}
              </article>
              <article className="panel">
                <p className="text-ledger">02 / Pass it on</p>
                <h2>Send the original file.</h2>
                <p>
                  From your wallet, choose{" "}
                  <strong>Make transferable file</strong>. Save the recovery
                  snapshot before moving ownership to the new file key. Download
                  the PNG and send it as an original attachment.
                </p>
                {link("/wallet", "Open my collection")}
              </article>
              <article className="panel">
                <p className="text-ledger">03 / Make it current</p>
                <h2>Claim what you receive.</h2>
                <p>
                  Import the file and claim it into your wallet or a fresh file
                  key. Claiming changes ownership on-chain, so earlier copies
                  can no longer move the item. Wait for confirmation before
                  treating it as yours.
                </p>
                {link("/claim", "Receive a file")}
              </article>
            </div>
            <article className="panel help-section" id="files">
              <p className="text-ledger">Same picture. Different powers.</p>
              <h2>A preview is for showing. A file is for sending.</h2>
              <div className="help-grid">
                <div>
                  <h3>Public image or proof</h3>
                  <p>
                    Safe to share. Save image, Public proof, profile links and
                    social previews contain no transfer key. A screenshot or
                    recompressed image cannot claim the collectible.
                  </p>
                </div>
                <div>
                  <h3>Transferable PNG</h3>
                  <p>
                    Anyone with a current copy can race to claim it. Send the
                    original <code>.zft.png</code> attachment to the intended
                    recipient. Copying it does not create a second collectible.
                  </p>
                </div>
              </div>
            </article>
            <div className="help-grid">
              <article className="panel">
                <p className="text-ledger">The first valid claim wins</p>
                <h2>Sending is not confirmation.</h2>
                <p>
                  The sender keeps authority until an ownership change confirms.{" "}
                  <strong>Cancel old copies</strong> rotates to another file key
                  and races with the recipient’s claim. Cancellation cannot take
                  back an item that someone else has already claimed.
                </p>
                <p>
                  Check the live status before retrying an interrupted action.
                  Keep recovery snapshots containing both old and new keys until
                  the outcome is clear.
                </p>
              </article>
              <article className="panel" id="recovery">
                <p className="text-ledger">Keep the keys you need</p>
                <h2>Save recovery as you go.</h2>
                <p>
                  File keys stay in this session unless you choose
                  password-protected browser storage. Reloading a session or
                  clearing the browser can remove them. Your MetaMask recovery
                  phrase does not restore independent file keys.
                </p>
                <p>
                  A downloaded recovery file is a secret snapshot. The browser
                  password does not encrypt it. Store it privately and save a
                  fresh copy whenever the app asks.
                </p>
                {link("/recovery", "Save or restore recovery")}
              </article>
            </div>
            <section
              className="help-faq help-section"
              aria-label="Common questions"
            >
              <h2>Before you pass it on.</h2>
              <details>
                <summary>Does every file appear on my profile?</summary>
                <p>
                  Your wallet address identifies your profile. File custody
                  stays separate: publish a holding from My files to link it
                  with a signed public proof. Removing the link does not erase
                  mint provenance or chain history. Social platforms may retain
                  old preview images.
                </p>
                {link("/collection", "Open my files")}
              </details>
              <details>
                <summary>Why is an action waiting or unavailable?</summary>
                <p>
                  The sponsor has usage limits and can be offline. The chain
                  index can lag, and a network request can fail after a
                  transaction was submitted. Use the action’s status and retry
                  controls; do not discard its recovery keys while the outcome
                  is unclear.
                </p>
              </details>
              <details>
                <summary>What can change on devnet?</summary>
                <p>
                  This alpha uses real test-chain transactions. Devnet can
                  reset, and the app’s six-block confirmation policy does not
                  rule out reorganizations. Sales, encrypted claim links and
                  cloud recovery are not available in this alpha.
                </p>
              </details>
            </section>
          </>
        )}
        <div className="help-bottom panel">
          <div>
            <p className="text-ledger">
              {technical ? "Back to the picture" : "Curious about the proof?"}
            </p>
            <h2>
              {technical ? "Ready to try it?" : "See what makes it verifiable."}
            </h2>
          </div>
          <div className="actions">
            {link(
              technical ? "/how-it-works" : "/how-it-works?view=cryptography",
              technical ? "Read the basics" : "Read the technical guide",
            )}
            {link("/explore", "Explore collectibles")}
          </div>
        </div>
      </section>
    </div>
  );
}
