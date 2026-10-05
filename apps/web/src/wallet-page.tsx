import React, { useEffect, useRef, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import { type Deployment } from "../../../packages/protocol";
import { type Vault, type ItemRecord } from "../../../packages/vault";
import { type WalletSession, isZVMChain } from "./wallet";
import { api } from "./api";
import { type PublicItem, short } from "./public-pages";
import { Modal } from "./site-controls";
import * as walletFlows from "./wallet-flows";
import { reconcile, submit } from "./flows";
const btn = "nom-btn nom-btn--outline nom-btn--default";
export function WalletPage({
  session,
  vault,
  deployment,
  items,
  nav,
  onRefresh,
  onBusy,
  appBusy,
  sponsor,
}: {
  session?: WalletSession;
  vault?: Vault;
  deployment: Deployment;
  items: ItemRecord[];
  nav: (path: string) => void;
  onRefresh: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  appBusy: boolean;
  sponsor: boolean;
}) {
  const [holdings, setHoldings] = useState<PublicItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [working, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState<ItemRecord>();
  const generation = useRef(0);
  const busy = working || appBusy;
  const address = session?.account;
  async function load(more = false) {
    const run = ++generation.current;
    if (!address) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<{
        items: PublicItem[];
        nextCursor: string | null;
      }>(`/api/wallets/${address}${more && cursor ? `?cursor=${cursor}` : ""}`);
      if (run === generation.current) {
        setHoldings((old) => (more ? [...old, ...result.items] : result.items));
        setCursor(result.nextCursor);
      }
    } catch (e) {
      if (run === generation.current) setError((e as Error).message);
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setHoldings([]);
    setCursor(null);
    setReview(undefined);
    void load();
    return () => {
      generation.current++;
    };
  }, [address]);
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      try {
        await onRefresh();
      } finally {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  const prepared = items.filter(
    (i) => i.walletTransfer && ["draft", "pending", "stale"].includes(i.status),
  );
  const local = items.filter((i) => ["owned", "exported"].includes(i.status));
  const locked = !vault?.unlocked,
    wrongNetwork = !!session && !isZVMChain(session.chainId);
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="text-ledger">
            ZVM devnet · one collectible, two custody choices
          </p>
          <h1>Your wallet. Your files.</h1>
          <p>
            Keep a collectible in MetaMask or move it to a transferable picture.
            Each move changes ownership on ZVM.
          </p>
        </div>
        <button
          className={btn}
          disabled={loading || !session}
          onClick={() => load()}
        >
          Refresh wallet
        </button>
      </div>
      {!session && (
        <div className="callout">
          Connect MetaMask using Connect wallet in the header to see its ZFT
          collectibles.
        </div>
      )}
      {session && <p className="mono wrap">Wallet: {session.account}</p>}
      {wrongNetwork && (
        <div className="callout">
          Open your wallet controls and switch to ZVM Devnet.
        </div>
      )}
      {locked && (
        <div className="callout">
          Unlock your local collection before moving custody.{" "}
          <button className="text-button" onClick={() => nav("/collection")}>
            Open local collection →
          </button>
        </div>
      )}
      {!sponsor && (
        <div className="callout">
          Sponsorship is unavailable. You can inspect and recover saved keys;
          transfers will resume when sponsorship returns.
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      <h2>In your wallet</h2>
      <p>
        These are indexed holdings at this public address. Every move checks the
        live owner, deployment and ownership epoch again.
      </p>
      {loading && !holdings.length ? (
        <p>Loading wallet collectibles…</p>
      ) : session && !holdings.length ? (
        <p>No indexed ZFT collectibles at this wallet yet.</p>
      ) : null}
      <div className="gallery-grid">
        {holdings.map((i) => (
          <article className="art-card" key={i.tokenId}>
            <img
              src={`/art/${i.metadata.imageHash.slice(2)}.png`}
              alt={i.metadata.name}
            />
            <div className="art-info">
              <h3>{i.metadata.name}</h3>
              <p className="mono">{short(i.tokenId)}</p>
              <button
                className={btn}
                disabled={
                  locked ||
                  wrongNetwork ||
                  busy ||
                  !!prepared.find((p) => p.tokenId === i.tokenId)
                }
                onClick={() =>
                  act(async () => {
                    await walletFlows.prepareWalletFile(
                      vault!,
                      deployment,
                      session!,
                      i,
                      await walletFlows.publicPixels(i.metadata),
                    );
                    setNotice(
                      "A fresh file key is saved. Download and confirm an updated recovery file, then authorize the move below.",
                    );
                  })
                }
              >
                Prepare file custody
              </button>
            </div>
          </article>
        ))}
      </div>
      {cursor && (
        <button className={btn} disabled={loading} onClick={() => load(true)}>
          More wallet collectibles
        </button>
      )}
      {!!prepared.length && (
        <>
          <h2>Saved custody moves</h2>
          <p>
            Prepared keys survive reload and recovery. Resume the same
            destination after a rejected prompt or interrupted request.
          </p>
          <div className="collection-grid">
            {prepared.map((i) => (
              <article className="panel" key={i.tokenId}>
                <h3>{i.metadata.name}</h3>
                <p>
                  {i.walletTransfer!.direction === "into-file"
                    ? "Wallet → file"
                    : "File → wallet"}{" "}
                  · {i.status}
                </p>
                <p className="mono wrap">
                  Destination:{" "}
                  {i.walletTransfer!.direction === "into-file"
                    ? privateKeyToAccount(i.privateKey).address
                    : i.walletTransfer!.wallet}
                </p>
                <div className="actions">
                  <button className={btn} onClick={() => nav("/recovery")}>
                    Save recovery
                  </button>
                  <button
                    className={btn}
                    disabled={
                      busy || locked || wrongNetwork || !session || !sponsor
                    }
                    onClick={() =>
                      act(async () => {
                        const job =
                          i.walletTransfer!.direction === "into-file"
                            ? await walletFlows.authorizeWalletFile(
                                vault!,
                                deployment,
                                session!,
                                i,
                              )
                            : await submit(vault!, deployment, i);
                        setNotice(
                          `Ownership move ${job.state}. Refresh its status until confirmed.`,
                        );
                      })
                    }
                  >
                    {i.walletTransfer!.direction === "into-file"
                      ? "Authorize or resume in MetaMask"
                      : "Resume saved move"}
                  </button>
                  <button
                    className={btn}
                    disabled={busy || locked}
                    onClick={() =>
                      act(async () => {
                        await reconcile(vault!, deployment, i);
                        await load();
                        setNotice("Saved move checked against ZVM.");
                      })
                    }
                  >
                    Check status
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {!locked && (
        <>
          <h2>In your files</h2>
          <p>
            Moving to MetaMask invalidates outstanding files when confirmed.
            Your wallet key is never placed in a picture.
          </p>
          {!local.length && (
            <p>
              No currently owned local files. Import or mint one from My
              collection.
            </p>
          )}
          <div className="collection-grid">
            {local.map((i) => (
              <article className="panel" key={i.tokenId}>
                <h3>{i.metadata.name}</h3>
                <p className="mono">{short(i.tokenId)}</p>
                <button
                  className={btn}
                  disabled={!session || wrongNetwork || busy || !sponsor}
                  onClick={() => setReview(i)}
                >
                  Move to connected wallet
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      <p className="public-note">
        Moves use a narrowly scoped ownership authorization and sponsored devnet
        gas. They do not grant an operator approval or enable trading.
        Confirmation uses this app's six-subsequent-block policy.
      </p>
      {review && session && (
        <Modal
          title="Move this collectible to MetaMask"
          onClose={() => {
            if (!busy) setReview(undefined);
          }}
        >
          <h3>{review.metadata.name}</h3>
          <p>The recipient is your connected ZVM wallet:</p>
          <p className="mono wrap">{session.account}</p>
          <p>
            Once confirmed, old exported files can no longer claim this
            collectible. A holder of the current file can still race this move.
          </p>
          <button
            className={btn}
            disabled={busy || wrongNetwork}
            onClick={() =>
              act(async () => {
                await walletFlows.moveFileToWallet(
                  vault!,
                  deployment,
                  session,
                  review,
                );
                setReview(undefined);
                setNotice(
                  "Move submitted. Keep this vault and its recovery until ownership is confirmed.",
                );
              })
            }
          >
            {busy ? "Submitting…" : "Confirm move to this wallet"}
          </button>
        </Modal>
      )}
    </>
  );
}
