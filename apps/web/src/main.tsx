import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "../../../design/vendor/zenon/tokens/colors.css";
import "../../../design/vendor/zenon/tokens/typography.css";
import "../../../design/vendor/zenon/tokens/radius.css";
import "../../../design/vendor/zenon/tokens/elevation.css";
import "../../../design/vendor/zenon/tokens/utilities.css";
import "../../../design/vendor/zenon/components/components.css";
import "./styles.css";
import logo from "../../../design/vendor/zenon/assets/znn-logo.svg";
import manifest from "../../../packages/protocol/deployment.json";
import {
  digest,
  type Deployment,
  type Metadata,
} from "../../../packages/protocol";
import { Vault, base64, type ItemRecord } from "../../../packages/vault";
import { MAX_IMAGE } from "../../../packages/file-codec";
import { api, signedRequest } from "./api";
import * as flows from "./flows";
import {
  PublicProfile,
  PublicDetail,
  EditProfile,
  Activity,
} from "./public-pages";
import { possessionText } from "../../../packages/protocol/public";
import { ThemeControl, ProfileLookup } from "./site-controls";
import { WalletControl } from "./wallet-control";
import { WalletPage } from "./wallet-page";
import { isZVMChain, type WalletSession } from "./wallet";
import { localIdentity, walletIdentity, type Identity } from "./identity";
import { WalletJournal } from "./wallet-journal";
import { inactivityLock } from "./inactivity";
import {
  prepareWalletMint,
  prepareWalletClaim,
  submitWallet,
} from "./wallet-direct";

