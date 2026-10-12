import React, { useEffect, useState } from "react";
import { BrandLogo } from "./brand-logo";
import { ThemeControl } from "./site-controls";
import type {
  GalleryItem,
  GalleryPage,
} from "../../../packages/shielded/public";
const primary = "nom-btn nom-btn--default nom-btn--primary";
const button = "nom-btn nom-btn--default nom-btn--outline";
const short = (s: string) => s.slice(0, 10) + "…" + s.slice(-6);
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-site">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="network-bar">
        <span className="text-ledger">ZVM DEVNET · TEST ASSETS ONLY</span>
        <span>Your picture. Your keys.</span>
      </div>
      <header>
        <div className="header-inner">
          <a className="wordmark" href="/">
            <BrandLogo />
          </a>
          <nav aria-label="Main navigation">
            <a href="/">Gallery</a>
            <a href="/shielded">My collection</a>
            <a href="/shielded/claim">Receive</a>
            <a href="/shielded/recovery">Recover</a>
          </nav>
          <div className="actions">
            <ThemeControl />
            <a className={primary} href="/shielded/create">
              Create a ZFT
            </a>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer>
        <BrandLogo />
        <p>Public pictures. Private spending keys. Experimental ZVM devnet.</p>
        <a href="/how-it-works">How it works</a>
      </footer>
    </div>
  );
}
async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    signal,
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok)
    throw Error(
      response.status === 404
        ? "This picture has not been published in the gallery."
        : "The gallery is temporarily unavailable. Try again.",
    );
  return response.json() as Promise<T>;
}
export function GalleryHome() {
  const [items, setItems] = useState<GalleryItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setLoaded(false);
    setItems([]);
    setCursor(null);
    read<GalleryPage>("/api/shielded/gallery", controller.signal)
      .then((page) => {
        setItems(page.items);
        setCursor(page.cursor);
        setLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [revision]);
  async function more() {
    if (!cursor || busy) return;
    setBusy(true);
    setError("");
    try {
      const page = await read<GalleryPage>(
        `/api/shielded/gallery?cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((old) => [
        ...new Map(
          [...old, ...page.items].map((item) => [item.assetId, item]),
        ).values(),
      ]);
      setCursor(page.cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PublicShell>
      <section className="gallery-hero">
        <p className="text-ledger">ZFT / SHIELDED COLLECTIBLES</p>
        <h1>
          Pictures worth
          <br />
          keeping.
        </h1>
        <p>Create a ZFT. See it here. Keep the keys in your collection.</p>
        <div className="actions">
          <a className={primary} href="/shielded/create">
            Create a ZFT <span aria-hidden="true">↗</span>
          </a>
          <a className={button} href="/shielded">
            Open my collection
          </a>
        </div>
      </section>
      <section aria-labelledby="gallery-title">
        <div className="gallery-heading">
          <div>
            <p className="text-ledger">THE PUBLIC GALLERY</p>
            <h2 id="gallery-title">Freshly created</h2>
          </div>
          <button
            className={button}
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            Refresh gallery
          </button>
        </div>
        <p className="hint">
          Published shielded ZFTs, newest first. Anyone can view the artwork;
          only the private spending keys can move it.
        </p>
        {error && (
          <p role="alert" className="gallery-message">
            {error}
          </p>
        )}
        {busy && <p role="status">Checking the gallery…</p>}
        {loaded && !items.length && !busy && !error && (
          <div className="gallery-empty">
            <span className="empty-mark" aria-hidden="true">
              ↗
            </span>
            <h3>
              {cursor
                ? "More pictures may be on the next page."
                : "A new gallery starts here."}
            </h3>
            <p>
              When creation finishes and the public picture is published, it
              appears here. Your saved drafts live in My collection.
            </p>
            <a className={primary} href="/shielded/create">
              Create the first ZFT
            </a>
          </div>
        )}
        <div className="public-grid">
          {items.map((item) => (
            <a
              className="public-picture"
              href={`/nft/${item.assetId}`}
              key={item.assetId}
            >
              <div className="public-art">
                <img
                  src={item.image}
                  alt={item.metadata.name}
                  loading="lazy"
                  width={item.metadata.width}
                  height={item.metadata.height}
                />
              </div>
              <div className="public-caption">
                <h3>{item.metadata.name}</h3>
                <span aria-hidden="true">↗</span>
                <p className="text-ledger">SHIELDED ZFT · CREATION OBSERVED</p>
              </div>
            </a>
          ))}
        </div>
        {cursor && (
          <button
            className={button}
            disabled={busy}
            onClick={() => void more()}
          >
            Load more
          </button>
        )}
      </section>
      <section className="gallery-explanation">
        <h2>
          The picture is public.
          <br />
          Control stays with your keys.
        </h2>
        <p>
          A gallery image is safe to share. Your transferable bearer picture and
          encrypted recovery file belong in your private collection. Gallery
          listings show creation provenance, not the current holder.
        </p>
        <a href="/how-it-works">Learn how ZFTs work ↗</a>
      </section>
    </PublicShell>
  );
}
export function GalleryDetail({ assetId }: { assetId: string }) {
  const [item, setItem] = useState<GalleryItem>(),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setItem(undefined);
    setError("");
    read<GalleryItem>(`/api/shielded/gallery/${assetId}`, c.signal)
      .then(setItem)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [assetId, revision]);
  return (
    <PublicShell>
      <a href="/">← All ZFTs</a>
      {error ? (
        <div className="gallery-message" role="alert">
          <p>{error}</p>
          <button className={button} onClick={() => setRevision((v) => v + 1)}>
            Try again
          </button>
        </div>
      ) : !item ? (
        <p role="status">Checking this ZFT’s creation…</p>
      ) : (
        <article className="public-detail">
          <div className="public-art">
            <img src={item.image} alt={item.metadata.name} />
          </div>
          <div>
            <p className="text-ledger">SHIELDED ZFT</p>
            <h1>{item.metadata.name}</h1>
            <p className="art-description">{item.metadata.description}</p>
            <p className="gallery-badge">Creation observed on devnet</p>
            <p>
              The public picture can be saved and shared. It contains no
              spending keys.
            </p>
            <a
              className={primary}
              href={item.image}
              download={`zft-public-${assetId.slice(2, 10)}.png`}
            >
              Save public picture
            </a>
            <dl className="public-provenance">
              <dt>Created by</dt>
              <dd title={item.metadata.creator}>
                {short(item.metadata.creator)} · fee account
              </dd>
              <dt>Created in block</dt>
              <dd>{item.creationBlock}</dd>
              <dt>Checked at block</dt>
              <dd>{item.observedBlock}</dd>
              <dt>Asset ID</dt>
              <dd>{item.assetId}</dd>
              <dt>Creation transaction</dt>
              <dd>{item.transactionHash}</dd>
            </dl>
            <p className="hint">
              Creation provenance is an RPC observation, not guaranteed finality
              or proof of current ownership. The holder’s private collection
              stays private.
            </p>
          </div>
        </article>
      )}
    </PublicShell>
  );
}
export function GalleryHelp() {
  return (
    <PublicShell>
      <section className="public-help">
        <p className="text-ledger">HOW ZFT WORKS</p>
        <h1>
          Your picture.
          <br />
          Your keys.
        </h1>
        <h2>Create it</h2>
        <p>
          Choose a picture and title. New ZFTs are public by default: the
          gallery shows the sanitized picture, title, description and the fee
          account that signed creation. Save and reselect your encrypted
          recovery file before approving the two creation transactions. The
          first reserves the picture; the second finishes creation.
        </p>
        <h2>See it</h2>
        <p>
          After creation is observed, the app publishes its public picture to
          this gallery. If publication is interrupted, open the picture in My
          collection, check its status and choose Publish to gallery.
          Publication can be retried without creating another ZFT.
        </p>
        <h2>Keep it</h2>
        <p>
          My collection holds this browser’s encrypted records, including
          unfinished drafts. Your recovery password unlocks them. Keep the
          encrypted recovery file and its password separately. A public gallery
          image or your fee wallet cannot recover spending keys.
        </p>
        <h2>Pass it on</h2>
        <p>
          A transferable bearer picture contains spending material. Share it
          only with the intended recipient. The recipient uses Receive to claim
          into a fresh secret. The sender’s copy can still race until the claim
          is observed.
        </p>
        <h2>Know what is public</h2>
        <p>
          The gallery records creation, not current ownership. Public artwork
          and fee accounts can identify activity. Shielded transfers do not make
          the picture or its creator anonymous. This is experimental devnet
          software with test assets; independent review and device qualification
          remain open.
        </p>
        <div className="actions">
          <a className={primary} href="/shielded/create">
            Create a ZFT
          </a>
          <a className={button} href="/shielded/recovery">
            Recover a saved ZFT
          </a>
        </div>
      </section>
    </PublicShell>
  );
}
