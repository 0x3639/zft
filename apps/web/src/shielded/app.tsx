import React, { useEffect, useRef, useState } from "react";
import { BrandLogo } from "../brand-logo";
import { ThemeControl } from "../site-controls";
import { inactivityLock } from "../inactivity";
import {
  createShieldedClient,
  connectWallet,
  type ShieldedClient,
  type Snapshot,
  type Provider,
} from "../../../../packages/shielded/client.mjs";
import { browserProver } from "./prover";
import { nextAction, savedStatus, stageDescription } from "./experience";
import "./style.css";
const btn = "nom-btn nom-btn--default nom-btn--outline";
const primary = btn + " nom-btn--primary";
const short = (s: string) => s.slice(0, 10) + "…" + s.slice(-6);
const pages = ["collection", "create", "claim", "recovery"] as const;
type Page = (typeof pages)[number];
const paths = (p: Page) =>
  p === "collection" ? "/shielded" : `/shielded/${p}`;
const labels = {
  collection: "My collection",
  create: "Create a ZFT",
  claim: "Receive",
  recovery: "Recover",
};
const currentPage = (): Page => {
  const p = location.pathname.split("/")[2] || "collection";
  return pages.includes(p as Page) ? (p as Page) : "collection";
};
async function bytes(file: File | undefined, max: number) {
  if (!file || file.size < 1 || file.size > max) throw Error("File bound");
  return new Uint8Array(await file.arrayBuffer());
}
async function text(file: File | undefined, max: number) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await bytes(file, max),
  );
}
type Picture = { name: string; url: string };
type Download = { name: string; url: string; label: string };
type TestHost = { configuration: string; brand: React.ReactNode };
export default function ShieldedApp({
  testHost,
}: { testHost?: TestHost } = {}) {
  const [page, setPage] = useState<Page>(currentPage),
    [state, setState] = useState<Snapshot>(),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(
      "Open your collection to see saved pictures and unfinished creations.",
    ),
    [error, setError] = useState(false),
    [ready, setReady] = useState(false),
    [account, setAccount] = useState(""),
    [configId, setConfigId] = useState(""),
    [pictures, setPictures] = useState<Record<string, Picture>>({}),
    [downloads, setDownloads] = useState<Download[]>([]),
    [composer, setComposer] = useState(true),
    [passwordLength, setPasswordLength] = useState(0),
    [passwordVisible, setPasswordVisible] = useState(false);
  const sdk = useRef<ShieldedClient | undefined>(undefined),
    generation = useRef(0),
    running = useRef(false),
    password = useRef<HTMLInputElement>(null),
    file = useRef<HTMLInputElement>(null),
    title = useRef<HTMLInputElement>(null),
    description = useRef<HTMLTextAreaElement>(null),
    form = useRef<HTMLDivElement>(null),
    urls = useRef(new Map<string, string>()),
    pictureUrls = useRef(new Map<string, string>()),
    selectedPanel = useRef<HTMLElement>(null);
  const pass = () => password.current?.value ?? "";
  const tell = (message: string) => {
    setError(false);
    setNotice(message);
  };
  function clearExports() {
    urls.current.forEach(URL.revokeObjectURL);
    urls.current.clear();
    setDownloads([]);
  }
  function showPicture(p: { id: string; name: string; image: Uint8Array }) {
    const old = pictureUrls.current.get(p.id);
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(p.image)], { type: "image/png" }),
    );
    pictureUrls.current.set(p.id, url);
    setPictures((v) => ({ ...v, [p.id]: { name: p.name, url } }));
  }
  function lock() {
    generation.current++;
    sdk.current?.close();
    sdk.current = undefined;
    running.current = false;
    setReady(false);
    setState(undefined);
    setBusy("");
    setAccount("");
    setConfigId("");
    setComposer(true);
    clearExports();
    pictureUrls.current.forEach(URL.revokeObjectURL);
    pictureUrls.current.clear();
    setPictures({});
    if (password.current) {
      password.current.value = "";
      password.current.type = "password";
    }
    setPasswordLength(0);
    setPasswordVisible(false);
    form.current
      ?.querySelectorAll<HTMLInputElement>(
        "input[type=password],input[type=file]",
      )
      .forEach((i) => {
        i.value = "";
      });
    tell(
      "Locked. Your saved pictures remain encrypted in this browser. Open the collection and enter your password to find them again.",
    );
  }
  useEffect(() => {
    const pop = () => {
        setPage(currentPage());
        setComposer(true);
      },
      hide = () => lock();
    window.addEventListener("popstate", pop);
    window.addEventListener("pagehide", hide);
    const stop = inactivityLock(window, lock, () => running.current);
    return () => {
      stop();
      window.removeEventListener("popstate", pop);
      window.removeEventListener("pagehide", hide);
      generation.current++;
      sdk.current?.close();
      urls.current.forEach(URL.revokeObjectURL);
      pictureUrls.current.forEach(URL.revokeObjectURL);
    };
  }, []);
  function nav(next: Page) {
    history.pushState({}, "", paths(next));
    setPage(next);
    setComposer(true);
    window.scrollTo(0, 0);
  }
  async function refresh() {
    const c = sdk.current,
      g = generation.current;
    if (!c) return;
    const s = await c.snapshot();
    if (g !== generation.current) return;
    setState(s);
    if (s.selected) showPicture(s.selected);
  }
  async function run(
    label: string,
    action: (alive: () => boolean) => Promise<void>,
  ) {
    if (running.current) return;
    const g = generation.current,
      alive = () => g === generation.current;
    running.current = true;
    setBusy(label);
    setError(false);
    try {
      await action(alive);
    } catch {
      if (alive()) {
        setError(true);
        setNotice(
          `${label} could not finish. Your saved pictures have not been deleted. Check your connection, password, selected file and wallet network. If you submitted a transaction, check its status before retrying.`,
        );
      }
    } finally {
      if (alive()) {
        running.current = false;
        setBusy("");
        await refresh().catch(() => {
          if (alive()) {
            setError(true);
            setNotice(
              "Could not refresh your collection. Keep your recovery files and try opening it again.",
            );
          }
        });
      }
    }
  }
  async function selectDeployment(
    configuration: string | Promise<string>,
    alive: () => boolean,
  ) {
    const value = await configuration;
    if (!alive()) return;
    const c = await createShieldedClient({
      text: value,
      origin: location.origin,
      prover: browserProver(),
    });
    if (!alive()) {
      c.close();
      return;
    }
    sdk.current = c;
    setConfigId(c.configurationId);
    setReady(true);
    tell(
      "Collection opened. Enter your recovery password to unlock saved pictures, or start a new ZFT.",
    );
  }
  function save(
    value: string | Uint8Array,
    type: string,
    name: string,
    label: string,
  ) {
    const old = urls.current.get(name);
    if (old) URL.revokeObjectURL(old);
    const blob =
      typeof value === "string"
        ? new Blob([value], { type })
        : new Blob([new Uint8Array(value)], { type });
    const url = URL.createObjectURL(blob);
    urls.current.set(name, url);
    setDownloads((ds) => [
      ...ds.filter((d) => d.name !== name),
      { name, url, label },
    ]);
  }
  async function prepareRecovery(c: ShieldedClient, alive: () => boolean) {
    const [exported, s] = await Promise.all([c.exportRecovery(), c.snapshot()]);
    if (!alive() || !s.selected) return;
    save(
      exported,
      "application/json",
      `zft-recovery-${s.selected.id.slice(2, 10)}.json`,
      "Save recovery file",
    );
  }
  async function checkStatus(alive: () => boolean) {
    const result = await sdk.current!.observe(pass());
    if (!alive()) return;
    tell(
      result === "observed"
        ? "Your ZFT was found on devnet. Find it in My collection below."
        : result === "unobserved"
          ? "Status checked. Follow the next step for this saved picture."
          : `Status checked: ${savedStatus(result)}.`,
    );
  }
  const selected = state?.selected,
    next = selected && nextAction(selected),
    viewing =
      !!selected && (!(page === "create" || page === "claim") || !composer),
    backup = downloads.find((d) => d.name.startsWith("zft-recovery-")),
    needsPassword = passwordLength < 12,
    progress = selected?.creationProgress,
    canProve =
      !!selected?.acknowledged &&
      !selected.needsObservation &&
      ["prepared", "unobserved"].includes(selected.state) &&
      !["waiting", "expired"].includes(progress?.phase ?? ""),
    completed =
      state?.operations.filter((r) => r.state === "observed").length ?? 0;
  useEffect(() => {
    if (viewing) selectedPanel.current?.scrollIntoView({ block: "start" });
  }, [selected?.id, next, viewing]);
  return (
    <div className="shielded-app" ref={form}>
      <a className="skip-link" href="#shielded-main">
        Skip to content
      </a>
      <div className="network-bar">
        <span className="text-ledger">ZVM DEVNET · TEST ASSETS ONLY</span>
        <span>Your picture. Your keys.</span>
      </div>
      <header>
        <div className="header-inner">
          <a href={testHost ? "/shielded" : "/"} className="wordmark">
            {testHost?.brand ?? <BrandLogo />}
          </a>
          <nav aria-label="Shielded navigation">
            {pages.map((p) => (
              <a
                key={p}
                href={paths(p)}
                className={btn}
                aria-current={page === p ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  nav(p);
                }}
              >
                {labels[p]}
              </a>
            ))}
          </nav>
          <div className="actions">
            <ThemeControl />
            <button className={btn} onClick={lock}>
              Lock
            </button>
          </div>
        </div>
      </header>
      <main id="shielded-main" tabIndex={-1}>
        <section className="shielded-intro">
          <p className="text-ledger">ZFT / YOUR PICTURE. YOUR KEYS.</p>
          <h1>
            {
              {
                collection: "My collection",
                create: "Create a ZFT",
                claim: "Receive a ZFT",
                recovery: "Find your saved ZFT",
              }[page]
            }
          </h1>
          <p>
            {page === "collection"
              ? "Your pictures and unfinished creations live here, in this browser. Unlock them with your recovery password."
              : page === "create"
                ? "Choose a picture, save your recovery file, then approve two devnet transactions. We’ll guide you through each step."
                : page === "claim"
                  ? "Open the original bearer picture you received and claim it into a fresh secret held by you."
                  : "Use the same browser and password, or restore an encrypted recovery file. Your MetaMask account alone cannot recover a shielded picture."}
          </p>
          <p className="hint">
            Shielded ZFTs appear here, not in the older public gallery or
            MetaMask’s NFT list. Your wallet pays fees; your saved keys control
            the picture.
          </p>
        </section>
        <section className="shielded-connection" aria-label="Open collection">
          <h2>
            {ready ? "Collection connected" : "1. Open your devnet collection"}
          </h2>
          {testHost ? (
            <button
              className={primary}
              disabled={!!busy || ready}
              onClick={() =>
                void run("Opening collection", (alive) =>
                  selectDeployment(testHost.configuration, alive),
                )
              }
            >
              {ready ? "ZVM devnet connected" : "Open my collection"}
            </button>
          ) : (
            <label>
              Deployment configuration
              <input
                aria-label="Selected deployment configuration"
                type="file"
                accept=".json"
                disabled={!!busy || ready}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  void run("Opening collection", (alive) =>
                    selectDeployment(text(f, 16384), alive),
                  );
                  e.currentTarget.value = "";
                }}
              />
            </label>
          )}
          <p>
            {ready
              ? `${state?.operations.length ?? 0} saved item(s) in this browser. ${completed} last observed on devnet.`
              : "This checks the selected contracts and opens this browser’s encrypted collection. It does not connect a wallet or send a transaction."}
          </p>
          {ready && (
            <details>
              <summary>Network details</summary>
              <p className="shielded-hash">
                Configuration {configId}
                <br />
                Chain {sdk.current?.config.pins.chainId} · Registry{" "}
                {sdk.current?.config.pins.contracts.registry.address}
              </p>
              {testHost && (
                <a
                  href="/shielded/config.json"
                  download="zft-devnet-config.json"
                >
                  Save public configuration
                </a>
              )}
              <p>Checked RPC data is not an independent finality guarantee.</p>
            </details>
          )}
        </section>
        <section className="shielded-card" aria-label="Unlock pictures">
          <h2>
            {page === "create" || page === "claim"
              ? "Your recovery password"
              : "2. Unlock your pictures"}
          </h2>
          <p>
            Use the password you chose when saving this picture. Different
            passwords can unlock different items. Keep it separately from your
            recovery file.
          </p>
          <div className="shielded-password">
            <label>
              Recovery password
              <input
                ref={password}
                type={passwordVisible ? "text" : "password"}
                minLength={12}
                maxLength={1024}
                autoComplete="off"
                placeholder="At least 12 characters"
                disabled={!!busy}
                onChange={(e) =>
                  setPasswordLength(e.currentTarget.value.length)
                }
              />
            </label>
            <button
              className={btn}
              disabled={!!busy}
              aria-pressed={passwordVisible}
              onClick={() => setPasswordVisible((v) => !v)}
            >
              {passwordVisible ? "Hide password" : "Show password"}
            </button>
            {(page === "create" || page === "claim") && composer && (
              <button
                className={btn}
                disabled={!!busy}
                onClick={() => {
                  if (password.current) {
                    password.current.value = Array.from(
                      crypto.getRandomValues(new Uint8Array(24)),
                      (b) => b.toString(16).padStart(2, "0"),
                    ).join("");
                    setPasswordLength(48);
                  }
                  tell(
                    "New password generated. Show it and store it safely before continuing. Existing pictures still need their original passwords.",
                  );
                }}
              >
                Generate a new password
              </button>
            )}
          </div>
          <button
            className={primary}
            disabled={
              !ready || !!busy || needsPassword || !state?.operations.length
            }
            onClick={() =>
              void run("Unlocking pictures", async (alive) => {
                const c = sdk.current!,
                  rows = (await c.snapshot()).operations;
                let opened = 0;
                for (const r of rows) {
                  if (!alive()) return;
                  try {
                    const p = await c.inspect(r.id, pass());
                    if (!alive()) return;
                    showPicture(p);
                    opened++;
                  } catch {
                    if (!alive()) return;
                  }
                }
                if (alive())
                  tell(
                    `${opened} picture(s) unlocked. ${rows.length - opened} remain locked or could not be opened. No transactions were sent.`,
                  );
              })
            }
          >
            Unlock saved pictures
          </button>
        </section>
        <p
          className={`callout${error ? " error" : ""}`}
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          {busy ? `${busy}…` : notice}
        </p>
        {page === "collection" && (
          <section className="shielded-card" aria-label="Your saved pictures">
            <div className="shielded-section-heading">
              <h2>Your pictures</h2>
              <a
                className={primary}
                href="/shielded/create"
                onClick={(e) => {
                  e.preventDefault();
                  nav("create");
                }}
              >
                Create a ZFT
              </a>
            </div>
            {!ready ? (
              <p>Open your collection above to look for saved pictures.</p>
            ) : !state?.operations.length ? (
              <div className="shielded-empty">
                <h3>No pictures saved in this browser yet</h3>
                <p>
                  If you created one elsewhere, open that same browser or
                  restore its recovery file. Don’t create a replacement just
                  because this list is empty.
                </p>
                <a
                  href="/shielded/recovery"
                  onClick={(e) => {
                    e.preventDefault();
                    nav("recovery");
                  }}
                >
                  Find or recover a ZFT
                </a>
                <p>
                  <a href="/wallet">Check the older wallet collection</a> if you
                  used the original Mint page.
                </p>
              </div>
            ) : (
              <>
                <p>
                  Titles and previews stay hidden until you unlock them. Status
                  badges show the last saved observation; open a picture to
                  check its current status.
                </p>
                <div className="shielded-gallery">
                  {state.operations.map((r, i) => (
                    <article key={r.id} className="shielded-picture">
                      {pictures[r.id] ? (
                        <img
                          src={pictures[r.id].url}
                          alt={pictures[r.id].name}
                        />
                      ) : (
                        <div className="shielded-locked" aria-hidden="true">
                          Locked picture
                        </div>
                      )}
                      <h3>
                        {pictures[r.id]?.name || `Saved picture ${i + 1}`}
                      </h3>
                      <p className="shielded-badge">{savedStatus(r.state)}</p>
                      <p className="hint">Reference {short(r.id)}</p>
                      <button
                        className={r.id === selected?.id ? primary : btn}
                        disabled={!!busy || needsPassword}
                        onClick={() =>
                          void run("Opening saved picture", async (alive) => {
                            clearExports();
                            await sdk.current!.unlock(r.id, pass());
                            if (!alive()) return;
                            setComposer(false);
                            tell(
                              "Picture opened. Check its current devnet status to continue safely.",
                            );
                            selectedPanel.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          })
                        }
                      >
                        {pictures[r.id] ? "Open picture" : "Unlock picture"}
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {ready &&
          (page === "create" ||
            page === "claim" ||
            (viewing && !["complete", "history"].includes(next ?? ""))) && (
            <section className="shielded-card" aria-label="Fee wallet">
              <h2>Fee wallet</h2>
              <p>
                Connect MetaMask on the selected devnet for public creation
                signatures and transaction fees. Your spending keys remain in
                this browser and your recovery files.
              </p>
              <button
                className={btn}
                disabled={!!busy}
                onClick={() =>
                  void run("Connecting fee wallet", async (alive) => {
                    const provider = (
                      window as unknown as { ethereum?: Provider }
                    ).ethereum;
                    if (!provider) throw Error("No wallet");
                    const c = sdk.current!,
                      w = await connectWallet(provider, c.config.pins);
                    if (!alive()) {
                      w.close();
                      return;
                    }
                    c.setWallet(w);
                    setAccount(w.address);
                    tell(
                      "Fee wallet connected. It pays fees; your recovery password unlocks your pictures.",
                    );
                  })
                }
              >
                {account ? `Reconnect ${short(account)}` : "Connect MetaMask"}
              </button>
            </section>
          )}
        {(page === "create" || page === "claim") && composer && (
          <section className="shielded-card">
            <h2>
              {page === "create"
                ? "Choose your picture"
                : "Open the picture you received"}
            </h2>
            <label>
              {page === "create" ? "Image" : "Bearer picture"}
              <input
                key={page}
                ref={file}
                type="file"
                accept={
                  page === "create" ? "image/png,image/jpeg" : "image/png"
                }
                disabled={!ready || !!busy}
              />
            </label>
            {page === "create" && (
              <>
                <label>
                  Name
                  <input ref={title} maxLength={256} disabled={!!busy} />
                </label>
                <label>
                  Description
                  <textarea
                    ref={description}
                    maxLength={4096}
                    rows={3}
                    disabled={!!busy}
                  />
                </label>
              </>
            )}
            <p>
              This saves a draft and recovery file first. It does not finish
              creation or receipt on devnet.
            </p>
            <button
              className={primary}
              disabled={
                !ready ||
                !!busy ||
                needsPassword ||
                (page === "create" && !account)
              }
              onClick={() =>
                void run("Saving picture draft", async (alive) => {
                  clearExports();
                  const c = sdk.current!;
                  if (page === "create")
                    await c.prepareCreate(
                      await bytes(file.current?.files?.[0], 10 * 1024 * 1024),
                      title.current?.value ?? "",
                      description.current?.value ?? "",
                      pass(),
                    );
                  else
                    await c.prepareClaim(
                      await bytes(file.current?.files?.[0], 11 * 1024 * 1024),
                      pass(),
                    );
                  if (!alive()) return;
                  setComposer(false);
                  await prepareRecovery(c, alive);
                  if (alive())
                    tell(
                      "Draft saved. Next, download the recovery file and select that saved file. Your ZFT is not on devnet yet.",
                    );
                })
              }
            >
              Save draft and prepare recovery
            </button>
            {!ready && <p>Open your collection first.</p>}
            {needsPassword && (
              <p>Enter or generate a recovery password above.</p>
            )}
            {page === "create" && !account && (
              <p>
                Connect your fee wallet above to sign the picture’s public
                creation details.
              </p>
            )}
          </section>
        )}
        {page === "recovery" && (
          <section className="shielded-card">
            <h2>Restore a recovery file</h2>
            <p>
              Enter its original password above, then select the encrypted JSON
              file. This restores the same picture and destination, not a
              replacement.
            </p>
            <input
              aria-label="Encrypted recovery file"
              type="file"
              accept=".json"
              disabled={!ready || !!busy || needsPassword}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                void run("Restoring picture", async (alive) => {
                  clearExports();
                  await sdk.current!.restore(
                    await text(f, 21 * 1024 * 1024),
                    pass(),
                  );
                  if (!alive()) return;
                  nav("collection");
                  setComposer(false);
                  tell(
                    "Picture restored to My collection. Check devnet status below before retrying a transaction.",
                  );
                });
                e.currentTarget.value = "";
              }}
            />
            <p>
              No recovery file? Your item may still be saved in the browser
              where you created it. Open My collection there. If you used the
              old Mint page, check{" "}
              <a href="/wallet">the older wallet collection</a>.
            </p>
          </section>
        )}
        {viewing && selected && (
          <section
            className="shielded-card shielded-selected"
            ref={selectedPanel}
            aria-label="Selected picture"
          >
            <div className="shielded-result">
              {pictures[selected.id] && (
                <img src={pictures[selected.id].url} alt={selected.name} />
              )}
              <div>
                <p className="text-ledger">
                  {selected.kind === "create" ? "YOUR CREATION" : "YOUR CLAIM"}
                </p>
                <h2>{selected.name}</h2>
                <p className="shielded-badge">{savedStatus(selected.state)}</p>
                <p>{stageDescription(selected)}</p>
              </div>
            </div>
            <ol className="shielded-steps" aria-label="Creation progress">
              <li data-done="true">Picture saved</li>
              <li data-done={selected.acknowledged}>Recovery verified</li>
              <li
                data-done={
                  progress?.phase === "waiting" ||
                  progress?.phase === "reveal" ||
                  next === "complete"
                }
              >
                {selected.kind === "create"
                  ? "1. Reserve on devnet"
                  : "Submit claim"}
              </li>
              <li data-done={next === "complete"}>
                {selected.kind === "create"
                  ? "2. Finish creation"
                  : "Check claim"}
              </li>
            </ol>
            {next === "backup" && (
              <div className="shielded-next">
                <h3>Next: save your recovery file</h3>
                <p>
                  1. Save this file. 2. Select the file you just saved. Your
                  password is required to use it later.
                </p>
                {backup ? (
                  <a
                    className={primary}
                    href={backup.url}
                    download={backup.name}
                  >
                    Save recovery file
                  </a>
                ) : (
                  <button
                    className={primary}
                    disabled={!!busy}
                    onClick={() =>
                      void run("Preparing recovery file", (alive) =>
                        prepareRecovery(sdk.current!, alive),
                      )
                    }
                  >
                    Prepare recovery download
                  </button>
                )}
                <label>
                  Select the saved recovery file
                  <input
                    aria-label="Select the saved recovery file"
                    type="file"
                    accept=".json"
                    disabled={!!busy || needsPassword}
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      void run("Checking saved recovery", async (alive) => {
                        await sdk.current!.acknowledge(
                          await text(f, 21 * 1024 * 1024),
                          pass(),
                        );
                        if (alive())
                          tell(
                            "Recovery file verified. Continue with the next step below.",
                          );
                      });
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            )}
            {(next === "check" || next === "wait") && (
              <div className="shielded-next">
                <h3>
                  {next === "check"
                    ? "Next: check transaction status"
                    : "Next: wait, then check progress"}
                </h3>
                <button
                  className={primary}
                  disabled={!!busy || needsPassword}
                  onClick={() =>
                    void run("Checking devnet status", checkStatus)
                  }
                >
                  Check devnet status
                </button>
                <p>No wallet approval or fee is needed to check.</p>
              </div>
            )}
            {next === "prove" && (
              <div className="shielded-next">
                <h3>
                  Next: prepare{" "}
                  {selected.kind === "create"
                    ? progress?.phase === "reveal"
                      ? "transaction 2 of 2"
                      : "transaction 1 of 2"
                    : "your claim"}
                </h3>
                <p>
                  Your browser generates a proof locally. Keep this tab open; no
                  transaction is sent yet.
                </p>
                <button
                  className={primary}
                  disabled={!!busy || !canProve}
                  onClick={() =>
                    void run("Preparing proof", async (alive) => {
                      await sdk.current!.prove();
                      if (alive())
                        tell(
                          "Proof ready. Continue with the clearly labelled wallet transaction below.",
                        );
                    })
                  }
                >
                  Prepare transaction proof
                </button>
              </div>
            )}
            {busy === "Preparing proof" && (
              <button
                className={btn}
                onClick={() => sdk.current?.cancelProof()}
              >
                Cancel proof
              </button>
            )}
            {next === "submit" && (
              <div className="shielded-next">
                <h3>Next: approve in your fee wallet</h3>
                <p>
                  {selected.kind === "create"
                    ? progress?.phase === "reveal"
                      ? "This second transaction finishes creation."
                      : "This first transaction reserves the picture. It will not appear as created yet."
                    : "This transaction claims the picture into your new secret."}
                </p>
                <button
                  className={primary}
                  disabled={!!busy || !canProve || !account || needsPassword}
                  onClick={() =>
                    void run("Submitting transaction", async (alive) => {
                      const r = await sdk.current!.submit(pass());
                      if (!alive()) return;
                      if (r.state === "observed") {
                        nav("collection");
                        setComposer(false);
                        tell(
                          "Your ZFT was observed on devnet and is in My collection. Keep your recovery file.",
                        );
                      } else
                        tell(
                          r.phase === "committed"
                            ? "Transaction 1 of 2 recorded. Wait for two devnet blocks, then check progress to finish creation."
                            : "Transaction returned. Check devnet status before attempting another submission.",
                        );
                    })
                  }
                >
                  {selected.kind === "create"
                    ? progress?.phase === "reveal"
                      ? "2. Finish creating ZFT"
                      : "1. Reserve ZFT on devnet"
                    : "Claim ZFT on devnet"}
                </button>
                {!account && <p>Connect your fee wallet above to continue.</p>}
              </div>
            )}
            {next === "renew" && (
              <button
                className={primary}
                disabled={!!busy || !account || needsPassword}
                onClick={() =>
                  void run("Renewing creation permission", async (alive) => {
                    clearExports();
                    await sdk.current!.renewCreation(pass());
                    if (!alive()) return;
                    await prepareRecovery(sdk.current!, alive);
                    if (alive())
                      tell(
                        "Permission renewed for the same picture. Save its updated recovery file before continuing.",
                      );
                  })
                }
              >
                Renew permission for this picture
              </button>
            )}
            {next === "complete" && (
              <div className="shielded-next">
                <h3>Your ZFT is in My collection</h3>
                <p>
                  Return here using this browser and your recovery password. A
                  public image is safe to share; the bearer picture gives its
                  holder the ability to claim your ZFT.
                </p>
                <div className="actions">
                  <button
                    className={primary}
                    disabled={!!busy}
                    onClick={() =>
                      void run("Preparing public image", async (alive) => {
                        const data = await sdk.current!.exportPublic();
                        if (alive())
                          save(
                            data,
                            "image/png",
                            `zft-public-${selected.imageHash.slice(2, 10)}.png`,
                            "Save public picture",
                          );
                      })
                    }
                  >
                    Save a public picture
                  </button>
                  <button
                    className={btn}
                    disabled={!!busy || needsPassword}
                    onClick={() =>
                      void run(
                        "Preparing transferable picture",
                        async (alive) => {
                          const data = await sdk.current!.exportBearer(pass());
                          if (alive())
                            save(
                              data,
                              "image/png",
                              `zft-bearer-${selected.assetId.slice(2, 10)}.png`,
                              "Save transferable bearer picture",
                            );
                        },
                      )
                    }
                  >
                    Prepare picture to send
                  </button>
                </div>
              </div>
            )}
            <details>
              <summary>
                Recovery, transaction history and technical details
              </summary>
              <p className="shielded-hash">
                Reference {selected.id}
                <br />
                Asset {selected.assetId}
                <br />
                Image SHA-256 {selected.imageHash}
              </p>
              <div className="actions">
                <button
                  className={btn}
                  disabled={!!busy}
                  onClick={() =>
                    void run("Preparing recovery file", (alive) =>
                      prepareRecovery(sdk.current!, alive),
                    )
                  }
                >
                  Prepare recovery download
                </button>
                <button
                  className={btn}
                  disabled={!!busy || needsPassword}
                  onClick={() =>
                    void run("Checking devnet status", checkStatus)
                  }
                >
                  Check devnet status again
                </button>
              </div>
              {(
                state?.operations.find((r) => r.id === selected.id)
                  ?.transactionHashes ?? []
              ).map((h) => (
                <p key={h} className="shielded-hash">
                  Transaction {h}
                </p>
              ))}
              <p>
                Old recovery copies can race. A checked RPC observation does not
                prove finality. Cancelling a proof cannot cancel a sent
                transaction.
              </p>
            </details>
            <a
              href="/shielded"
              onClick={(e) => {
                e.preventDefault();
                nav("collection");
              }}
            >
              View all my pictures
            </a>
          </section>
        )}
        {downloads.length > 0 && (
          <section className="shielded-card" aria-label="Prepared downloads">
            <h2>Files ready to save</h2>
            {downloads.map((d) => (
              <a key={d.name} href={d.url} download={d.name}>
                {d.label} · {d.name}
              </a>
            ))}
            <p>
              These links last for this unlocked session. Saved files remain on
              your device.
            </p>
          </section>
        )}
        <aside className="shielded-help">
          <h2>Can’t find a ZFT you created?</h2>
          <p>
            Open this page in the same browser and enter its recovery password.
            A saved draft still needs the steps above before it is created on
            devnet.
          </p>
          <div className="actions">
            <a
              href="/shielded/recovery"
              onClick={(e) => {
                e.preventDefault();
                nav("recovery");
              }}
            >
              Restore from a recovery file
            </a>
            <a href="/wallet">Check older wallet ZFTs</a>
            <a href="/collection">Check older file ZFTs</a>
          </div>
        </aside>
      </main>
      <footer>
        {testHost?.brand ?? <BrandLogo />}
        <p>
          Experimental devnet. Independent review and device acceptance remain
          open. Public artwork and fee accounts can identify activity.
        </p>
        <a href="/">Public gallery and older app</a>
      </footer>
    </div>
  );
}
