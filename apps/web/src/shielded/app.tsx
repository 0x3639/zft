import React, { useEffect, useRef, useState } from "react";
import { BrandLogo } from "../brand-logo";
import { ThemeControl } from "../site-controls";
import { inactivityLock } from "../inactivity";
import {
  createShieldedClient,
  connectWallet,
  MESSAGES,
  type ShieldedClient,
  type Snapshot,
  type Provider,
} from "../../../../packages/shielded/client.mjs";
import { browserProver } from "./prover";
import "./style.css";
const btn = "nom-btn nom-btn--default nom-btn--outline";
const short = (s: string) => s.slice(0, 10) + "…" + s.slice(-6);
const pages = ["collection", "create", "claim", "recovery"] as const;
type Page = (typeof pages)[number];
const currentPage = (): Page => {
  const value = location.pathname.split("/")[2] || "collection";
  return pages.includes(value as Page) ? (value as Page) : "collection";
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
type TestHost = { configuration: string; brand: React.ReactNode };
export default function ShieldedApp({
  testHost,
}: { testHost?: TestHost } = {}) {
  const [page, setPage] = useState<Page>(currentPage),
    [state, setState] = useState<Snapshot>(),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(
      "Open your selected deployment configuration to begin.",
    ),
    [ready, setReady] = useState(false),
    [account, setAccount] = useState(""),
    [configId, setConfigId] = useState(""),
    [preview, setPreview] = useState("");
  const [downloads, setDownloads] = useState<{ name: string; url: string }[]>(
    [],
  );
  const sdk = useRef<ShieldedClient | undefined>(undefined),
    generation = useRef(0),
    running = useRef(false),
    password = useRef<HTMLInputElement>(null),
    file = useRef<HTMLInputElement>(null),
    title = useRef<HTMLInputElement>(null),
    description = useRef<HTMLTextAreaElement>(null),
    form = useRef<HTMLDivElement>(null),
    urls = useRef<Map<string, string>>(new Map()),
    previewUrl = useRef("");
  const pass = () => password.current?.value ?? "";
  function clearExports() {
    urls.current.forEach(URL.revokeObjectURL);
    urls.current.clear();
    setDownloads([]);
  }
  function clearPreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = "";
    setPreview("");
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
    clearExports();
    clearPreview();
    if (password.current) {
      password.current.value = "";
      password.current.type = "password";
    }
    form.current
      ?.querySelectorAll<HTMLInputElement>(
        "input[type=password],input[type=file]",
      )
      .forEach((i) => {
        i.value = "";
      });
    setNotice(
      "Session locked. Encrypted recovery remains in this browser and your saved files.",
    );
  }
  useEffect(() => {
    const pop = () => setPage(currentPage()),
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
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);
  async function selectDeployment(configuration: string | Promise<string>) {
    const g = generation.current;
    const selectedText = await configuration;
    if (g !== generation.current) return;
    const c = await createShieldedClient({
      text: selectedText,
      origin: location.origin,
      prover: browserProver(),
    });
    if (g !== generation.current) {
      c.close();
      return;
    }
    sdk.current = c;
    setConfigId(c.configurationId);
    setReady(true);
    setNotice(
      "Configuration and deployed code checked. This RPC observation is not a finality guarantee.",
    );
  }
  async function refresh() {
    const c = sdk.current;
    if (!c) return;
    const g = generation.current,
      s = await c.snapshot();
    if (g !== generation.current) return;
    setState(s);
    clearPreview();
    if (s.selected) {
      previewUrl.current = URL.createObjectURL(
        new Blob([new Uint8Array(s.selected.image)], { type: "image/png" }),
      );
      setPreview(previewUrl.current);
    }
  }
  async function run(label: string, action: () => Promise<void>) {
    if (running.current) return;
    const g = generation.current;
    running.current = true;
    setBusy(label);
    try {
      await action();
    } catch {
      if (g === generation.current) setNotice(MESSAGES.unavailable);
    } finally {
      if (g === generation.current) {
        running.current = false;
        setBusy("");
        await refresh().catch(() => setNotice(MESSAGES.unavailable));
      }
    }
  }
  function save(value: string | Uint8Array, type: string, name: string) {
    const blob =
      typeof value === "string"
        ? new Blob([value], { type })
        : new Blob([new Uint8Array(value)], { type });
    const url = URL.createObjectURL(blob);
    const previous = urls.current.get(name);
    if (previous) URL.revokeObjectURL(previous);
    urls.current.set(name, url);
    setDownloads((d) => [...d.filter((x) => x.name !== name), { name, url }]);
    setNotice(
      "Use the save link below. A recovery file must be selected again before submission.",
    );
  }
  function nav(next: Page) {
    history.pushState(
      {},
      "",
      next === "collection" ? "/shielded" : `/shielded/${next}`,
    );
    setPage(next);
    window.scrollTo(0, 0);
  }
  const selected = state?.selected,
    mayProve =
      !!selected?.acknowledged &&
      !selected.needsObservation &&
      ["prepared", "unobserved"].includes(selected.state);
  return (
    <div className="shielded-app" ref={form}>
      <a className="skip-link" href="#shielded-main">
        Skip to content
      </a>
      <div className="network-bar">
        <span className="text-ledger">SHIELDED / EXPERIMENTAL</span>
        <span>
          {testHost
            ? "ZVM devnet · disposable test assets only"
            : "User-held keys · selected test deployment"}
        </span>
      </div>
      <header>
        <div className="header-inner">
          <a href={testHost ? "/shielded" : "/"} className="wordmark">
            {testHost?.brand ?? <BrandLogo />}
          </a>
          <nav aria-label="Shielded navigation">
            {pages.map((p) => (
              <button
                key={p}
                className={btn}
                aria-current={page === p ? "page" : undefined}
                onClick={() => nav(p)}
              >
                {
                  {
                    collection: "Collection",
                    create: "Create",
                    claim: "Receive",
                    recovery: "Recovery",
                  }[p]
                }
              </button>
            ))}
          </nav>
          <div className="actions">
            <ThemeControl />
            <button className={btn} onClick={lock}>
              Lock
            </button>
            {!testHost && (
              <a href="/" className={btn}>
                Public v1
              </a>
            )}
          </div>
        </div>
      </header>
      <main id="shielded-main" tabIndex={-1}>
        <section className="shielded-intro">
          <p className="text-ledger">ZFT / YOUR PICTURE. YOUR KEYS.</p>
          <h1>
            {
              {
                collection: "Your shielded collection",
                create: "Create a shielded picture",
                claim: "Receive a picture",
                recovery: "Recover your saved operation",
              }[page]
            }
          </h1>
          <p>
            Spending secrets stay on your device and in your recovery files.
            Your wallet pays transaction fees and signs public creation details.
          </p>
        </section>
        <section
          className="shielded-connection"
          aria-label="Deployment and wallet"
        >
          {testHost ? (
            <div>
              <p>
                Use the selected ZVM devnet contracts. Your wallet pays test
                fees; spending secrets remain on this device.
              </p>
              <button
                className={btn}
                disabled={!!busy || ready}
                onClick={() =>
                  void run("Checking deployment", () =>
                    selectDeployment(testHost.configuration),
                  )
                }
              >
                Use ZVM devnet
              </button>
              <a
                className={btn}
                href="/shielded/config.json"
                download="zft-devnet-config.json"
              >
                Save public configuration
              </a>
            </div>
          ) : (
            <label>
              Selected deployment configuration
              <input
                aria-label="Selected deployment configuration"
                type="file"
                accept=".json"
                disabled={!!busy || ready}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  void run("Checking deployment", () =>
                    selectDeployment(text(f, 16384)),
                  );
                  e.currentTarget.value = "";
                }}
              />
            </label>
          )}
          {ready && (
            <>
              <p className="shielded-hash">
                Configuration {configId}
                <br />
                Chain {sdk.current?.config.pins.chainId} · Registry{" "}
                {sdk.current?.config.pins.contracts.registry.address}
              </p>
              <button
                className={btn}
                disabled={!!busy}
                onClick={() =>
                  void run("Connecting fee wallet", async () => {
                    const provider = (
                      window as unknown as { ethereum?: Provider }
                    ).ethereum;
                    if (!provider) throw Error("No wallet");
                    const c = sdk.current!,
                      g = generation.current,
                      w = await connectWallet(provider, c.config.pins);
                    if (g !== generation.current) {
                      w.close();
                      return;
                    }
                    c.setWallet(w);
                    setAccount(w.address);
                    setNotice(
                      "Fee wallet connected. Its public account may link transactions. Spending keys remain separate.",
                    );
                  })
                }
              >
                {account ? `Reconnect ${short(account)}` : "Connect fee wallet"}
              </button>
            </>
          )}
          <p className="hint">
            {testHost
              ? "This host selects only ZVM devnet. Keep the public configuration to verify the deployment and proof files."
              : "Use configuration and artifact hashes from a source you trust. No deployment is selected automatically. Lock before changing it."}
          </p>
        </section>
        <div className="shielded-password">
          <label>
            Recovery password
            <input
              ref={password}
              type="password"
              minLength={12}
              maxLength={1024}
              autoComplete="new-password"
              placeholder="12–1024 characters"
              disabled={!!busy}
            />
          </label>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() => {
              if (password.current)
                password.current.value = Array.from(
                  crypto.getRandomValues(new Uint8Array(24)),
                  (b) => b.toString(16).padStart(2, "0"),
                ).join("");
              setNotice(
                "A random password was generated. Reveal and store it separately from your recovery file.",
              );
            }}
          >
            Generate password
          </button>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() => {
              if (password.current)
                password.current.type =
                  password.current.type === "password" ? "text" : "password";
            }}
          >
            Show / hide
          </button>
        </div>
        <p className="callout" role="status" aria-live="polite">
          {busy ? `${busy}…` : notice}
        </p>
        {(page === "create" || page === "claim") && (
          <section className="shielded-card">
            <h2>
              {page === "create"
                ? "Prepare your picture"
                : "Import a shielded bearer picture"}
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
            <button
              className={btn + " nom-btn--primary"}
              disabled={!ready || !!busy || (page === "create" && !account)}
              onClick={() =>
                void run("Preparing saved operation", async () => {
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
                  setNotice(
                    "Fresh authority is encrypted locally. Download recovery and select the saved file before proving.",
                  );
                })
              }
            >
              {page === "create"
                ? "Prepare creation"
                : "Prepare claim with a fresh secret"}
            </button>
            <p>
              Sending a file is not settlement. Anyone with the current bearer
              file can race to claim it.
            </p>
          </section>
        )}
        {page === "recovery" && (
          <section className="shielded-card">
            <h2>Open an encrypted recovery file</h2>
            <p>
              Recovery restores the same destination. It does not generate a
              replacement spending secret.
            </p>
            <input
              aria-label="Encrypted recovery file"
              type="file"
              accept=".json"
              disabled={!ready || !!busy}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                void run("Restoring saved operation", async () => {
                  clearExports();
                  const existed = await sdk.current!.restore(
                    await text(f, 21 * 1024 * 1024),
                    pass(),
                  );
                  setNotice(
                    existed
                      ? "Recovery unlocked. Observe the chain before retrying."
                      : "Recovery restored. Observe the chain; download and reselect the new journal export before a retry.",
                  );
                });
                e.currentTarget.value = "";
              }}
            />
          </section>
        )}
        {selected && (
          <section className="shielded-card">
            <div className="shielded-result">
              {preview && <img src={preview} alt="Verified public artwork" />}
              <div>
                <h2>{selected.name}</h2>
                <p className="text-ledger">
                  {selected.kind === "create" ? "Creation" : "Claim"} ·{" "}
                  {selected.state}
                </p>
                <p className="shielded-hash">
                  Asset {selected.assetId}
                  <br />
                  Image SHA-256 {selected.imageHash}
                </p>
                <p>
                  Recovery:{" "}
                  {selected.acknowledged
                    ? "saved file verified"
                    : "saved-file verification required"}
                </p>
                {selected.needsObservation && (
                  <p>
                    Observe this restored operation before proving or retrying.
                  </p>
                )}
              </div>
            </div>
            <div className="actions">
              <button
                className={btn}
                disabled={!!busy}
                onClick={() =>
                  void run("Preparing recovery download", async () =>
                    save(
                      await sdk.current!.exportRecovery(),
                      "application/json",
                      `zft-recovery-${selected.id.slice(2, 10)}.json`,
                    ),
                  )
                }
              >
                Download recovery
              </button>
              <button
                className={btn}
                disabled={!!busy}
                onClick={() =>
                  void run("Observing chain", async () =>
                    setNotice(
                      `Chain observation: ${await sdk.current!.observe(pass())}. This is a checked RPC observation, not qualified finality.`,
                    ),
                  )
                }
              >
                Observe chain
              </button>
            </div>
            <label>
              Select the saved recovery file
              <input
                aria-label="Select the saved recovery file"
                type="file"
                accept=".json"
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  void run("Verifying saved recovery", async () => {
                    await sdk.current!.acknowledge(
                      await text(f, 21 * 1024 * 1024),
                      pass(),
                    );
                    setNotice(
                      "Saved recovery verified. Generate your proof locally.",
                    );
                  });
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <div className="actions">
              <button
                className={btn}
                disabled={!!busy || !mayProve}
                onClick={() =>
                  void run("Generating proof on this device", async () => {
                    await sdk.current!.prove();
                    setNotice(
                      "Proof verified locally. Review the selected fee wallet before submitting.",
                    );
                  })
                }
              >
                Generate proof
              </button>
              <button
                className={btn}
                disabled={busy !== "Generating proof on this device"}
                onClick={() => sdk.current?.cancelProof()}
              >
                Cancel proof
              </button>
              <button
                className={btn + " nom-btn--primary"}
                disabled={
                  !!busy || !mayProve || !selected.proofReady || !account
                }
                onClick={() =>
                  void run("Submitting public transaction", async () => {
                    const r = await sdk.current!.submit(pass());
                    setNotice(
                      r.phase === "committed"
                        ? "Creation commitment recorded. Wait for two chain blocks, then generate a proof and submit the reveal."
                        : `Chain observation: ${r.state}. Keep recovery until independently confirmed.`,
                    );
                  })
                }
              >
                Submit with fee wallet
              </button>
            </div>
            <p className="hint">
              Creation uses two explicit transactions. A lost response remains
              uncertain until observation. Cancelling a proof cannot cancel a
              sent transaction.
            </p>
            <div className="actions">
              <button
                className={btn}
                disabled={!!busy || selected.state !== "observed"}
                onClick={() =>
                  void run("Preparing bearer download", async () =>
                    save(
                      await sdk.current!.exportBearer(pass()),
                      "image/png",
                      `zft-bearer-${selected.assetId.slice(2, 10)}.png`,
                    ),
                  )
                }
              >
                Download bearer picture
              </button>
              <button
                className={btn}
                disabled={!!busy}
                onClick={() =>
                  void run("Preparing public image", async () =>
                    save(
                      await sdk.current!.exportPublic(),
                      "image/png",
                      `zft-public-${selected.imageHash.slice(2, 10)}.png`,
                    ),
                  )
                }
              >
                Download public image
              </button>
              {selected.kind === "create" && (
                <button
                  className={btn}
                  disabled={!!busy || !account}
                  onClick={() =>
                    void run("Renewing creator authorization", async () => {
                      clearExports();
                      await sdk.current!.renewCreation(pass());
                      setNotice(
                        "Authorization renewed for the same destination. Save and reselect its new recovery record.",
                      );
                    })
                  }
                >
                  Renew creation authorization
                </button>
              )}
            </div>
          </section>
        )}
        {downloads.length > 0 && (
          <section className="shielded-card" aria-label="Prepared downloads">
            <h2>Save your files</h2>
            {downloads.map((d) => (
              <a key={d.name} href={d.url} download={d.name}>
                {d.name}
              </a>
            ))}
          </section>
        )}
        <section className="shielded-card">
          <h2>Saved operations</h2>
          <p>
            Enter the password, then unlock an operation. Old and conflicting
            records remain available for recovery.
          </p>
          <div className="shielded-inventory">
            {state?.operations.map((r) => (
              <button
                key={r.id}
                className={btn}
                disabled={!!busy}
                onClick={() =>
                  void run("Unlocking saved operation", async () => {
                    clearExports();
                    await sdk.current!.unlock(r.id, pass());
                    setNotice(
                      "Operation unlocked. Observe the chain before any retry.",
                    );
                  })
                }
              >
                {short(r.id)} · {r.state}
              </button>
            ))}
          </div>
          {ready && !state?.operations.length && (
            <p>No saved operations for this deployment.</p>
          )}
        </section>
      </main>
      <footer>
        {testHost?.brand ?? <BrandLogo />}
        <p>
          {testHost
            ? "Disposable devnet experiment. Independent review and device acceptance remain open."
            : "Experimental shielded ownership. Independent review, production setup, target devices and staging remain open."}
        </p>
        <p>
          Public artwork and fee accounts can identify activity. “Observed”
          describes a checked block; it does not prove finality or private
          current ownership.
        </p>
        {!testHost && <a href="/">Return to public v1</a>}
      </footer>
    </div>
  );
}
