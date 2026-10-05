import React, { useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import { Modal } from "./site-controls";
import {
  ensureNetwork,
  walletAccount,
  isZVMChain,
  type WalletChoice,
  type WalletProvider,
} from "./wallet";
import { CHAIN_ID, type Deployment } from "../../../packages/protocol";
import manifest from "../../../packages/protocol/deployment.json";
import {
  checkDeployment,
  publicClient,
} from "../../../packages/protocol/client";
const btn = "nom-btn nom-btn--outline nom-btn--default";
export function WalletControl() {
  const [choices, setChoices] = useState<WalletChoice[]>([]),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<WalletChoice>(),
    [account, setAccount] = useState<string>(),
    [chain, setChain] = useState<string>(),
    [balance, setBalance] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = useRef(0),
    connection = useRef(0);
  useEffect(
    () => () => {
      connection.current++;
    },
    [],
  );
  useEffect(() => {
    const receive = (e: Event) => {
      const d = (e as CustomEvent<WalletChoice>).detail;
      if (
        typeof d?.info?.uuid === "string" &&
        typeof d?.info?.name === "string" &&
        typeof d.provider?.request === "function"
      )
        setChoices((old) =>
          old.some((x) => x.info.uuid === d.info.uuid) ? old : [...old, d],
        );
    };
    window.addEventListener("eip6963:announceProvider", receive);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const injected = (window as unknown as { ethereum?: WalletProvider })
      .ethereum;
    if (injected?.isMetaMask)
      setChoices((old) =>
        old.length
          ? old
          : [
              {
                info: {
                  uuid: "legacy-metamask",
                  name: "MetaMask",
                  rdns: "io.metamask",
                },
                provider: injected,
              },
            ],
      );
    return () =>
      window.removeEventListener("eip6963:announceProvider", receive);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const p = selected.provider;
    const accounts = (v: unknown) => {
      run.current++;
      setBalance("");
      try {
        setAccount(walletAccount(v));
      } catch {
        setAccount(undefined);
      }
    };
    const changed = (v: unknown) => {
      run.current++;
      setChain(String(v));
      setBalance("");
    };
    const disconnected = () => {
      connection.current++;
      run.current++;
      setBusy(false);
      setAccount(undefined);
      setBalance("");
    };
    p.on?.("accountsChanged", accounts);
    p.on?.("chainChanged", changed);
    p.on?.("disconnect", disconnected);
    return () => {
      p.removeListener?.("accountsChanged", accounts);
      p.removeListener?.("chainChanged", changed);
      p.removeListener?.("disconnect", disconnected);
    };
  }, [selected]);
  async function connect(choice: WalletChoice) {
    const attempt = ++connection.current;
    setBusy(true);
    setError("");
    setSelected(choice);
    try {
      await ensureNetwork(choice.provider);
      if (attempt !== connection.current) return;
      await checkDeployment(manifest as unknown as Deployment);
      if (attempt !== connection.current) return;
      const accounts = await choice.provider.request({
        method: "eth_requestAccounts",
      });
      const address = walletAccount(accounts);
      if (!address) throw new Error("No wallet account was selected.");
      const network = String(
        await choice.provider.request({ method: "eth_chainId" }),
      );
      if (attempt !== connection.current) return;
      setAccount(address);
      setChain(network);
    } catch (e) {
      if (attempt !== connection.current) return;
      setError(
        (e as { code?: number }).code === 4001
          ? "Connection or network request was declined."
          : (e as Error).message,
      );
    } finally {
      if (attempt === connection.current) setBusy(false);
    }
  }
  useEffect(() => {
    const token = ++run.current;
    setBalance("");
    if (account && isZVMChain(chain))
      publicClient
        .getBalance({ address: account as `0x${string}` })
        .then((b) => {
          if (token === run.current) setBalance(formatEther(b));
        })
        .catch(() => {
          if (token === run.current)
            setError("The devnet balance could not be read.");
        });
    return () => {
      run.current++;
    };
  }, [account, chain]);
  const correct = isZVMChain(chain);
  const list = choices.filter(
    (c, _, all) =>
      c.info.uuid !== "legacy-metamask" ||
      !all.some(
        (x) =>
          x.info.uuid !== "legacy-metamask" && x.info.rdns === "io.metamask",
      ),
  );
  return (
    <>
      <button className={btn} onClick={() => setOpen(true)}>
        {account
          ? `${account.slice(0, 6)}…${account.slice(-4)}`
          : "Connect wallet"}
      </button>
      {open && (
        <Modal title="Wallet on ZVM" onClose={() => setOpen(false)}>
          <p>
            Connect MetaMask to view your ZVM address and devnet gas balance.
            Your wallet key stays in your wallet.
          </p>
          {account ? (
            <>
              <p className="mono wrap">{account}</p>
              <p>{correct ? "ZVM Devnet" : "Different network selected"}</p>
              {balance && (
                <p>
                  <strong>
                    {Number(balance).toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}{" "}
                    Devnet ZNN
                  </strong>
                </p>
              )}
              <div className="actions">
                {!correct && selected && (
                  <button
                    className={btn}
                    disabled={busy}
                    onClick={() => connect(selected)}
                  >
                    Switch to ZVM Devnet
                  </button>
                )}
                <a
                  className={btn}
                  href={`https://devnet.zenon.foo/explorer/address/${account}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on explorer ↗
                </a>
                <button
                  className={btn}
                  onClick={() => {
                    connection.current++;
                    run.current++;
                    setBusy(false);
                    setSelected(undefined);
                    setAccount(undefined);
                    setChain(undefined);
                    setBalance("");
                    setError("");
                  }}
                >
                  Disconnect from app
                </button>
              </div>
              <p className="public-note">
                Wallet connection does not move a collectible. File-to-wallet
                custody transfers and trading are the next wallet integration
                step. Disconnecting here does not revoke the site's permission
                inside MetaMask.
              </p>
            </>
          ) : (
            <div className="wallet-choices">
              {list.map((c) => (
                <button
                  key={c.info.uuid}
                  className={btn}
                  disabled={busy}
                  onClick={() => connect(c)}
                >
                  {busy ? "Waiting for wallet…" : `Connect ${c.info.name}`}
                </button>
              ))}
              {!list.length && (
                <p>
                  No browser wallet detected. Open this app in a browser with
                  MetaMask, or in MetaMask's browser.
                </p>
              )}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </>
  );
}
