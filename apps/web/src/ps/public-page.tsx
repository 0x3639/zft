import React, { useEffect, useState } from "react";
import { BrandLogo } from "../brand-logo";
import { ThemeControl } from "../site-controls";
import { EvidenceReport } from "./presentation-controls";
import type { PresentationReport } from "./bridge";
import "./style.css";
async function read(path: string, limit: number, signal: AbortSignal) {
  const r = await fetch(path, {
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!r.ok || !r.body) throw new Error("Public evidence is unavailable.");
  const reader = r.body.getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("Public evidence exceeds its limit.");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const b = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    b.set(p, offset);
    offset += p.length;
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b),
  );
}
export default function PublicPsPage() {
  const [error, setError] = useState(""),
    [value, setValue] = useState<{
      report: PresentationReport;
      image: string;
      wallet: string;
      chainId: number;
    }>(),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true,
      finished = false,
      worker: Worker | undefined,
      url: string | undefined;
    const abort = new AbortController(),
      timeout = setTimeout(() => {
        finished = true;
        abort.abort();
        worker?.terminate();
        if (live) setError("Verification timed out. Reload to try again.");
      }, 90000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    void (async () => {
      const id = /^\/ps\/proof\/([0-9a-f]{64})$/.exec(location.pathname)?.[1];
      if (!id) throw new Error("Invalid public evidence link.");
      const [pins, record] = await Promise.all([
        read("/ps/trust.json", 4096, abort.signal),
        read("/ps/evidence/" + id, 166384, abort.signal),
      ]);
      if (!live || finished) return;
      if (pins.origin !== location.origin || typeof record.wire !== "string")
        throw new Error("Unexpected issuer trust.");
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(record.wire),
          ),
        ),
        (v) => v.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== id) throw new Error("Public content hash mismatch.");
      if (!live || finished) return;
      worker = new Worker("/web/public-worker.mjs", { type: "module" });
      worker.onerror = () => {
        if (!live || finished) return;
        finished = true;
        if (live) setError("Public verification failed.");
        clearTimeout(timeout);
        worker?.terminate();
      };
      worker.onmessage = ({ data }) => {
        clearTimeout(timeout);
        worker?.terminate();
        if (!live || finished) return;
        finished = true;
        if (!data.ok) {
          setError("Public verification failed.");
          return;
        }
        url = URL.createObjectURL(
          new Blob([data.image], { type: "image/png" }),
        );
        setValue({
          report: data.report,
          image: url,
          wallet: data.wallet,
          chainId: data.chainId,
        });
      };
      worker.postMessage({ wire: record.wire, pins });
    })().catch((e) => {
      clearTimeout(timeout);
      if (live && !finished)
        setError(
          e instanceof Error ? e.message : "Public verification failed.",
        );
    });
    return () => {
      live = false;
      abort.abort();
      worker?.terminate();
      clearTimeout(timeout);
      clearInterval(tick);
      if (url) URL.revokeObjectURL(url);
    };
  }, []);
  return (
    <div className="ps-app">
      <header className="ps-header">
        <a className="wordmark" href="/ps/">
          <BrandLogo />
        </a>
        <span className="ps-tag">PUBLIC PS EVIDENCE</span>
        <div className="ps-spacer" />
        <ThemeControl />
      </header>
      <main className="ps-main">
        <aside className="ps-warning">
          Local research issuer with public test keys. The public link contains
          artwork and evidence, never a bearer file. Independent cryptographic
          review is pending.
        </aside>
        <h1>Public artwork evidence</h1>
        <p>
          This origin supplies the trusted issuer keys. Independently pin the
          issuer to verify outside this local preview.
        </p>
        {error ? (
          <p role="alert">{error}</p>
        ) : !value ? (
          <p role="status">
            Verifying image, credential proof and issuer receipt…
          </p>
        ) : (
          <section className="ps-detail">
            <div className="ps-artwork">
              <img src={value.image} alt="Verified public artwork" />
            </div>
            <div className="ps-panel">
              <EvidenceReport
                report={value.report}
                now={Math.floor(now / 1000)}
              />
              <p className="ps-hash">
                Artwork SHA-256: {value.report.imageSha256}
              </p>
              {value.report.walletSigningKeyValid && (
                <p className="ps-hash">
                  Signing address: 0x{value.wallet} · chain {value.chainId}
                </p>
              )}
              <a
                href={value.image}
                download={
                  "ps-public-" + value.report.imageSha256.slice(0, 16) + ".png"
                }
              >
                Download public artwork
              </a>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
