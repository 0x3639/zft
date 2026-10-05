import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { download } from "./flows";
import manifest from "../../../packages/protocol/deployment.json";
import {
  verifyPublicEvidence,
  type Evidence,
  type CheckState,
} from "../../../packages/protocol/public-proof";
import { MAX_IMAGE } from "../../../packages/file-codec";

const btn = "nom-btn nom-btn--outline nom-btn--default";
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-6)}`;
export function PublicDetail({
  id,
  context,
  epoch,
  onError,
  nav,
}: {
  id: string;
  context?: string;
  epoch?: string;
  onError: (s: string) => void;
  nav: (s: string) => void;
}) {
  const [item, setItem] = useState<Evidence>(),
    [checks, setChecks] =
      useState<Awaited<ReturnType<typeof verifyPublicEvidence>>>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [flipped, setFlipped] = useState(false),
    [notice, setNotice] = useState("");
  const generation = useRef(0);
  async function refresh() {
    const run = ++generation.current;
    setBusy(true);
    setChecks(undefined);
    setError("");
    try {
      const query = new URLSearchParams();
      if (context) query.set("profile", context);
      if (epoch !== undefined) query.set("epoch", epoch);
      const data = await api<Evidence>(`/api/items/${id}?${query}`);
      if (run !== generation.current) return;
      setItem(data);
      let image: Uint8Array | undefined;
      try {
        const res = await fetch(`/art/${data.metadata.imageHash.slice(2)}.png`);
        if (!res.ok || Number(res.headers.get("content-length")) > MAX_IMAGE)
          throw new Error("Image unavailable");
        const reader = res.body!.getReader(),
          parts: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const r = await reader.read();
            if (r.done) break;
            size += r.value.length;
            if (size > MAX_IMAGE) throw new Error("Image limit");
            parts.push(r.value);
          }
        } finally {
          await reader.cancel();
        }
        image = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          image.set(part, offset);
          offset += part.length;
        }
      } catch {
        /* Preserve separately verifiable signatures and chain observations. */
      }
      const verified = await verifyPublicEvidence(
        data,
        image,
        Date.now(),
        context,
      );
      if (run === generation.current) setChecks(verified);
    } catch (e) {
      if (run === generation.current) setError((e as Error).message);
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setItem(undefined);
    setFlipped(false);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [id, context, epoch]);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied`);
    } catch {
      onError(
        "Clipboard unavailable. Select and copy the full value from the proof details.",
      );
    }
  }
  if (!item)
    return (
      <section className="empty-state">
        <h2>{error || "Reading the public proof…"}</h2>
        {error && (
          <button className={btn} onClick={refresh}>
            Retry
          </button>
        )}
      </section>
    );
  const p = item.publication;
  const historical = checks?.current === "historical";
  const status = busy
    ? "Checking…"
    : historical
      ? "Ownership changed"
      : checks?.current === "pass" && checks.integrity === "pass"
        ? "Verified holding"
        : checks?.binding === "expired"
          ? "Proof expired"
          : checks?.integrity === "fail" || checks?.binding === "fail"
            ? "Verification failed"
            : !item.chainVerified
              ? "Ownership unavailable"
              : p
                ? "Check incomplete"
                : "Public artwork";
  function row(state: CheckState | undefined, title: string, note: string) {
    return (
      <div className={`verification-row check-${state ?? "unknown"}`}>
        <span aria-hidden="true">
          {state === "pass"
            ? "✓"
            : state === "fail" || state === "historical"
              ? "×"
              : "·"}
        </span>
        <div>
          <strong>{title}</strong>
          <p>{note}</p>
        </div>
      </div>
    );
  }
  const proof = () =>
    download(
      JSON.stringify(
        {
          format: "zft-public-observation",
          version: 2,
          deployment: manifest,
          tokenId: item.tokenId,
          metadata: item.metadata,
          metadataHash: item.metadataHash,
          publication: p ?? null,
          profileEndorsement: null,
          observed: item.chainVerified
            ? {
                owner: item.owner,
                ownershipNonce: item.nonce,
                block: item.blockNumber,
                blockHash: item.blockHash,
                at: item.observedAt,
              }
            : null,
          checks,
          note: "Public evidence only. Verify image/metadata SHA-256, the item-owner possession signature and expiry, then re-query ownerOf and ownershipNonce on the pinned deployment. No portable profile-key endorsement is included. Historical signatures do not prove current ownership.",
        },
        null,
        2,
      ),
      `zft-proof-${id.slice(0, 12)}.json`,
      "application/json",
    );
  return (
    <section className="flow-grid public-detail">
      <div className="collectible-column">
        <div className={`collectible-card ${flipped ? "is-flipped" : ""}`}>
          {!flipped ? (
            <>
              <img
                className="collectible-image"
                src={`/art/${item.metadata.imageHash.slice(2)}.png`}
                alt={item.metadata.name}
              />
              <h2>{item.metadata.name}</h2>
              <div className="card-bottom">
                <span className="mono">{short(item.metadata.imageHash)}</span>
                <span className="state-badge">{status}</span>
              </div>
            </>
          ) : (
            <div className="card-proof-face">
              <p className="text-ledger">Public ownership evidence</p>
              <h2>{item.metadata.name}</h2>
              <dl>
                <dt>Asset SHA-256</dt>
                <dd>{item.metadata.imageHash}</dd>
                <dt>Metadata SHA-256</dt>
                <dd>{item.metadataHash}</dd>
                <dt>Token</dt>
                <dd>{item.tokenId}</dd>
                <dt>Chain / contract</dt>
                <dd>
                  {manifest.chainId} / {manifest.contract}
                </dd>
                <dt>Published epoch</dt>
                <dd>{p?.nonce ?? "No profile holding published"}</dd>
                <dt>Observed owner / epoch</dt>
                <dd>
                  {item.chainVerified
                    ? `${item.owner} / ${item.nonce}`
                    : "Unavailable"}
                </dd>
                {p && (
                  <>
                    <dt>Public item-owner signature</dt>
                    <dd>{p.signature}</dd>
                    <dt>Statement expires</dt>
                    <dd>{new Date(p.expires * 1000).toLocaleString()}</dd>
                  </>
                )}
              </dl>
              <p>No transfer key is included.</p>
            </div>
          )}
        </div>
        <button
          className={`${btn} flip-button`}
          aria-pressed={flipped}
          onClick={() => setFlipped(!flipped)}
        >
          {flipped ? "↶ Show front" : "↶ Flip card"}
        </button>
      </div>
      <div className="proof-panel">
        <span className="state-badge" role="status">
          {status}
        </span>
        <h1>{item.metadata.name}</h1>
        <p>
          {historical
            ? "This published ownership epoch has ended. A key rotation may be a transfer or a cancellation."
            : p
              ? `Published ${new Date(p.publishedAt).toLocaleDateString()}. Verification describes the recorded epoch.`
              : "Mint provenance is public. No collector ownership statement is attached to this view."}
        </p>
        <div className="verification-list" aria-live="polite">
          {row(
            checks?.integrity,
            "Artwork and metadata integrity",
            busy
              ? "Checking hashes…"
              : checks?.integrity === "pass"
                ? "Image and metadata match their recorded digests."
                : checks?.integrity === "fail"
                  ? "The content does not match its recorded identity."
                  : "Image integrity could not be checked.",
          )}
          {row(
            checks?.binding,
            "Owner-authorized profile binding",
            !p
              ? "No public possession statement in this context."
              : checks?.binding === "pass"
                ? "The item-owner signature binds this profile and ownership epoch."
                : checks?.binding === "expired"
                  ? "The signature is authentic, but its statement has expired."
                  : busy
                    ? "Checking signature…"
                    : "The possession signature could not be validated.",
          )}
          {row(
            checks?.current,
            historical
              ? "No longer held under this epoch"
              : "Current ownership",
            !item.chainVerified
              ? "The live chain could not be checked. Try again."
              : historical
                ? "The chain records a different owner or ownership epoch."
                : checks?.current === "pass"
                  ? `Matches the contract at block ${item.blockNumber}.`
                  : !p
                    ? `Observed at block ${item.blockNumber}; no collector binding claimed.`
                    : "A current, unexpired profile holding has not been established.",
          )}
        </div>
        <div className="proof-identities">
          <div>
            <label>Asset hash</label>
            <button
              className="copy-pill mono"
              title={item.metadata.imageHash}
              onClick={() => copy(item.metadata.imageHash, "Asset hash")}
            >
              {short(item.metadata.imageHash)} ⧉
            </button>
          </div>
          <div>
            <label>{context ? "Collector profile" : "Creator"}</label>
            <button
              className="copy-pill mono"
              title={context ?? item.metadata.creator}
              onClick={() =>
                copy(context ?? item.metadata.creator, "Public identity")
              }
            >
              {short(context ?? item.metadata.creator)} ⧉
            </button>
          </div>
        </div>
        <div className="actions">
          <a
            className={btn}
            href={`/art/${item.metadata.imageHash.slice(2)}.png`}
            download
          >
            ↓ Save image
          </a>
          <button className={btn} onClick={proof} disabled={busy}>
            Public proof
          </button>
          <button
            className={btn}
            onClick={() =>
              copy(
                `${location.origin}${context ? `/p/${context}?nft=${id}${epoch === undefined ? "" : `&epoch=${epoch}`}` : `/item/${id}`}`,
                "Artwork link",
              )
            }
          >
            Share
          </button>
        </div>
        <p className="public-note">
          Saved images and public proofs contain no transfer key.
        </p>
        <p role="status">{notice}</p>
        <button className={btn} disabled={busy} onClick={refresh}>
          {busy ? "Checking…" : "Re-verify ownership"}
        </button>
        <a
          className="proof-creator"
          href={`/p/${item.metadata.creator}`}
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              nav(`/p/${item.metadata.creator}`);
            }
          }}
        >
          View creator →
        </a>
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
