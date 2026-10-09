import PresentationControls from "./presentation-controls";
import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { BrandLogo } from "../brand-logo";
import { ThemeControl } from "../site-controls";
import {
  PsBridge,
  bootstrap,
  localLaunch,
  route,
  itemPath,
  readEncrypted,
  type Bootstrap,
  type State,
  type Result,
} from "./bridge";
import { normalizeArtwork, type Normalized } from "./image";
import "./style.css";
const short = (s: string) => s.slice(0, 10) + "…" + s.slice(-6);
const bytes = (s: string) =>
  Uint8Array.from(s.match(/../g)!, (x) => parseInt(x, 16));
type Download = { url: string; name: string; note: string; id?: string };
type Image = { url: string; digest: string; width: number; height: number };
export default function PsApp() {
  const [path, setPath] = useState(location.pathname),
    [boot, setBoot] = useState<Bootstrap>(),
    [state, setState] = useState<State>();
  const [role, setRole] = useState("alice"),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("Connecting to the local issuer…");
  const [images, setImages] = useState<Record<string, Image>>({}),
    [download, setDownload] = useState<Download>();
  const [normalized, setNormalized] = useState<Normalized>(),
    [preview, setPreview] = useState<string>();
  const [digest, setDigest] = useState(""),
    [privateConsent, setPrivateConsent] = useState(false);
  const bridge = useRef(new PsBridge()),
    capability = useRef(""),
    epoch = useRef(0),
    running = useRef(false),
    unlocked = useRef(false),
    lastTouch = useRef(Date.now());
  const formArea = useRef<HTMLDivElement>(null),
    normalizeAbort = useRef<AbortController | undefined>(undefined),
    imageUrls = useRef<string[]>([]),
    downloadUrl = useRef<string | undefined>(undefined),
    previewUrl = useRef<string | undefined>(undefined);
  const current = route(path),
    activeItems = state?.credentials.filter((c) => !c.locallySpent) ?? [],
    pending = state?.operations.filter((o) => !o.complete) ?? [];
  const operation = pending.find((o) => o.digest === digest);
  const item =
    current.page === "item" && current.realm === boot?.manifest.realm
      ? activeItems.find((c) => c.id === current.id)
      : undefined;
  const selectedImage = item && images[item.id];
  function clearDownload() {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = undefined;
    setDownload(undefined);
  }
  function clearImages() {
    imageUrls.current.forEach(URL.revokeObjectURL);
    imageUrls.current = [];
    setImages({});
  }
  function clearPreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = undefined;
    setPreview(undefined);
    setNormalized(undefined);
  }
  function clearInputs() {
    formArea.current
      ?.querySelectorAll<HTMLInputElement>(
        "input[type=password],input[type=file]",
      )
      .forEach((el) => {
        el.value = "";
      });
  }
  function lock() {
    epoch.current++;
    bridge.current.lock();
    normalizeAbort.current?.abort();
    unlocked.current = false;
    running.current = false;
    clearDownload();
    clearImages();
    clearPreview();
    clearInputs();
    setState(undefined);
    setDigest("");
    setPrivateConsent(false);
    setBusy("");
    setMessage(
      "Locked. Your encrypted browser copy remains. Reopen to continue.",
    );
  }
  function nav(next: string) {
    history.pushState(null, "", next);
    setPath(next);
    setPrivateConsent(false);
    clearDownload();
    window.scrollTo(0, 0);
  }
  const active = (e: number) => {
    if (e !== epoch.current) throw new Error("Locked.");
  };
  function save(
    data: string | Uint8Array,
    name: string,
    type: string,
    note: string,
    id?: string,
  ) {
    clearDownload();
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
    downloadUrl.current = url;
    setDownload({ url, name, note, id });
  }
  async function render(next: State, e: number) {
    active(e);
    unlocked.current = true;
    setState(next);
    clearImages();
    const result: Record<string, Image> = {};
    for (const c of next.credentials.filter((c) => !c.locallySpent)) {
      try {
        const r = await bridge.current.call("view-image", { credential: c.id });
        active(e);
        if (r.artwork) {
          const a = r.artwork,
            url = URL.createObjectURL(
              new Blob([a.bytes as BlobPart], { type: "image/png" }),
            );
          imageUrls.current.push(url);
          result[c.id] = {
            url,
            digest: a.digest,
            width: a.width,
            height: a.height,
          };
        }
      } catch {
        active(
          e,
        ); /* Credential remains recoverable even when this engine cannot render its image. */
      }
    }
    active(e);
    setImages(result);
  }
  async function run(
    label: string,
    work: (e: number) => Promise<Result | void>,
    success = "Done. Keep your recovery files.",
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setMessage("");
    const e = epoch.current;
    try {
      const r = await work(e);
      active(e);
      if (r?.state) await render(r.state, e);
      active(e);
      if (r?.digest) {
        setDigest(r.digest);
        nav("/ps/recover");
      }
      setMessage(success);
    } catch (err) {
      if (e === epoch.current) {
        if (!bridge.current.available && unlocked.current) lock();
        setMessage(
          err instanceof Error
            ? err.message
            : "Action could not finish. Keep recovery files.",
        );
      }
    } finally {
      if (e === epoch.current) {
        clearInputs();
        running.current = false;
        setBusy("");
        lastTouch.current = Date.now();
      }
    }
  }
  const submit = (
    e: FormEvent<HTMLFormElement>,
    label: string,
    work: (data: FormData, epoch: number) => Promise<Result | void>,
    success?: string,
  ) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void run(label, (n) => work(data, n), success);
  };
  useEffect(() => {
    document.title = "ZFT · PS collection (local)";
    const abort = new AbortController();
    try {
      capability.current = localLaunch(new URL(location.href));
      history.replaceState(null, "", location.pathname);
      void bootstrap(capability.current, abort.signal)
        .then(setBoot)
        .catch((err) => {
          if (!abort.signal.aborted) setMessage(err.message);
        });
    } catch (err) {
      history.replaceState(null, "", location.pathname);
      setMessage((err as Error).message);
    }
    const pop = () => {
      if (running.current) lock();
      clearInputs();
      setPath(location.pathname);
      setPrivateConsent(false);
      clearDownload();
    };
    const hidden = () => {
      if (document.hidden) lock();
    };
    const touch = () => {
      lastTouch.current = Date.now();
    };
    const timer = setInterval(() => {
      if (unlocked.current && Date.now() - lastTouch.current >= 300000) lock();
    }, 1000);
    window.addEventListener("popstate", pop);
    window.addEventListener("pagehide", lock);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("pointerdown", touch);
    document.addEventListener("keydown", touch);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("pagehide", lock);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("pointerdown", touch);
      document.removeEventListener("keydown", touch);
      epoch.current++;
      bridge.current.lock();
      normalizeAbort.current?.abort();
      imageUrls.current.forEach(URL.revokeObjectURL);
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);
  useEffect(() => {
    if (boot) setMessage("Choose a test role and unlock its browser copy.");
  }, [boot]);
  useEffect(() => {
    if (!pending.some((o) => o.digest === digest))
      setDigest(pending[0]?.digest ?? "");
  }, [state]);
  const password = (name = "password") => (
    <label>
      Password
      <input
        name={name}
        type="password"
        autoComplete="off"
        required
        minLength={8}
      />
    </label>
  );
  const file = (name: string, accept: string) => (
    <input name={name} type="file" accept={accept} required />
  );
  const buttons = [
    ["/ps/", "Collection"],
    ["/ps/create", "Create"],
    ["/ps/receive", "Receive"],
    ["/ps/recover", "Recovery"],
  ];
  return (
    <div className="ps-app" ref={formArea}>
      <header className="ps-header">
        <a
          className="wordmark"
          href="/ps/"
          aria-disabled={!!busy}
          onClick={(e) => {
            e.preventDefault();
            if (!running.current) nav("/ps/");
          }}
        >
          <BrandLogo />
        </a>
        <span className="ps-tag">PS · LOCAL PREVIEW</span>
        <div className="ps-spacer" />
        <ThemeControl />
        <button onClick={lock}>Lock</button>
      </header>
      <nav className="ps-nav" aria-label="PS navigation">
        {buttons.map(([url, title]) => (
          <a
            key={url}
            href={url}
            aria-current={path === url ? "page" : undefined}
            aria-disabled={!!busy}
            onClick={(e) => {
              e.preventDefault();
              if (!running.current) nav(url);
            }}
          >
            {title}
            {url === "/ps/recover" && pending.length
              ? ` (${pending.length})`
              : ""}
          </a>
        ))}
      </nav>
      <main className="ps-main">
        <aside className="ps-warning">
          Local test issuer · public test keys · disposable artwork only.
          Stopping the server loses the issuer registry; saved files cannot
          restore it. These PS credentials are managed here; they are not NFTs
          in MetaMask’s inventory.
        </aside>
        <div className="ps-notice" role="status" aria-live="polite">
          {busy || message}
        </div>
        {!state && (
          <section className="ps-panel ps-unlock">
            <p className="ps-eyebrow">YOUR BROWSER COPY</p>
            <h1>Art you can carry.</h1>
            <p>
              Open your encrypted PS collection. Secrets and proofs stay in this
              browser’s credential Worker.
            </p>
            <form
              onSubmit={(e) =>
                submit(
                  e,
                  "Unlocking…",
                  async (d, n) => {
                    if (!boot) throw new Error("Issuer not ready.");
                    bridge.current.start();
                    const r = await bridge.current.call(String(d.get("mode")), {
                      token: capability.current,
                      manifest: boot.manifest,
                      clientId: boot.clients[role],
                      password: d.get("password"),
                    });
                    active(n);
                    return r;
                  },
                  "Browser copy unlocked.",
                )
              }
            >
              <fieldset disabled={!!busy || !boot}>
                <label>
                  Test role
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="alice">Alice</option>
                    <option value="bob">Bob</option>
                    <option value="restored">Restored</option>
                  </select>
                </label>
                <label>
                  Browser copy
                  <select name="mode">
                    <option value="open">Open saved copy</option>
                    <option value="create">Create new copy</option>
                  </select>
                </label>
                {password()}
                <button className="ps-primary">Unlock collection</button>
              </fieldset>
            </form>
            <p className="ps-muted">
              Use a test password. This issuer permits eight operations per
              browser copy and 24 completed operations overall.
            </p>
          </section>
        )}
        {state && (
          <>
            <div className="ps-context">
              <span>
                {role.toUpperCase()} · revision {state.revision}
              </span>
              <span>Issuer {short(boot!.manifest.realm)}</span>
              <button disabled={!!busy} onClick={lock}>
                Switch test role
              </button>
            </div>
            {current.page === "collection" && (
              <>
                <div className="ps-heading">
                  <div>
                    <p className="ps-eyebrow">IN THIS BROWSER</p>
                    <h1>Your collection</h1>
                    <p>
                      Local credentials. A displayed image is not a fresh issuer
                      status check.
                    </p>
                  </div>
                  <button
                    className="ps-primary"
                    onClick={() => nav("/ps/create")}
                  >
                    Create a ZFT
                  </button>
                </div>
                <div className="ps-grid">
                  {activeItems.map((c) => (
                    <button
                      className="ps-art-card"
                      key={c.id}
                      disabled={!!busy}
                      onClick={() => nav(itemPath(boot!.manifest.realm, c.id))}
                    >
                      {images[c.id] ? (
                        <img
                          src={images[c.id].url}
                          alt="Verified public artwork"
                        />
                      ) : (
                        <div className="ps-placeholder">
                          Preview unavailable
                        </div>
                      )}
                      <span>
                        Artwork{" "}
                        {images[c.id]?.digest.slice(0, 8) ?? short(c.id)}
                      </span>
                      <small>PS credential · locally active</small>
                    </button>
                  ))}
                </div>
                {!activeItems.length && (
                  <section className="ps-panel">
                    <h2>Your collection is empty</h2>
                    <p>
                      Create an artwork credential or claim a private file
                      someone has shared with you.
                    </p>
                    <button onClick={() => nav("/ps/receive")}>
                      Receive a file
                    </button>
                  </section>
                )}
              </>
            )}
            {current.page === "create" && (
              <section className="ps-panel">
                <p className="ps-eyebrow">CREATE</p>
                <h1>Make the file yours.</h1>
                <p>
                  JPG and PNG files are normalized locally using the existing
                  ZFT codec. This test profile accepts results up to 64 KiB and
                  262,144 pixels.
                </p>
                <form
                  onSubmit={(e) =>
                    submit(
                      e,
                      "Preparing artwork…",
                      async (d, n) => {
                        normalizeAbort.current?.abort();
                        const controller = new AbortController();
                        normalizeAbort.current = controller;
                        const r = await normalizeArtwork(
                          d.get("image") as File,
                          controller.signal,
                        );
                        active(n);
                        clearPreview();
                        previewUrl.current = URL.createObjectURL(
                          new Blob([r.bytes as BlobPart], {
                            type: "image/png",
                          }),
                        );
                        setPreview(previewUrl.current);
                        setNormalized(r);
                      },
                      "Artwork ready. Review it before preparing the mint.",
                    )
                  }
                >
                  <fieldset disabled={!!busy}>
                    <label>
                      Artwork JPG or PNG{file("image", "image/png,image/jpeg")}
                    </label>
                    <button>Prepare artwork</button>
                  </fieldset>
                </form>
                {normalized && (
                  <div className="ps-normalized">
                    <img src={preview} alt="Normalized artwork to mint" />
                    <p>
                      {normalized.width} × {normalized.height} ·{" "}
                      {normalized.bytes.length.toLocaleString()} bytes
                    </p>
                    <button
                      className="ps-primary"
                      disabled={!!busy}
                      onClick={() =>
                        void run(
                          "Preparing mint…",
                          () =>
                            bridge.current.call("mint-image", {
                              bytes: normalized.bytes,
                            }),
                          "Mint prepared. Save and verify its recovery file before submission.",
                        )
                      }
                    >
                      Prepare mint
                    </button>
                  </div>
                )}
                <details>
                  <summary>Use a built-in test artwork</summary>
                  <div className="ps-row">
                    {boot!.fixtures.map((f, i) => (
                      <button
                        key={i}
                        disabled={!!busy}
                        onClick={() =>
                          void run(
                            "Preparing mint…",
                            () =>
                              bridge.current.call("mint-image", {
                                bytes: bytes(f.asset),
                              }),
                            "Mint prepared. Back it up before submission.",
                          )
                        }
                      >
                        Test artwork {i + 1}
                      </button>
                    ))}
                  </div>
                </details>
              </section>
            )}
            {current.page === "receive" && (
              <section className="ps-panel">
                <p className="ps-eyebrow">RECEIVE</p>
                <h1>Claim a shared file</h1>
                <p>
                  A copied file can be claimed by anyone who holds it. Your
                  claim completes only after the issuer accepts it and this
                  browser saves the verified replacement.
                </p>
                <form
                  onSubmit={(e) =>
                    submit(
                      e,
                      "Preparing claim…",
                      async (d, n) => {
                        const f = d.get("private") as File;
                        if (!f.size || f.size > 69644)
                          throw new Error(
                            "Choose a private PS PNG no larger than 69,644 bytes.",
                          );
                        const value = new Uint8Array(await f.arrayBuffer());
                        active(n);
                        return bridge.current.call("claim-image", {
                          bytes: value,
                        });
                      },
                      "Claim prepared. Save and verify your own recovery file before submission.",
                    )
                  }
                >
                  <fieldset disabled={!!busy}>
                    <label>
                      Private bearer PNG{file("private", "image/png")}
                    </label>
                    <button className="ps-primary">Prepare PNG claim</button>
                  </fieldset>
                </form>
                <details>
                  <summary>Receive an encrypted transfer file</summary>
                  <form
                    onSubmit={(e) =>
                      submit(e, "Opening transfer file…", async (d, n) => {
                        const wire = await readEncrypted(
                          d.get("transfer") as File,
                        );
                        active(n);
                        return bridge.current.call("claim", {
                          wire,
                          password: d.get("password"),
                          expectedId: d.get("expected"),
                        });
                      })
                    }
                  >
                    <fieldset disabled={!!busy}>
                      <label>
                        Encrypted transfer file{file("transfer", ".json")}
                      </label>
                      <label>
                        Expected file ID
                        <input
                          name="expected"
                          required
                          pattern="[0-9a-f]{32}"
                        />
                      </label>
                      {password()}
                      <button>Prepare encrypted claim</button>
                    </fieldset>
                  </form>
                </details>
              </section>
            )}
            {current.page === "recover" && (
              <section className="ps-panel">
                <p className="ps-eyebrow">RECOVERY</p>
                <h1>Save first. Submit second.</h1>
                <p>
                  Each mint, claim or cancellation needs its own encrypted
                  recovery file. Keep it until the replacement is verified and
                  saved.
                </p>
                {pending.length ? (
                  <>
                    <label>
                      Pending operation
                      <select
                        value={digest}
                        disabled={!!busy}
                        onChange={(e) => {
                          setDigest(e.target.value);
                          clearDownload();
                        }}
                      >
                        {pending.map((o) => (
                          <option key={o.digest} value={o.digest}>
                            {short(o.digest)} ·{" "}
                            {o.acknowledged
                              ? "backup verified"
                              : "backup required"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ol className="ps-steps">
                      <li>
                        <h2>Save encrypted recovery</h2>
                        <form
                          onSubmit={(e) =>
                            submit(e, "Encrypting recovery…", async (d, n) => {
                              const r = await bridge.current.call("backup", {
                                digest,
                                password: d.get("password"),
                              });
                              active(n);
                              save(
                                r.wire!,
                                `ps-recovery-${r.id}.json`,
                                "application/json",
                                "Save this private file, then select the saved copy below.",
                                r.id,
                              );
                              return r;
                            })
                          }
                        >
                          <fieldset
                            disabled={
                              !!busy || !operation || operation.acknowledged
                            }
                          >
                            {password()}
                            <button>Create recovery download</button>
                          </fieldset>
                        </form>
                      </li>
                      <li>
                        <h2>Verify the saved file</h2>
                        <form
                          onSubmit={(e) =>
                            submit(
                              e,
                              "Verifying saved recovery…",
                              async (d, n) => {
                                const wire = await readEncrypted(
                                  d.get("recovery") as File,
                                );
                                active(n);
                                return bridge.current.call("acknowledge", {
                                  digest,
                                  wire,
                                  password: d.get("password"),
                                });
                              },
                              "Saved recovery verified. You may submit the operation.",
                            )
                          }
                        >
                          <fieldset
                            disabled={
                              !!busy ||
                              !operation?.backupId ||
                              operation.acknowledged
                            }
                          >
                            <label>
                              Saved recovery file{file("recovery", ".json")}
                            </label>
                            {password()}
                            <button>Verify saved recovery</button>
                          </fieldset>
                        </form>
                      </li>
                      <li>
                        <h2>Submit or retry</h2>
                        <p>
                          After an uncertain response, retry this same saved
                          operation. Do not prepare a replacement operation.
                        </p>
                        <div className="ps-row">
                          <button
                            className="ps-primary"
                            disabled={!!busy || !operation?.acknowledged}
                            onClick={() =>
                              void run(
                                "Submitting saved operation…",
                                () => bridge.current.call("submit", { digest }),
                                "Replacement verified and saved. Open Collection to view it.",
                              )
                            }
                          >
                            Submit saved operation
                          </button>
                          <button
                            disabled={!!busy || !operation?.acknowledged}
                            onClick={() =>
                              void run(
                                "Retrieving committed response…",
                                () =>
                                  bridge.current.call("recover", { digest }),
                                "Committed response verified and saved.",
                              )
                            }
                          >
                            Retrieve committed response
                          </button>
                        </div>
                      </li>
                    </ol>
                  </>
                ) : (
                  <p>No unresolved operations in this browser copy.</p>
                )}
                <details>
                  <summary>Restore a saved recovery file</summary>
                  <p>
                    Restore into this same running issuer. A different issuer or
                    a restarted disposable server cannot honor the file.
                  </p>
                  <form
                    onSubmit={(e) =>
                      submit(
                        e,
                        "Restoring recovery…",
                        async (d, n) => {
                          const wire = await readEncrypted(
                            d.get("restore") as File,
                          );
                          active(n);
                          return bridge.current.call("restore", {
                            wire,
                            password: d.get("password"),
                            expectedId: d.get("expected"),
                          });
                        },
                        "Recovery restored. Retrieve its committed response or retry its exact saved request.",
                      )
                    }
                  >
                    <fieldset disabled={!!busy}>
                      <label>Recovery file{file("restore", ".json")}</label>
                      <label>
                        Expected file ID
                        <input
                          name="expected"
                          required
                          pattern="[0-9a-f]{32}"
                        />
                      </label>
                      {password()}
                      <button>Restore operation</button>
                    </fieldset>
                  </form>
                </details>
              </section>
            )}
            {current.page === "item" &&
              (item ? (
                <section className="ps-detail">
                  <div className="ps-artwork">
                    {selectedImage ? (
                      <img
                        src={selectedImage.url}
                        alt="Verified original artwork"
                      />
                    ) : (
                      <p>Preview unavailable in this engine.</p>
                    )}
                  </div>
                  <div className="ps-panel">
                    <p className="ps-eyebrow">PS CREDENTIAL</p>
                    <h1>Artwork {selectedImage?.digest.slice(0, 8)}</h1>
                    <p>
                      Locally active · current issuer status has not been
                      checked.
                    </p>
                    <p className="ps-hash">
                      Image SHA-256: {selectedImage?.digest ?? "Unavailable"}
                    </p>
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        void run("Preparing public image…", async (n) => {
                          const r = await bridge.current.call("public-image", {
                            credential: item.id,
                          });
                          active(n);
                          save(
                            r.artwork!.bytes,
                            `ps-public-${r.artwork!.digest.slice(0, 16)}.png`,
                            "image/png",
                            "Public artwork only. This file carries no credential envelope.",
                          );
                        })
                      }
                    >
                      Download public artwork
                    </button>
                    <h2>Transfer privately</h2>
                    <form
                      onSubmit={(e) =>
                        submit(e, "Encrypting transfer…", async (d, n) => {
                          const r = await bridge.current.call("export", {
                            credential: item.id,
                            password: d.get("password"),
                          });
                          active(n);
                          save(
                            r.wire!,
                            `ps-transfer-${r.id}.json`,
                            "application/json",
                            "Private encrypted transfer. Share the expected file ID separately.",
                            r.id,
                          );
                        })
                      }
                    >
                      <fieldset disabled={!!busy}>
                        {password()}
                        <button>Create encrypted transfer</button>
                      </fieldset>
                    </form>
                    <details>
                      <summary>Download an unencrypted private PNG</summary>
                      <p>
                        Anyone with this file can attempt a claim. Keep it off
                        public uploads.
                      </p>
                      <label className="ps-check">
                        <input
                          type="checkbox"
                          checked={privateConsent}
                          onChange={(e) => setPrivateConsent(e.target.checked)}
                        />
                        I understand this file carries bearer authority.
                      </label>
                      <button
                        disabled={!!busy || !privateConsent}
                        onClick={() =>
                          void run("Preparing private PNG…", async (n) => {
                            const r = await bridge.current.call(
                              "private-image",
                              { credential: item.id },
                            );
                            active(n);
                            save(
                              r.artwork!.bytes,
                              `ps-private-${r.artwork!.digest.slice(0, 16)}.png`,
                              "image/png",
                              "PRIVATE BEARER FILE. Anyone with this file can attempt a claim.",
                            );
                            setPrivateConsent(false);
                          })
                        }
                      >
                        Download private bearer PNG
                      </button>
                    </details>
                    <PresentationControls
                      key={item.id}
                      credential={item.id}
                      bridge={bridge.current}
                      busy={!!busy}
                      active={active}
                      run={run}
                    />
                    <h2>Cancel exported copies</h2>
                    <p>
                      Swap to a fresh secret. This can race with a recipient’s
                      claim; it cannot undo a completed claim.
                    </p>
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        void run(
                          "Preparing cancellation…",
                          () =>
                            bridge.current.call("cancel", {
                              credential: item.id,
                            }),
                          "Cancellation prepared. Save and verify its recovery file before submission.",
                        )
                      }
                    >
                      Prepare cancellation
                    </button>
                  </div>
                </section>
              ) : (
                <section className="ps-panel">
                  <h1>Credential unavailable</h1>
                  <p>
                    This item is not active in this unlocked browser copy and
                    issuer realm.
                  </p>
                </section>
              ))}
            {current.page === "missing" && <h1>Page not found</h1>}
          </>
        )}
        {download && (
          <aside className="ps-download">
            <h2>Your file is ready</h2>
            <a className="ps-save" href={download.url} download={download.name}>
              Save {download.name}
            </a>
            <p>{download.note}</p>
            {download.id && (
              <p className="ps-hash">Expected file ID: {download.id}</p>
            )}
          </aside>
        )}
      </main>
      <footer className="ps-footer">
        ZFT · LOCAL PS PRODUCT PREVIEW · Independent cryptographic review
        pending.
      </footer>
    </div>
  );
}