type Config = { deployment: typeof manifest; sponsorEnabled: boolean };
type PublicItem = {
  tokenId: string;
  metadata: Metadata;
  metadataHash: Hex;
  owner?: string;
  nonce?: string;
  blockNumber?: string;
};
type Normalized = {
  bytes: Uint8Array;
  width: number;
  height: number;
  imageHash: Hex;
};
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-6)}`;
const Button = ({
  children,
  onClick,
  disabled = false,
  primary = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: "button" | "submit";
}) => (
  <button
    type={type}
    className={`nom-btn nom-btn--default ${primary ? "nom-btn--primary" : "nom-btn--outline"}`}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
);

function App() {
  const [path, setPath] = useState(location.pathname + location.search),
    [config, setConfig] = useState<Config>(),
    [vault, setVault] = useState<Vault>(),
    [unlocked, setUnlocked] = useState(false),
    [exists, setExists] = useState(false);
  const routePath = path.split("?")[0];
  const [walletSession, setWalletSession] = useState<WalletSession>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [journal, setJournal] = useState<WalletJournal>(),
    [persistentVault, setPersistentVault] = useState<Vault>(),
    [protectBrowser, setProtectBrowser] = useState(false),
    [profileMode, setProfileMode] = useState<"wallet" | "local">("wallet"),
    [localSigner, setLocalSigner] = useState<Identity>(),
    [connectRequest, setConnectRequest] = useState(0),
    [mintMode, setMintMode] = useState<"wallet" | "file">("wallet"),
    [claimMode, setClaimMode] = useState<"wallet" | "file">("wallet");
  const walletSigner = useMemo(
    () => (walletSession ? walletIdentity(walletSession) : undefined),
    [walletSession],
  );
  const selectedSigner = profileMode === "wallet" ? walletSigner : localSigner;
  const activeIdentity = useRef(selectedSigner);
  activeIdentity.current = selectedSigner;
  const identity = useMemo<Identity | undefined>(
    () =>
      selectedSigner && {
        ...selectedSigner,
        async assertCurrent() {
          if (activeIdentity.current !== selectedSigner)
            throw new Error(
              "Selected profile changed. Review your identity and try again.",
            );
          await selectedSigner.assertCurrent?.();
        },
      },
    [selectedSigner],
  );
  const profile = identity?.address ?? "";
  const activeVault = useRef(vault);
  activeVault.current = vault;
  const signerVault = useRef<Vault | undefined>(undefined);
  function activateVault(next: Vault | undefined) {
    activeVault.current = next;
    setVault(next);
  }
  const [menuOpen, setMenuOpen] = useState(false),
    [returnTo, setReturnTo] = useState<string>();
  const [items, setItems] = useState<ItemRecord[]>([]),
    [gallery, setGallery] = useState<PublicItem[]>([]),
    [localProfile, setLocalProfile] = useState("");
  const [galleryCursor, setGalleryCursor] = useState<string | null>(null);
  const [index, setIndex] = useState<{
    block: number | null;
    lag: number | null;
    syncedAt: number | null;
    error: string | null;
  }>();
  useEffect(() => {
    const check = () =>
      api<typeof index>("/api/index")
        .then(setIndex)
        .catch(() => {});
    check();
    const timer = setInterval(check, 60000);
    return () => clearInterval(timer);
  }, []);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [passphrase, setPassphrase] = useState(""),
    [confirmPassphrase, setConfirmPassphrase] = useState("");
  const activityBlocked = useRef(false);
  activityBlocked.current = !!busy || walletBusy;
  const [backup, setBackup] = useState<{ revision: number; text: string }>(),
    [revisions, setRevisions] = useState({ current: 0, backedUp: -1 }),
    [backupChecked, setBackupChecked] = useState(false);
  const [normalized, setNormalized] = useState<Normalized>(),
    [preview, setPreview] = useState(""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState("");
  const [transfer, setTransfer] =
      useState<Awaited<ReturnType<typeof flows.readTransfer>>>(),
    [riskAccepted, setRiskAccepted] = useState(false),
    [restore, setRestore] = useState<File>();
  const deployment = manifest.contract
    ? (manifest as unknown as Deployment)
    : undefined;
  const ready = !!deployment && !!config?.sponsorEnabled;
  const nav = (p: string) => {
    const samePage = p.split("?")[0] === location.pathname;
    history.pushState({}, "", p);
    setPath(p);
    setError("");
    setNotice("");
    setRiskAccepted(false);
    setMenuOpen(false);
    if (!samePage) window.scrollTo(0, 0);
  };
  const Link = ({
    to,
    children,
    className,
  }: {
    to: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a
      className={className}
      href={to}
      onClick={(e) => {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          nav(to);
        }
      }}
    >
      {children}
    </a>
  );
  async function refresh(v = vault) {
    if (!v?.unlocked) return;
    const localItems = await v.items();
    const signer = await localIdentity(v);
    const revs = await v.revisions();
    if (!v.unlocked || activeVault.current !== v) return;
    setItems(localItems);
    setLocalProfile(signer.address);
    const sameVault = signerVault.current === v;
    signerVault.current = v;
    setLocalSigner((old) =>
      sameVault && old?.address === signer.address ? old : signer,
    );
    setRevisions(revs);
  }
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to complete this action.",
      );
    } finally {
      setBusy("");
      if (vault?.unlocked) await refresh();
    }
  }
  useEffect(() => {
    const pop = () => setPath(location.pathname + location.search);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let opened: Vault | undefined;
    let openedJournal: WalletJournal | undefined;
    api<Config>("/api/config")
      .then((c) => {
        if (JSON.stringify(c.deployment) !== JSON.stringify(manifest))
          throw new Error(
            "App and server deployments differ. Reload after the deployment is complete.",
          );
        if (!cancelled) setConfig(c);
      })
      .catch((e) => setError(e.message));
    api<{ items: PublicItem[]; nextCursor: string | null }>("/api/gallery")
      .then((r) => {
        if (!cancelled) {
          setGallery(r.items);
          setGalleryCursor(r.nextCursor);
        }
      })
      .catch(() => {});
    if (deployment)
      Vault.open(deployment).then(async (v) => {
        opened = v;
        if (cancelled) return v.close();
        activateVault(v);
        setPersistentVault(v);
        const existing = await v.exists();
        setExists(existing);
        if (existing) setProfileMode("local");
      });
    if (deployment)
      WalletJournal.open(deployment)
        .then((j) => {
          openedJournal = j;
          if (cancelled) j.close();
          else setJournal(j);
        })
        .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      opened?.close();
      if (activeVault.current !== opened) activeVault.current?.close();
      openedJournal?.close();
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    if (!vault || !unlocked || !deployment) return;
    const timer = setInterval(() => {
      if (busy || walletBusy) return;
      const pending = items.find((i) => i.status === "pending" && i.txHash);
      if (pending)
        act("Checking transaction", async () => {
          const job = await flows.reconcile(vault, deployment, pending);
          if (job?.state === "confirmed")
            setNotice("Ownership confirmed. Save an updated recovery file.");
        });
    }, 15000);
    return () => clearInterval(timer);
  }, [vault, unlocked, items, busy, walletBusy]);
  const lock = () => {
    vault?.lock();
    if (!vault?.persistent) activateVault(persistentVault);
    signerVault.current = undefined;
    setUnlocked(false);
    setItems([]);
    setBackup(undefined);
    setTransfer(undefined);
    setLocalProfile("");
    setLocalSigner(undefined);
    setPassphrase("");
    setConfirmPassphrase("");
    setNotice("Collection locked.");
  };
  useEffect(() => {
    if (!unlocked || !vault?.persistent) return;
    return inactivityLock(window, lock, () => activityBlocked.current);
  }, [unlocked, vault]);
  useEffect(() => {
    if (
      !unlocked ||
      vault?.persistent ||
      revisions.current === revisions.backedUp
    )
      return;
    const leaving = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [unlocked, vault, revisions]);
  useEffect(() => {
    if (
      returnTo &&
      ((returnTo.startsWith("/p/") && identity) ||
        (unlocked && revisions.backedUp === revisions.current))
    ) {
      setReturnTo(undefined);
      nav(returnTo);
    }
  }, [returnTo, unlocked, revisions.backedUp, revisions.current, identity]);
  async function startSession(recovery?: string) {
    if (!deployment) throw new Error("Deployment unavailable.");
    const v = await Vault.session(deployment, recovery);
    if (vault && !vault.persistent) vault.close();
    activateVault(v);
    setUnlocked(true);
    if (!walletSession) setProfileMode("local");
    await refresh(v);
    if (recovery === undefined) nav("/recovery");
  }
  async function unlock() {
    if (!vault)
      throw new Error("A deployment is required before creating a vault.");
    if (!exists && !protectBrowser) {
      await startSession();
      return;
    }
    if (exists) await persistentVault!.unlock(passphrase);
    else {
      if (passphrase !== confirmPassphrase)
        throw new Error("Passphrases do not match.");
      await persistentVault!.create(passphrase);
      setExists(true);
    }
    setPassphrase("");
    setConfirmPassphrase("");
    setUnlocked(true);
    activateVault(persistentVault);
    if (!walletSession) setProfileMode("local");
    await refresh(persistentVault);
    if ((await persistentVault!.revisions()).backedUp < 0) nav("/recovery");
  }
  async function normalize(file: File) {
    setNormalized(undefined);
    setPreview("");
    if (file.size > MAX_IMAGE)
      throw new Error("Choose a JPG or PNG up to 10 MiB.");
    const worker = new Worker(new URL("./image.worker.ts", import.meta.url), {
      type: "module",
    });
    const result = await new Promise<Normalized>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error("Image processing timed out. Try a smaller image."));
      }, 60000);
      worker.onmessage = (e) => {
        clearTimeout(timer);
        worker.terminate();
        e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error("Image processing failed."));
      };
      file.arrayBuffer().then((b) => worker.postMessage(b, [b]));
    });
    setNormalized(result);
    setPreview(
      URL.createObjectURL(
        new Blob([result.bytes as BlobPart], { type: "image/png" }),
      ),
    );
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
  }
  const protectionChoice = (
    <label className="check">
      <input
        type="checkbox"
        checked={protectBrowser}
        disabled={!!busy}
        onChange={(e) => setProtectBrowser(e.target.checked)}
      />
      Protect this browser with a password
    </label>
  );
  const passwordFields = (
    <>
      <label>
        {exists ? "Passphrase" : "New passphrase"}
        <input
          type="password"
          autoComplete={exists ? "current-password" : "new-password"}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          minLength={12}
          required
          disabled={!!busy}
        />
      </label>
      {!exists && (
        <label>
          Confirm passphrase
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            required
            disabled={!!busy}
          />
        </label>
      )}
    </>
  );
  const authPanel = (
    <section className="panel narrow">
      <p className="text-ledger">File custody · local keys</p>
      <h1>
        {exists ? "Unlock your saved files." : "Keep a file. Keep a way back."}
      </h1>
      <p>
        {exists
          ? "Your existing collection stays encrypted. Use its passphrase to reopen it."
          : "Download a secret recovery file to keep your keys. A password is optional."}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act("Opening file collection", unlock);
        }}
      >
        {!exists && protectionChoice}
        {!exists && (
          <p className="muted">
            {protectBrowser
              ? "Encrypted keys stay in this browser. It locks after 15 minutes without activity. Your recovery download still needs to be kept private."
              : "Session only: keys stay in memory. Reloading, closing this tab or ending the session clears them. Restore your downloaded recovery file to continue."}
          </p>
        )}
        {(exists || protectBrowser) && passwordFields}
        <Button type="submit" primary disabled={!!busy || !persistentVault}>
          {exists
            ? "Unlock collection"
            : protectBrowser
              ? "Create protected collection"
              : "Start file session"}
        </Button>
      </form>
      {exists && (
        <Button
          disabled={!!busy}
          onClick={() =>
            act("Starting temporary file session", () => startSession())
          }
        >
          Use a temporary file session
        </Button>
      )}
      <Link to="/recovery">Restore a recovery file →</Link>
      <p className="public-note">
        Wallet minting and receiving need no local vault.{" "}
        <Link to="/wallet">Open wallet →</Link>
      </p>
    </section>
  );
  const walletPanel = (
    <section className="panel narrow">
      <p className="text-ledger">Your wallet is your collection</p>
      <h1>Start with MetaMask.</h1>
      <p>
        Mint and receive collectibles directly into your wallet. Use it to sign
        profile actions, with no separate ZFT password.
      </p>
      <Button primary onClick={() => setConnectRequest((n) => n + 1)}>
        Connect wallet
      </Button>
      <p className="muted">
        Connecting alone does not transfer a collectible or publish a profile.
      </p>
    </section>
  );
  const profilePanel = (
    <>
      {walletSession ? (
        <section className="panel narrow">
          <h1>Choose your public identity.</h1>
          <p>
            Use your wallet address as a separate profile. Existing local
            profiles and their URLs stay unchanged.
          </p>
          <Button primary onClick={() => setProfileMode("wallet")}>
            Use wallet profile
          </Button>
        </section>
      ) : (
        walletPanel
      )}
      <section className="panel narrow">
        <h2>Already have a local profile?</h2>
        <p>
          Unlock its vault or restore its recovery file to keep the same
          identity. Profiles are not merged automatically.
        </p>
        <Button
          onClick={() => {
            setProfileMode("local");
            nav("/collection");
          }}
        >
          Open local profile
        </Button>
      </section>
    </>
  );
  const custodyChoice = (
    value: "wallet" | "file",
    change: (v: "wallet" | "file") => void,
  ) => (
    <fieldset className="custody-choice" disabled={!!busy || walletBusy}>
      <legend>Keep this collectible in</legend>
      <label className="check">
        <input
          type="radio"
          name="custody"
          checked={value === "wallet"}
          onChange={() => change("wallet")}
        />
        My wallet · recommended
      </label>
      <label className="check">
        <input
          type="radio"
          name="custody"
          checked={value === "file"}
          onChange={() => change("file")}
        />
        A transferable file
      </label>
    </fieldset>
  );
  function itemCard(item: PublicItem) {
    return (
      <Link
        key={item.tokenId}
        to={`/item/${item.tokenId}`}
        className="art-card"
      >
        <img
          src={new URL(item.metadata.image).pathname}
          alt={item.metadata.name}
        />
        <div className="art-info">
          <h3>{item.metadata.name}</h3>
          <p className="mono">{short(item.metadata.creator)}</p>
          <span className="text-ledger">ZVM devnet · public collectible</span>
        </div>
      </Link>
    );
  }
  let content: ReactNode;
  if (routePath === "/mint")
    content = (mintMode === "wallet" ? !walletSession : !unlocked) ? (
      mintMode === "wallet" ? (
        walletPanel
      ) : (
        authPanel
      )
    ) : (
      <section className="flow-grid">
        <div className="panel">
          <p className="text-ledger">Create a collectible</p>
          <h1>
            {mintMode === "wallet" ? "Make it yours." : "Make it a file."}
          </h1>
          {mintMode === "wallet" && (
            <p className="mono wrap">Mint to {walletSession!.account}</p>
          )}
          <p>
            Choose a picture. We strip its metadata locally and create a
            canonical PNG. Minting publishes the clean picture and its
            description.
          </p>
          <label className="file-input">
            Choose JPG or PNG
            <input
              type="file"
              accept="image/jpeg,image/png"
              disabled={!!busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) act("Preparing your image", () => normalize(f));
                e.target.value = "";
              }}
            />
          </label>
          <label>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              disabled={!!busy}
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              disabled={!!busy}
            />
          </label>
          <p className="muted">
            One collectible per canonical image hash in this contract. Devnet
            can reset; these assets have no promised value.
          </p>
          <Button
            primary
            disabled={
              !ready ||
              !normalized ||
              !title.trim() ||
              !!busy ||
              (mintMode === "wallet" &&
                (!journal || !isZVMChain(walletSession?.chainId)))
            }
            onClick={() =>
              act("Preparing your mint", async () => {
                if (mintMode === "wallet") {
                  const record = await prepareWalletMint(
                    journal!,
                    deployment!,
                    walletSession!,
                    normalized!,
                    title,
                    description,
                  );
                  nav("/wallet");
                  const job = await submitWallet(
                    journal!,
                    deployment!,
                    walletSession!,
                    record,
                  );
                  setNotice(
                    `Wallet mint ${job.state}. Check Wallet for confirmation.`,
                  );
                } else {
                  await flows.prepareMint(
                    vault!,
                    deployment!,
                    normalized!,
                    title,
                    description,
                  );
                  await refresh();
                  setReturnTo("/collection");
                  nav("/recovery");
                  setNotice(
                    "Your file key is prepared. Save and confirm recovery, then resume the mint from your file collection.",
                  );
                }
                setNormalized(undefined);
                setPreview("");
              })
            }
          >
            {mintMode === "wallet"
              ? "Sign and mint to wallet"
              : "Prepare file mint"}
          </Button>
          {mintMode === "file" && revisions.backedUp < 0 && (
            <Link to="/recovery">Save recovery before minting →</Link>
          )}
        </div>
        <div className="preview-surface">
          {preview ? (
            <>
              <img src={preview} alt="Your exact canonical mint image" />
              <p className="mono">
                {normalized?.width} × {normalized?.height} · PNG
              </p>
            </>
          ) : (
            <div>
              <span className="outline-mark">Z</span>
              <p>Your picture belongs here.</p>
            </div>
          )}
        </div>
      </section>
    );
  else if (routePath === "/claim")
    content = (claimMode === "wallet" ? !walletSession : !unlocked) ? (
      claimMode === "wallet" ? (
        walletPanel
      ) : (
        authPanel
      )
    ) : (
      <section className="panel narrow">
        <p className="text-ledger">Receive a collectible</p>
        <h1>Open. Verify. Claim.</h1>
        <p>
          Choose the original <span className="mono">.zft.png</span> attachment.
          Its ownership key is read locally. Choose where to receive the
          collectible before claiming.
        </p>
        {claimMode === "wallet" && (
          <p className="mono wrap">Receive in {walletSession!.account}</p>
        )}
        <label className="file-input">
          Open a transfer file
          <input
            type="file"
            accept="image/png,.png"
            disabled={!!busy || !deployment}
            onChange={(e) => {
              const f = e.target.files?.[0];
              setTransfer(undefined);
              if (f)
                act("Verifying file against ZVM", async () =>
                  setTransfer(await flows.readTransfer(f, deployment!)),
                );
              e.target.value = "";
            }}
          />
        </label>
        {transfer && (
          <>
            <img
              className="claim-image"
              src={`data:image/png;base64,${base64(transfer.image)}`}
              alt={transfer.envelope.metadata.name}
            />
            <h2>{transfer.envelope.metadata.name}</h2>
            <p className="status-ok">
              File matches the current owner and ownership nonce.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={riskAccepted}
                onChange={(e) => setRiskAccepted(e.target.checked)}
              />
              I understand another copy can win the race until my claim is
              confirmed.
            </label>
            <Button
              primary
              disabled={
                !ready ||
                !!busy ||
                !riskAccepted ||
                (claimMode === "wallet" &&
                  (!journal || !isZVMChain(walletSession?.chainId)))
              }
              onClick={() =>
                act("Preparing your claim", async () => {
                  if (claimMode === "wallet") {
                    const record = await prepareWalletClaim(
                      journal!,
                      deployment!,
                      walletSession!,
                      transfer,
                    );
                    nav("/wallet");
                    const job = await submitWallet(
                      journal!,
                      deployment!,
                      walletSession!,
                      record,
                      transfer,
                    );
                    setNotice(
                      `Wallet claim ${job.state}. Keep the original file until confirmation.`,
                    );
                  } else {
                    const e = transfer.envelope;
                    await flows.prepareRotation(vault!, deployment!, {
                      kind: "item",
                      tokenId: e.tokenId,
                      privateKey: e.authority.privateKey,
                      previousKeys: [],
                      image: base64(transfer.image),
                      metadata: e.metadata,
                      nonce: e.authority.ownershipNonce,
                      status: "draft",
                    });
                    await refresh();
                    setReturnTo("/collection");
                    nav("/recovery");
                    setNotice(
                      "Your fresh key is prepared. Save and confirm recovery, then resume this claim from your file collection.",
                    );
                  }
                  setTransfer(undefined);
                })
              }
            >
              {claimMode === "wallet"
                ? "Claim into this wallet"
                : "Prepare a fresh file key"}
            </Button>
          </>
        )}
        {claimMode === "file" && revisions.backedUp < 0 && (
          <Link to="/recovery">Save recovery before claiming →</Link>
        )}
      </section>
    );
  else if (routePath === "/recovery")
    content = (
      <section className="panel narrow">
        <p className="text-ledger">Recovery snapshot</p>
        <h1>Keep a way back.</h1>
        <p>
          A recovery file contains secret access to the keys in that snapshot.
          Anyone with it can recover those items. Keep it offline and private.
        </p>
        {unlocked ? (
          <>
            <p className="callout">
              {vault?.persistent
                ? "This browser remembers encrypted keys and locks after 15 minutes of inactivity."
                : "Session only. Reloading or closing this tab clears your keys. Keep a downloaded recovery file before leaving."}
            </p>
            <p>
              Saved snapshot:{" "}
              <span className="mono">
                {revisions.backedUp < 0 ? "None" : revisions.backedUp}
              </span>{" "}
              · Current revision:{" "}
              <span className="mono">{revisions.current}</span>
            </p>
            <Button
              primary
              disabled={!!busy}
              onClick={() =>
                act("Preparing recovery snapshot", async () => {
                  const b = await vault!.backup();
                  setBackup(b);
                  setBackupChecked(false);
                  flows.download(
                    b.text,
                    `zft-recovery-${new Date().toISOString().slice(0, 10)}-r${b.revision}.zft-recovery`,
                    "application/json",
                  );
                })
              }
            >
              Download current recovery file
            </Button>
            {backup && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={backupChecked}
                    onChange={(e) => setBackupChecked(e.target.checked)}
                  />
                  I saved this secret file somewhere I can recover it.
                </label>
                <Button
                  disabled={!backupChecked || !!busy}
                  onClick={() =>
                    act("Confirming recovery snapshot", async () => {
                      await vault!.acknowledgeBackup(backup.revision);
                      setBackup(undefined);
                      setNotice("Recovery saved. You can now mint or claim.");
                    })
                  }
                >
                  Confirm saved
                </Button>
              </>
            )}
            <p className="muted">
              Save a new snapshot whenever you prepare a file key, before
              submitting its mint or transfer. Earlier backups cannot recreate
              later item keys.
            </p>
            {!vault?.persistent && !exists && (
              <section className="protection-panel">
                <h2>Remember encrypted keys here</h2>
                <p>
                  Keep this session in the browser with a passphrase. Your
                  downloaded recovery file still gives full access without that
                  passphrase.
                </p>
                {passwordFields}
                <Button
                  disabled={
                    !!busy ||
                    passphrase.length < 12 ||
                    passphrase !== confirmPassphrase ||
                    revisions.current !== revisions.backedUp
                  }
                  onClick={() =>
                    act("Protecting browser storage", async () => {
                      const snapshot = await vault!.backup();
                      if (
                        (await vault!.revisions()).backedUp !==
                        snapshot.revision
                      )
                        throw new Error(
                          "Save and confirm current recovery before remembering these keys.",
                        );
                      await persistentVault!.restore(snapshot.text, passphrase);
                      vault!.close();
                      activateVault(persistentVault);
                      setExists(true);
                      setPassphrase("");
                      setConfirmPassphrase("");
                      await refresh(persistentVault);
                      setNotice(
                        "Keys are now remembered in encrypted browser storage.",
                      );
                    })
                  }
                >
                  Protect this browser with a password
                </Button>
              </section>
            )}
          </>
        ) : exists ? (
          authPanel
        ) : (
          <>
            <p>
              Restore your keys for this session, or choose password protection
              to remember them in this browser. This does not change the
              recovery file.
            </p>
            <label>
              Recovery file
              <input
                type="file"
                accept=".zft-recovery,application/json"
                onChange={(e) => setRestore(e.target.files?.[0])}
              />
            </label>
            {protectionChoice}
            {protectBrowser && passwordFields}
            <Button
              disabled={
                !restore ||
                !deployment ||
                (protectBrowser &&
                  (passphrase.length < 12 ||
                    passphrase !== confirmPassphrase)) ||
                !!busy
              }
              onClick={() =>
                act("Restoring recovery snapshot", async () => {
                  if (restore!.size > 100_000_000)
                    throw new Error("Recovery file is too large.");
                  if (protectBrowser) {
                    await persistentVault!.restore(
                      await restore!.text(),
                      passphrase,
                    );
                    activateVault(persistentVault);
                    setExists(true);
                    setUnlocked(true);
                    if (!walletSession) setProfileMode("local");
                    await refresh(persistentVault);
                  } else await startSession(await restore!.text());
                  setPassphrase("");
                  setConfirmPassphrase("");
                  nav("/collection");
                  setNotice(
                    "Restored. Refresh each item to verify its current ownership.",
                  );
                })
              }
            >
              Restore collection
            </Button>
            <Link to="/collection">Create a new collection →</Link>
          </>
        )}
      </section>
    );
  else if (routePath === "/collection")
    content = !unlocked ? (
      authPanel
    ) : (
      <>
        <div className="section-heading">
          <div>
            <p className="text-ledger">
              {vault?.persistent
                ? "Encrypted browser storage"
                : "Session-only file keys"}
            </p>
            <h1>
              My files<span className="heading-dot">.</span>
            </h1>
            <p className="mono">Local profile {short(localProfile)}</p>
            <Link to="/settings/profile">Edit public profile →</Link>
          </div>
          <div className="actions">
            <Link
              className="nom-btn nom-btn--outline nom-btn--default"
              to="/claim"
            >
              Import a file
            </Link>
            <Link
              className="nom-btn nom-btn--primary nom-btn--default"
              to="/mint"
            >
              Mint a picture
            </Link>
          </div>
        </div>
        {revisions.current !== revisions.backedUp && (
          <div className="callout">
            Your recovery snapshot needs updating.{" "}
            <Link to="/recovery">Save current keys →</Link>
          </div>
        )}
        {items.length ? (
          <div className="collection-grid">
            {items.map((item) => (
              <article className="art-card" key={item.tokenId}>
                <img
                  src={`data:image/png;base64,${item.image}`}
                  alt={item.metadata.name}
                />
                <div className="art-info">
                  <h2>{item.metadata.name}</h2>
                  <p className="text-ledger">
                    {item.status === "exported"
                      ? "Exported · yours until claimed"
                      : item.status}
                  </p>
                  <p className="mono">
                    {short(item.tokenId)} · epoch {item.nonce}
                  </p>
                  {item.txHash && (
                    <a
                      className="external"
                      href={`https://devnet.zenon.foo/explorer/tx/${item.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View transaction ↗
                    </a>
                  )}
                  <div className="card-actions">
                    <Button
                      disabled={!!busy}
                      onClick={() =>
                        act("Checking current ownership", async () => {
                          const job = await flows.reconcile(
                            vault!,
                            deployment!,
                            item,
                          );
                          setNotice(
                            job
                              ? `Transaction ${job.state}. Confirmations use a six-block application policy.`
                              : "Ownership refreshed.",
                          );
                        })
                      }
                    >
                      Refresh status
                    </Button>
                    {item.walletTransfer && (
                      <Link to="/wallet">Manage wallet custody →</Link>
                    )}
                    {item.operation &&
                      (item.status === "draft" || item.status === "pending") &&
                      item.walletTransfer?.direction !== "into-file" && (
                        <Button
                          disabled={!!busy || !ready}
                          onClick={() =>
                            act("Resuming saved operation", async () => {
                              await vault!.requireItemBackup(item);
                              if (item.operation?.kind === "mint")
                                await signedRequest(
                                  "/api/uploads",
                                  {
                                    image: item.image,
                                    metadata: item.metadata,
                                  },
                                  await vault!.profile(),
                                );
                              await flows.submit(vault!, deployment!, item);
                              setNotice(
                                "Saved operation resubmitted; no replacement item key was generated.",
                              );
                            })
                          }
                        >
                          Resume transaction
                        </Button>
                      )}
                    {["owned", "exported"].includes(item.status) && (
                      <>
                        <Button
                          primary
                          disabled={!!busy}
                          onClick={() =>
                            act(
                              "Checking ownership and exporting",
                              async () => {
                                await flows.send(vault!, deployment!, item);
                                setNotice(
                                  "Transfer file downloaded. Whoever claims this file first gets the collectible. Send the original attachment.",
                                );
                              },
                            )
                          }
                        >
                          Export transfer file
                        </Button>
                        <Button
                          disabled={!!busy || !ready}
                          onClick={() =>
                            act("Rotating to a new private key", async () => {
                              await flows.prepareRotation(
                                vault!,
                                deployment!,
                                item,
                              );
                              await refresh();
                              setReturnTo("/collection");
                              nav("/recovery");
                              setNotice(
                                "New cancellation key prepared. Save recovery, then resume the rotation. Old copies work until the rotation is confirmed.",
                              );
                            })
                          }
                        >
                          Cancel old copies
                        </Button>
                        <Button
                          disabled={!!busy || !identity}
                          onClick={() =>
                            act("Publishing an ownership proof", async () => {
                              const p = identity!;
                              const proof = {
                                tokenId: item.tokenId,
                                nonce: item.nonce,
                                owner: privateKeyToAccount(item.privateKey)
                                  .address,
                                expires:
                                  Math.floor(Date.now() / 1000) + 30 * 86400,
                              };
                              const signature = await privateKeyToAccount(
                                item.privateKey,
                              ).signMessage({
                                message: possessionText(p.address, proof),
                              });
                              await signedRequest(
                                "/api/possessions",
                                { ...proof, signature },
                                p,
                              );
                              setNotice(
                                "This item is now linked to your public profile for up to 30 days, while this ownership epoch remains current.",
                              );
                            })
                          }
                        >
                          Publish to selected profile
                        </Button>
                        <Button
                          disabled={!!busy || !identity}
                          onClick={() =>
                            act(
                              "Removing the public ownership link",
                              async () => {
                                await signedRequest(
                                  "/api/unpublish",
                                  { tokenId: item.tokenId },
                                  identity!,
                                );
                                setNotice(
                                  "Public ownership link removed. Mint provenance and on-chain history remain public.",
                                );
                              },
                            )
                          }
                        >
                          Remove from profile
                        </Button>
                        <p className="muted">
                          Publishing links this holding to your public identity.
                          Create your public profile first.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="outline-mark">Z</span>
            <h2>Your first file starts here.</h2>
            <p>Mint a picture or import one a friend sent you.</p>
            <Link
              className="nom-btn nom-btn--primary nom-btn--default"
              to="/mint"
            >
              Mint a picture
            </Link>
          </div>
        )}
      </>
    );
  else if (routePath === "/settings/profile")
    content = identity ? (
      <EditProfile
        key={profile}
        identity={identity}
        nav={nav}
        onError={setError}
      />
    ) : (
      profilePanel
    );
  else if (routePath === "/wallet" && deployment)
    content = (
      <WalletPage
        session={walletSession}
        journal={journal}
        onConnect={() => setConnectRequest((n) => n + 1)}
        onWalletProfile={() => {
          setProfileMode("wallet");
          nav("/settings/profile");
        }}
        vault={unlocked ? vault : undefined}
        deployment={deployment}
        items={items}
        nav={(to) => {
          if (to === "/collection" && !unlocked) setReturnTo("/wallet");
          if (to === "/mint") setMintMode("wallet");
          if (to === "/claim") setClaimMode("wallet");
          nav(to);
        }}
        onRefresh={refresh}
        onBusy={setWalletBusy}
        appBusy={!!busy || walletBusy}
        sponsor={ready}
      />
    );
  else if (routePath === "/activity") content = <Activity onError={setError} />;
  else if (path.startsWith("/item/"))
    content = (
      <PublicDetail
        key={path.split("/")[2].split("?")[0]}
        id={path.split("/")[2].split("?")[0]}
        nav={nav}
        onError={setError}
      />
    );
  else if (path.startsWith("/p/"))
    content = (
      <PublicProfile
        key={path.split("/")[2].split("?")[0].toLowerCase()}
        address={path.split("/")[2].split("?")[0]}
        path={path}
        nav={nav}
        onError={setError}
        identity={identity}
        viewer={profile}
        onUnlock={(to) => {
          setReturnTo(to);
          nav("/settings/profile");
        }}
      />
    );
  else if (routePath === "/about" || routePath === "/how-it-works")
    content = (
      <section className="panel narrow">
        <p className="text-ledger">A picture with a transferable key</p>
        <h1>The collectible is the file.</h1>
        <ol className="steps">
          <li>
            <h2>Mint a picture</h2>
            <p>
              Connect MetaMask and mint into your wallet. Your wallet signs the
              authorization and a sponsor submits it to ZVM. No separate ZFT
              password is needed.
            </p>
          </li>
          <li>
            <h2>Pass on the original file</h2>
            <p>
              Choose Make transferable file to move an item to a fresh file key.
              Save its recovery file before authorizing the move. The downloaded
              PNG carries that item’s key. Send it as an attachment. Screenshots
              and social media recompression remove transferability.
            </p>
          </li>
          <li>
            <h2>Receive into your wallet or a new file</h2>
            <p>
              The recipient rotates ownership on-chain. Earlier copies become
              stale. The sender can cancel by winning the same race.
            </p>
          </li>
        </ol>
        <p>
          File keys can stay in memory for this session, backed up in a
          downloaded recovery file. Optionally protect them with a password to
          remember them in this browser. Protected storage locks after 15
          minutes of inactivity. A downloaded recovery file is a secret backup;
          the browser password does not encrypt that download.
        </p>
        <p>
          Ownership history is public. This alpha runs on ZVM devnet, which can
          reset. No marketplace, payments, or mainnet assets are enabled.
        </p>
        <p>
          Confirmation means six subsequent EVM blocks under this app’s policy.
          Keep both old and new keys in recovery snapshots.
        </p>
      </section>
    );
  else if (routePath === "/" || routePath === "/explore")
    content = (
      <>
        {routePath === "/" && (
          <section className="hero">
            <div>
              <p className="eyebrow">
                <span className="live-dot" /> ZVM devnet · first implementation
              </p>
              <h1>
                The collectible
                <br />
                is <span>the file.</span>
              </h1>
              <p>
                Mint a picture. Keep it in your collection.
                <br />
                Pass the original file to someone else.
              </p>
              <div className="actions">
                <Link
                  className="nom-btn nom-btn--primary nom-btn--default"
                  to="/mint"
                >
                  Mint a picture
                </Link>
                <Link
                  className="nom-btn nom-btn--outline nom-btn--default"
                  to="/claim"
                >
                  Receive a file
                </Link>
              </div>
              <p className="hero-note text-ledger">
                Your wallet · transferable files · sponsored devnet gas
              </p>
            </div>
            <div className="hero-file">
              <img src={logo} alt="Zenon" />
              <span className="file-name mono">your-picture.zft.png</span>
              <span className="text-ledger">
                One image. A new way to pass it on.
              </span>
            </div>
          </section>
        )}
        <div className="section-heading">
          <div>
            <p className="text-ledger">Discover</p>
            {routePath === "/explore" ? (
              <h1>Explore the network.</h1>
            ) : (
              <h2>Fresh from the network</h2>
            )}
          </div>
          <span className="mono muted">{gallery.length} published</span>
        </div>
        <p className="index-status">
          {index?.error ||
            (index?.block
              ? `Indexed through block ${index.block.toLocaleString()} · ${index.lag} blocks behind head · six-block confirmation policy`
              : "Waiting for the chain index.")}
        </p>
        {gallery.length ? (
          <div className="gallery-grid">{gallery.map(itemCard)}</div>
        ) : (
          <div className="empty-state compact">
            <h2>A collection begins with one picture.</h2>
            <p>
              Confirmed mints appear here. There are no sample tokens in this
              app.
            </p>
          </div>
        )}
        {galleryCursor && (
          <Button
            disabled={!!busy}
            onClick={() =>
              act("Loading more collectibles", async () => {
                const r = await api<{
                  items: PublicItem[];
                  nextCursor: string | null;
                }>(`/api/gallery?cursor=${galleryCursor}`);
                setGallery((old) => [...old, ...r.items]);
                setGalleryCursor(r.nextCursor);
              })
            }
          >
            Load more
          </Button>
        )}
      </>
    );
  else
    content = (
      <section className="empty-state">
        <h1>Page not found.</h1>
        <p>This link does not point to a ZFT page.</p>
        <Link to="/explore">Explore collectibles →</Link>
      </section>
    );
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="network-bar">
        <span className="text-ledger">ZVM DEVNET</span>
        <span>
          {!deployment
            ? "Contract deployment pending"
            : !config
              ? "Connecting to devnet…"
              : ready
                ? "Alpha · real on-chain transactions"
                : "Alpha · sponsorship offline"}{" "}
          · Devnet can reset
        </span>
      </div>
      <header>
        <div className="header-inner">
          <Link to="/" className="wordmark">
            <img src={logo} alt="" />
            zft<span>.</span>
          </Link>
          <nav aria-label="Main navigation">
            <Link to="/explore">Explore</Link>
            <Link to="/activity">Activity</Link>
            <Link to="/about">How it works</Link>
          </nav>
          <div className="actions">
            <ThemeControl />
            <WalletControl
              onChange={setWalletSession}
              nav={nav}
              openRequest={connectRequest}
            />
            <button
              className="nom-btn nom-btn--outline nom-btn--default mobile-menu-button"
              aria-expanded={menuOpen}
              aria-controls="compact-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              Menu
            </button>
            <Link
              className="nom-btn nom-btn--outline nom-btn--default"
              to="/wallet"
            >
              My collection
            </Link>
            {unlocked && (
              <Button
                onClick={() => {
                  if (
                    !vault?.persistent &&
                    revisions.current !== revisions.backedUp
                  ) {
                    nav("/recovery");
                    setNotice(
                      "Save and confirm current recovery before ending this file session.",
                    );
                  } else lock();
                }}
                disabled={!!busy || walletBusy}
              >
                {vault?.persistent ? "Lock files" : "End file session"}
              </Button>
            )}
          </div>
        </div>
        {menuOpen && (
          <nav
            id="compact-navigation"
            className="compact-navigation"
            aria-label="Compact navigation"
          >
            <Link to="/">Home</Link>
            <Link to="/explore">Explore</Link>
            <Link to="/wallet">Wallet</Link>
            <Link to="/activity">Activity</Link>
            <Link to="/how-it-works">How it works</Link>
            <Link to="/mint">Mint a picture</Link>
            <Link to="/claim">Receive a file</Link>
            <Link to="/collection">My files</Link>
            <Link to="/recovery">Recovery</Link>
          </nav>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        <div className="messages" aria-live="polite">
          {busy && (
            <p className="callout" role="status">
              {busy}…
            </p>
          )}
          {error && (
            <p className="callout error" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="callout success">{notice}</p>}
        </div>
        {(walletSession || exists || unlocked) && (
          <div className="identity-bar">
            <label>
              Profile identity
              <select
                value={profileMode}
                disabled={!!busy || walletBusy}
                onChange={(e) =>
                  setProfileMode(e.target.value as "wallet" | "local")
                }
              >
                <option value="wallet">
                  Wallet
                  {walletSession
                    ? ` · ${short(walletSession.account)}`
                    : " · connect to use"}
                </option>
                <option value="local">
                  Local profile
                  {localProfile
                    ? ` · ${short(localProfile)}`
                    : " · unlock or restore"}
                </option>
              </select>
            </label>
            <Link to="/settings/profile">Edit profile</Link>
            <Link to="/collection">My files</Link>
            {identity && (
              <Link to={`/p/${profile}`}>View public profile ↗</Link>
            )}
            <span className="muted">
              Profiles stay separate. Switching does not move items or merge
              identities.
            </span>
          </div>
        )}
        {routePath === "/mint" && custodyChoice(mintMode, setMintMode)}
        {routePath === "/claim" && custodyChoice(claimMode, setClaimMode)}
        {content}
      </main>
      <footer>
        <Link to="/" className="wordmark">
          zft<span>.</span>
        </Link>
        <p>Pictures you can keep. Collectibles you can pass on.</p>
        <div className="actions">
          <ProfileLookup nav={nav} />
          <Link to="/recovery">Recovery</Link>
          <Link to="/activity">Activity</Link>
          <Link to="/about">How it works</Link>
          <a
            href="https://devnet.zenon.foo/explorer/"
            target="_blank"
            rel="noreferrer"
          >
            ZVM explorer ↗
          </a>
        </div>
        <p className="text-ledger">ZFT.FOO / ZVM DEVNET / ALPHA</p>
      </footer>
    </>
  );
}
const root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<App />);
