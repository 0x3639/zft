import React, { useEffect, useState } from "react";
import { type Deployment } from "../../../packages/protocol";
import { type WalletSession, isZVMChain } from "./wallet";
import { type WalletJournal, type WalletDraft } from "./wallet-journal";
import { reconcileWallet, submitWallet } from "./wallet-direct";
const btn = "nom-btn nom-btn--outline nom-btn--default";

export function WalletPending({
  journal,
  session,
  deployment,
  nav,
  onBusy,
  disabled,
}: {
  journal: WalletJournal;
  session: WalletSession;
  deployment: Deployment;
  nav: (path: string) => void;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [records, setRecords] = useState<WalletDraft[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      running = false;
    const refresh = async () => {
      if (running || busy) return;
      running = true;
      try {
        const saved = await journal.list(session.account);
        for (let i = 0; i < saved.length; i++)
          if (
            saved[i].operationId &&
            !["confirmed", "failed"].includes(saved[i].job?.state ?? "")
          )
            saved[i] = await reconcileWallet(journal, saved[i]);
        if (active) {
          setRecords(saved);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [journal, session, busy]);
  if (!records.length && !error) return null;
  return (
    <section className="wallet-pending">
      <h2>Wallet mint and receive requests</h2>
      <p>
        Requests survive reload. Your wallet holds the collectible; no local
        recovery key is needed.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="collection-grid">
        {records.map((record) => (
          <article className="panel" key={record.tokenId}>
            <h3>{record.metadata.name}</h3>
            <p>
              {record.kind === "mint" ? "Mint to wallet" : "Receive in wallet"}{" "}
              ·{" "}
              {record.job?.state ??
                (record.operation
                  ? "Ready to submit"
                  : "Awaiting authorization")}
            </p>
            {record.job && (
              <a
                href={`https://devnet.zenon.foo/explorer/tx/${record.job.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
            )}
            {record.job?.state !== "confirmed" && (
              <div className="actions">
                <button
                  className={btn}
                  disabled={busy || disabled || !isZVMChain(session.chainId)}
                  onClick={async () => {
                    setBusy(true);
                    onBusy(true);
                    setError("");
                    try {
                      await submitWallet(journal, deployment, session, record);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                      onBusy(false);
                    }
                  }}
                >
                  Resume or check request
                </button>
                {record.kind === "claim" && (
                  <button className={btn} onClick={() => nav("/claim")}>
                    Reopen original file
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
