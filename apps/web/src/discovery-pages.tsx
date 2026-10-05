import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  CollectionEntry,
  DiscoveredItem,
} from "../../../packages/protocol/discovery";
import type { Metadata } from "../../../packages/protocol";
import { api, signedRequest } from "./api";
import type { Identity } from "./identity";
import { PublicCard, RouteLink, short } from "./public-pages";
import { Modal } from "./site-controls";
import { DiscoveryLoader, type Results } from "./discovery-loader";
import logo from "../../../design/vendor/zenon/assets/znn-logo.svg";
const btn = "nom-btn nom-btn--outline nom-btn--default";
const primary = "nom-btn nom-btn--primary nom-btn--default";
type Props = {
  nav: (to: string) => void;
  identity?: Identity;
  onUnlock: (to: string) => void;
  path: string;
};
function useResults<T>(endpoint: string, identify: (item: T) => string) {
  const [state, setState] = useState<Results<T>>({
    items: [],
    nextCursor: null,
    total: 0,
    pending: 0,
    busy: true,
    error: "",
    stale: false,
  });
  const loader = useMemo(() => new DiscoveryLoader<T>(identify, setState), []);
  useEffect(() => {
    void loader.reset(endpoint);
    return () => loader.stop();
  }, [endpoint, loader]);
  return {
    state,
    more: () => loader.load(true),
    retry: () => loader.load(!!state.nextCursor),
    refresh: () => loader.reset(endpoint),
  };
}
function CollectionRow({
  entry,
  rank,
  nav,
  identity,
  onUnlock,
}: { entry: CollectionEntry; rank?: number } & Props) {
  const [liked, setLiked] = useState(entry.liked),
    [likes, setLikes] = useState(entry.likes),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [guest, setGuest] = useState(false);
  const generation = useRef(0),
    submitting = useRef(false);
  useEffect(() => {
    generation.current++;
    submitting.current = false;
    setBusy(false);
    setLiked(entry.liked);
    setLikes(entry.likes);
    setError("");
    return () => {
      generation.current++;
    };
  }, [entry, identity]);
  async function like() {
    if (!identity) {
      setGuest(true);
      return;
    }
    if (submitting.current) return;
    const run = generation.current,
      active = !liked;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await signedRequest(
        "/api/social",
        { kind: "like", target: entry.address, active },
        identity,
      );
      const data = await api<{
        counts: { likes: number };
        viewer: { liked: boolean };
      }>(`/api/profiles/${entry.address}?viewer=${identity.address}`);
      if (run === generation.current) {
        setLiked(data.viewer.liked);
        setLikes(data.counts.likes);
      }
    } catch (e) {
      if (run === generation.current)
        setError(
          (e as Error).message + " New here? Save your public profile first.",
        );
    } finally {
      if (run === generation.current) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <article className="collection-entry">
      <RouteLink
        to={`/p/${entry.address}`}
        nav={nav}
        className="collection-entry-link"
      >
        {rank !== undefined && (
          <span className="collection-rank mono">
            {String(rank).padStart(2, "0")}
          </span>
        )}
        {entry.preview ? (
          <img
            src={`/art/${entry.preview.metadata.imageHash.slice(2)}.png`}
            alt=""
            loading="lazy"
          />
        ) : (
          <span className="collection-placeholder" aria-hidden="true">
            {entry.address.slice(2, 4).toUpperCase()}
          </span>
        )}
        <span className="collection-description">
          <strong>{entry.name}</strong>
          <span>
            {entry.collected} public {entry.collected === 1 ? "item" : "items"}{" "}
            · {entry.followers}{" "}
            {entry.followers === 1 ? "follower" : "followers"}
          </span>
          <span className="text-ledger">
            {entry.createdAt === null
              ? "Creation date unknown"
              : `Created ${new Date(entry.createdAt).toLocaleDateString()}`}
          </span>
        </span>
      </RouteLink>
      <button
        className="collection-like"
        aria-label={`${liked ? "Unlike" : "Like"} ${entry.name}`}
        aria-pressed={liked}
        disabled={busy || identity?.address.toLowerCase() === entry.address}
        onClick={() => void like()}
      >
        <span aria-hidden="true">{liked ? "♥" : "♡"}</span> {likes}
      </button>
      {error && (
        <p className="collection-error" role="alert">
          {error}
        </p>
      )}
      {guest && (
        <Modal title="Like this collection" onClose={() => setGuest(false)}>
          <p>
            Connect your wallet or unlock your local profile, then return to
            like {entry.name}.
          </p>
          <button
            className={primary}
            onClick={() => {
              setGuest(false);
              onUnlock(`/p/${entry.address}`);
            }}
          >
            Continue
          </button>
        </Modal>
      )}
    </article>
  );
}
export function Discovery(props: Props) {
  const nfts = props.path.split("?")[0] === "/explore/nfts",
    params = new URLSearchParams(props.path.split("?")[1] ?? "");
  const q = params.get("q") ?? "",
    sort = params.get("sort") ?? (nfts ? "newest" : "popular");
  const [draft, setDraft] = useState(q);
  const navRef = useRef(props.nav);
  navRef.current = props.nav;
  const root = nfts ? "/explore/nfts" : "/explore";
  const query = new URLSearchParams({
    q,
    sort,
    ...(props.identity ? { viewer: props.identity.address } : {}),
  });
  const endpoint = `/api/discovery/${nfts ? "nfts" : "collections"}?${query}`;
  const { state, more, retry, refresh } = useResults<
    DiscoveredItem | CollectionEntry
  >(endpoint, (i) => ("tokenId" in i ? i.tokenId : i.address));
  useEffect(() => setDraft(q), [q, root]);
  useEffect(() => {
    if (draft === q) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams({ sort });
      if (draft.trim()) next.set("q", draft.trim());
      navRef.current(`${root}?${next}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, q, sort, root]);
  function choose(nextSort: string) {
    const next = new URLSearchParams({ sort: nextSort });
    if (draft.trim()) next.set("q", draft.trim());
    props.nav(`${root}?${next}`);
  }
  return (
    <section className="discovery-page">
      <p className="eyebrow">Public on ZVM</p>
      <h1>Find your next favorite.</h1>
      <p className="discovery-intro">
        Explore the pictures and people making the network their own.
      </p>
      <nav className="discovery-tabs" aria-label="Discovery type">
        <RouteLink
          nav={props.nav}
          to="/explore"
          className={!nfts ? "selected" : ""}
        >
          Collections
        </RouteLink>
        <RouteLink
          nav={props.nav}
          to="/explore/nfts"
          className={nfts ? "selected" : ""}
        >
          NFTs
        </RouteLink>
      </nav>
      <div className="discovery-toolbar">
        <label>
          Search {nfts ? "titles" : "collections"}
          <input
            type="search"
            value={draft}
            maxLength={64}
            placeholder={nfts ? "A picture, a name…" : "Find a collection…"}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => choose(e.target.value)}>
            {(nfts
              ? [
                  ["newest", "Newest"],
                  ["oldest", "Oldest"],
                  ["az", "A–Z"],
                ]
              : [
                  ["popular", "Popular"],
                  ["newest", "Newest"],
                  ["biggest", "Biggest"],
                ]
            ).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-ledger" aria-live="polite">
        {state.busy
          ? "Loading results…"
          : `${state.total} ${nfts ? (state.total === 1 ? "collectible" : "collectibles") : state.total === 1 ? "collection" : "collections"}${q ? ` matching “${q}”` : ""}`}
      </p>
      {!nfts && (
        <p className="muted directory-explanation">
          {sort === "popular"
            ? "Ranked by likes, then followers."
            : sort === "biggest"
              ? "Ranked by current public holdings."
              : "Newest public profiles first. Unknown creation dates appear last."}
        </p>
      )}
      {state.pending > 0 && (
        <p role="status">
          {state.pending} records are being indexed. Refresh for new results.
        </p>
      )}
      <div className={nfts ? "gallery-grid" : "collection-directory"}>
        {state.items.map((entry, index) =>
          "tokenId" in entry ? (
            <PublicCard
              key={entry.tokenId}
              item={entry}
              nav={props.nav}
              to={entry.href}
            />
          ) : (
            <CollectionRow
              key={entry.address}
              {...props}
              entry={entry}
              rank={sort === "popular" && !q ? index + 1 : undefined}
            />
          ),
        )}
      </div>
      {!state.busy && !state.error && !state.items.length && (
        <div className="empty-state compact">
          <h2>
            {q
              ? "No matches yet."
              : nfts
                ? "Every collection starts somewhere."
                : "Room for your collection."}
          </h2>
          <p>
            {q
              ? "Try another name or clear your search."
              : "Published profiles and confirmed artwork will appear here."}
          </p>
          {q ? (
            <button
              className={btn}
              onClick={() => {
                setDraft("");
                props.nav(root);
              }}
            >
              Clear search
            </button>
          ) : (
            <RouteLink
              nav={props.nav}
              to={nfts ? "/mint" : "/settings/profile"}
              className={primary}
            >
              {nfts ? "Mint a picture" : "Create your collection"}
            </RouteLink>
          )}
        </div>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      <div className="actions discovery-pagination">
        {state.stale ? (
          <button className={btn} onClick={() => void refresh()}>
            Refresh results
          </button>
        ) : state.error ? (
          <button
            className={btn}
            disabled={state.busy}
            onClick={() => void retry()}
          >
            Retry
          </button>
        ) : (
          state.nextCursor && (
            <button
              className={btn}
              disabled={state.busy}
              onClick={() => void more()}
            >
              {state.busy ? "Loading…" : "Load more"}
            </button>
          )
        )}
        {!state.stale && (
          <button
            className="text-button"
            disabled={state.busy}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        )}
      </div>
    </section>
  );
}
type Recent = {
  id: string;
  kind: string;
  block: number;
  tx: string;
  tokenId: string;
  metadata: Metadata;
};
export function Home(
  props: Props & { sponsorEnabled: boolean; indexMessage: string },
) {
  const collections = useResults<CollectionEntry>(
    `/api/discovery/collections?limit=6${props.identity ? `&viewer=${props.identity.address}` : ""}`,
    (i) => i.address,
  );
  const art = useResults<DiscoveredItem>(
    "/api/discovery/nfts?limit=8",
    (i) => i.tokenId,
  );
  const [events, setEvents] = useState<Recent[]>([]),
    [eventError, setEventError] = useState(""),
    [eventBusy, setEventBusy] = useState(true);
  const generation = useRef(0);
  async function loadEvents() {
    const run = ++generation.current;
    setEventBusy(true);
    setEventError("");
    try {
      const data = await api<{ events: Recent[] }>("/api/discovery/recent");
      if (run === generation.current) setEvents(data.events);
    } catch (e) {
      if (run === generation.current) setEventError((e as Error).message);
    } finally {
      if (run === generation.current) setEventBusy(false);
    }
  }
  useEffect(() => {
    void loadEvents();
    return () => {
      generation.current++;
    };
  }, []);
  return (
    <>
      <section className="hero discovery-hero">
        <div>
          <p className="eyebrow">
            <span className="live-dot" /> Made to keep. Made to move.
          </p>
          <h1>
            The collectible
            <br />
            is <span>the file.</span>
          </h1>
          <p>
            Pictures with ownership you can pass on.
            <br />
            Start with your wallet. Make a file when it’s time to share.
          </p>
          <div className="actions">
            <RouteLink
              nav={props.nav}
              to="/settings/profile"
              className={primary}
            >
              Create your collection ↗
            </RouteLink>
            <RouteLink nav={props.nav} to="/how-it-works" className={btn}>
              How it works
            </RouteLink>
          </div>
          <p className="hero-note">
            <RouteLink nav={props.nav} to="/claim">
              Receive a picture
            </RouteLink>
            <span aria-hidden="true"> · </span>
            <RouteLink nav={props.nav} to="/recovery">
              Restore a collection
            </RouteLink>
          </p>
          <p className="text-ledger">
            {props.sponsorEnabled
              ? "Sponsored on ZVM devnet · subject to availability and limits"
              : "ZVM devnet · sponsorship currently unavailable"}
          </p>
        </div>
        <div className="hero-stack" aria-label="Illustrative collectible cards">
          <div className="hero-stack-back" />
          <div className="hero-stack-front">
            <img src={logo} alt="Zenon" />
            <strong>Your next original.</strong>
            <span className="mono">your-picture.zft.png</span>
          </div>
          <span className="text-ledger">
            Illustration · your artwork goes here
          </span>
        </div>
      </section>
      <section className="home-section">
        <div className="section-heading">
          <div>
            <p className="text-ledger">People with an eye</p>
            <h2>Collections worth a look.</h2>
          </div>
          <RouteLink to="/explore" nav={props.nav}>
            See all collections ↗
          </RouteLink>
        </div>
        <div className="home-collections">
          {collections.state.items.map((entry, i) => (
            <CollectionRow
              key={entry.address}
              {...props}
              entry={entry}
              rank={i + 1}
            />
          ))}
        </div>
        {collections.state.busy && <p role="status">Loading collections…</p>}
        {collections.state.error ? (
          <p role="alert">
            {collections.state.error}{" "}
            <button className={btn} onClick={() => void collections.refresh()}>
              Retry collections
            </button>
          </p>
        ) : (
          !collections.state.busy &&
          !collections.state.items.length && (
            <p>
              Be one of the first to publish a collection.{" "}
              <RouteLink to="/settings/profile" nav={props.nav}>
                Create yours ↗
              </RouteLink>
            </p>
          )
        )}
      </section>
      <section className="home-section">
        <div className="section-heading">
          <div>
            <p className="text-ledger">Just minted</p>
            <h2>Fresh from the network.</h2>
          </div>
          <RouteLink to="/explore/nfts" nav={props.nav}>
            Browse all NFTs ↗
          </RouteLink>
        </div>
        <p className="index-status">{props.indexMessage}</p>
        <div className="gallery-grid">
          {art.state.items.map((item) => (
            <PublicCard
              key={item.tokenId}
              item={item}
              nav={props.nav}
              to={item.href}
            />
          ))}
        </div>
        {art.state.busy && <p role="status">Loading artwork…</p>}
        {art.state.error ? (
          <p role="alert">
            {art.state.error}{" "}
            <button className={btn} onClick={() => void art.refresh()}>
              Retry artwork
            </button>
          </p>
        ) : (
          !art.state.busy &&
          !art.state.items.length && (
            <p>
              {art.state.pending
                ? "Confirmed artwork is being indexed."
                : "The first picture could be yours."}{" "}
              <RouteLink to="/mint" nav={props.nav}>
                Mint a picture ↗
              </RouteLink>
            </p>
          )
        )}
      </section>
      <section className="home-section">
        <div className="section-heading">
          <div>
            <p className="text-ledger">Confirmed on ZVM</p>
            <h2>Pictures on the move.</h2>
          </div>
          <RouteLink to="/activity" nav={props.nav}>
            All activity ↗
          </RouteLink>
        </div>
        <div className="recent-discovery">
          {events.map((e) => (
            <article key={e.id}>
              <RouteLink
                nav={props.nav}
                to={`/item/${e.tokenId}`}
                className="recent-art"
              >
                <img src={`/art/${e.metadata.imageHash.slice(2)}.png`} alt="" />
                <span>
                  <strong>{e.metadata.name}</strong>
                  <span>
                    {e.kind === "mint" ? "Minted" : "Ownership changed"} · block{" "}
                    {e.block.toLocaleString()}
                  </span>
                </span>
              </RouteLink>
              {e.kind === "mint" && (
                <RouteLink nav={props.nav} to={`/p/${e.metadata.creator}`}>
                  Creator {short(e.metadata.creator)}
                </RouteLink>
              )}
              <a
                href={`https://devnet.zenon.foo/explorer/tx/${e.tx}`}
                target="_blank"
                rel="noreferrer"
              >
                Transaction ↗
              </a>
            </article>
          ))}
        </div>
        {eventBusy && <p role="status">Loading activity…</p>}
        {eventError ? (
          <p role="alert">
            {eventError}{" "}
            <button className={btn} onClick={() => void loadEvents()}>
              Retry activity
            </button>
          </p>
        ) : (
          !eventBusy &&
          !events.length && <p>No confirmed public activity yet.</p>
        )}
      </section>
      <section className="home-explanation">
        <p className="text-ledger">
          A small file. A different kind of collection.
        </p>
        <h2>
          Make it yours.
          <br />
          Then make someone’s day.
        </h2>
        <div className="home-steps">
          {[
            [
              "01",
              "Mint a picture",
              "Choose a JPG or PNG. Keep the collectible in your wallet.",
            ],
            [
              "02",
              "Show your collection",
              "Publish the pieces you want people to see. Your public gallery is yours to curate.",
            ],
            [
              "03",
              "Pass it on",
              "Make a transferable PNG and send the original file. The next person claims it to change ownership.",
            ],
            [
              "04",
              "Keep a way back",
              "Back up file keys before using them. Store recovery downloads somewhere private.",
            ],
          ].map(([n, title, text]) => (
            <div key={n}>
              <span className="mono">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <RouteLink to="/how-it-works" nav={props.nav}>
          See how ownership works ↗
        </RouteLink>
      </section>
      <section className="home-closing">
        <p className="text-ledger">Your collection starts with you</p>
        <h2>
          Find a picture.
          <br />
          Give it a future.
        </h2>
        <div className="actions">
          <RouteLink to="/settings/profile" nav={props.nav} className={primary}>
            Create your collection ↗
          </RouteLink>
          <RouteLink to="/mint" nav={props.nav} className={btn}>
            Mint a picture
          </RouteLink>
          <RouteLink to="/recovery" nav={props.nav}>
            Restore a collection
          </RouteLink>
        </div>
      </section>
    </>
  );
}
