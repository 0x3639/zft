import React, { useEffect, useRef, useState } from "react";
import type { Metadata } from "../../../packages/protocol";
import { digest } from "../../../packages/protocol";
import type { Profile } from "../../../packages/protocol/public";
import type { Vault } from "../../../packages/vault";
import manifest from "../../../packages/protocol/deployment.json";
import { api, ApiError, signedRequest } from "./api";

export type PublicItem = {
  tokenId: string;
  metadataHash: string;
  metadata: Metadata;
  owner?: string;
  nonce?: string;
  blockNumber?: string;
  blockHash?: string;
};
type ProfileData = {
  featuredItem?: PublicItem | null;
  profile: Profile;
  counts: {
    created: number;
    collected: number;
    sent: number;
    followers: number;
    following: number;
    likes: number;
  };
  viewer: { following: boolean; liked: boolean };
};
type Navigation = {
  nav: (to: string) => void;
  onError: (message: string) => void;
};
export const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-6)}`;
const btn = "nom-btn nom-btn--outline nom-btn--default";
function RouteLink({
  to,
  nav,
  children,
  className,
}: {
  to: string;
  nav: Navigation["nav"];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (!e.metaKey && !e.ctrlKey && e.button === 0) {
          e.preventDefault();
          nav(to);
        }
      }}
    >
      {children}
    </a>
  );
}
export function PublicCard({
  item,
  nav,
  to,
}: {
  item: PublicItem;
  nav: Navigation["nav"];
  to?: string;
}) {
  return (
    <RouteLink
      to={to ?? `/item/${item.tokenId}`}
      nav={nav}
      className="art-card"
    >
      <img
        src={`/art/${item.metadata.imageHash.slice(2)}.png`}
        alt={item.metadata.name}
        loading="lazy"
      />
      <div className="art-info">
        <h3>{item.metadata.name}</h3>
        <p className="mono">{short(item.metadata.creator)}</p>
        <span className="text-ledger">ZVM devnet · public collectible</span>
      </div>
    </RouteLink>
  );
}
export function PublicDetail({
  id,
  nav,
  onError,
  context,
}: { id: string; context?: string } & Navigation) {
  const [item, setItem] = useState<PublicItem>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const i = await api<PublicItem>(
        `/api/items/${id}${context ? `?profile=${context}` : ""}`,
      );
      if (!i.metadata || digest(i.metadata) !== i.metadataHash)
        throw new Error("Metadata could not be verified.");
      setItem(i);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [id]);
  if (!item)
    return (
      <section className="empty-state">
        <h2>{error || "Reading the on-chain proof…"}</h2>
        {error && (
          <button className={btn} onClick={refresh}>
            Retry
          </button>
        )}
      </section>
    );
  const proof = () => {
    const data = {
      format: "zft-public-observation",
      version: 1,
      deployment: manifest,
      tokenId: item.tokenId,
      metadata: item.metadata,
      metadataHash: item.metadataHash,
      observed: {
        owner: item.owner,
        ownershipNonce: item.nonce,
        block: item.blockNumber,
        blockHash: item.blockHash,
      },
      note: "Public observation only. Re-query the pinned contract to verify current ownership.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `zft-proof-${id.slice(0, 12)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="flow-grid public-detail">
      <img
        className="detail-image"
        src={`/art/${item.metadata.imageHash.slice(2)}.png`}
        alt={item.metadata.name}
      />
      <div className="panel">
        <p className="text-ledger">Public collectible · ZVM devnet</p>
        <h1>{item.metadata.name}</h1>
        <p>{item.metadata.description}</p>
        <div className="actions">
          <a
            className={btn}
            href={`/art/${item.metadata.imageHash.slice(2)}.png`}
            download
          >
            Save image
          </a>
          <button className={btn} onClick={proof}>
            Public proof
          </button>
          <button
            className={btn}
            onClick={() =>
              navigator.clipboard
                .writeText(location.href)
                .then(() => setCopied(true))
                .catch((e) => onError(e.message))
            }
          >
            {copied ? "Link copied" : "Share"}
          </button>
        </div>
        <details className="proof-details" open>
          <summary>On-chain proof</summary>
          <dl>
            <dt>Creator</dt>
            <dd>
              <RouteLink to={`/p/${item.metadata.creator}`} nav={nav}>
                {item.metadata.creator}
              </RouteLink>
            </dd>
            <dt>Current owner · observed, not a permanent certificate</dt>
            <dd>{item.owner}</dd>
            <dt>Ownership nonce</dt>
            <dd>{item.nonce}</dd>
            <dt>Observed block</dt>
            <dd>{item.blockNumber}</dd>
            <dt>Image SHA-256</dt>
            <dd>{item.metadata.imageHash}</dd>
            <dt>Metadata SHA-256</dt>
            <dd>{item.metadataHash}</dd>
          </dl>
        </details>
        <button className={btn} disabled={busy} onClick={refresh}>
          {busy ? "Checking…" : "Re-verify ownership"}
        </button>
        {error && <p role="alert">Could not check: {error}</p>}
        <p className="muted public-note">
          The public image and proof contain no ownership key. Get the original
          transfer file from the current owner to claim this collectible.
        </p>
      </div>
    </section>
  );
}
export function Activity({
  profile,
  onError,
}: {
  profile?: string;
  onError: Navigation["onError"];
}) {
  const [events, setEvents] = useState<Record<string, string | number>[]>([]),
    [cursor, setCursor] = useState<string | null>(),
    [busy, setBusy] = useState(false);
  async function load(more = false) {
    setBusy(true);
    try {
      const data = await api<{
        events: Record<string, string | number>[];
        nextCursor: string | null;
      }>(
        `${profile ? `/api/profiles/${profile}/activity` : "/api/activity"}${more && cursor ? `?cursor=${cursor}` : ""}`,
      );
      setEvents((old) => (more ? [...old, ...data.events] : data.events));
      setCursor(data.nextCursor);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [profile]);
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="text-ledger">Confirmed on ZVM</p>
          <h2>{profile ? "Creation activity" : "Pictures on the move."}</h2>
        </div>
        <button className={btn} disabled={busy} onClick={() => load()}>
          Refresh
        </button>
      </div>
      <div className="activity-list">
        {events.map((e) => (
          <a
            className="activity-row"
            key={`${e.block_number}:${e.log_index}`}
            href={`https://devnet.zenon.foo/explorer/tx/${e.tx_hash}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="activity-symbol">
              {String(e.from_address) === "0x" + "0".repeat(40) ? "+" : "↗"}
            </span>
            <span>
              <strong>
                {String(e.from_address) === "0x" + "0".repeat(40)
                  ? "Minted"
                  : "Transferred"}
              </strong>
              <span className="mono">Token {short(String(e.token_id))}</span>
            </span>
            <span className="mono">
              {short(String(e.to_address))}
              <span>Block {e.block_number} ↗</span>
            </span>
          </a>
        ))}
      </div>
      {!busy && !events.length && <p>No indexed activity yet.</p>}
      {cursor && (
        <button className={btn} disabled={busy} onClick={() => load(true)}>
          More activity
        </button>
      )}
    </>
  );
}
export function PublicProfile({
  address,
  path,
  nav,
  onError,
  vault,
  viewer,
}: {
  address: string;
  path: string;
  vault?: Vault;
  viewer: string;
} & Navigation) {
  const [data, setData] = useState<ProfileData>(),
    [items, setItems] = useState<PublicItem[]>([]),
    [cursor, setCursor] = useState<string | null>(),
    [people, setPeople] = useState<{ address: string; name: string | null }[]>(
      [],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const query = new URLSearchParams(path.split("?")[1] ?? ""),
    tab = query.get("tab") ?? "created",
    selected = query.get("nft");
  const root = `/p/${address.toLowerCase()}`,
    dialog = useRef<HTMLDialogElement>(null);
  const owner = viewer.toLowerCase() === address.toLowerCase();
  async function load(more = false) {
    setBusy(true);
    setError("");
    try {
      const p = await api<ProfileData>(
        `/api/profiles/${address}${viewer ? `?viewer=${viewer}` : ""}`,
      );
      setData(p);
      if (tab === "activity") return;
      if (tab === "followers" || tab === "following") {
        const r = await api<{
          profiles: typeof people;
          nextCursor: string | null;
        }>(
          `/api/profiles/${address}/${tab}${more && cursor ? `?after=${cursor}` : ""}`,
        );
        setPeople((old) => (more ? [...old, ...r.profiles] : r.profiles));
        setCursor(r.nextCursor);
      } else {
        const t = ["created", "collection", "sent"].includes(tab)
          ? tab
          : "created";
        const r = await api<{ items: PublicItem[]; nextCursor: string | null }>(
          `/api/profiles/${address}/${t}${more && cursor ? `?cursor=${cursor}` : ""}`,
        );
        setItems((old) => (more ? [...old, ...r.items] : r.items));
        setCursor(r.nextCursor);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [address, tab, viewer]);
  useEffect(() => {
    if (selected && data && !dialog.current?.open) dialog.current?.showModal();
  }, [selected, data]);
  const close = () => nav(`${root}?tab=${tab}`);
  async function social(kind: "follow" | "like", active: boolean) {
    if (!vault?.unlocked) {
      nav("/collection");
      return;
    }
    setBusy(true);
    try {
      await signedRequest(
        "/api/social",
        { kind, target: address, active },
        await vault.profile(),
      );
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="empty-state">
        <h1>{error || "Loading public profile…"}</h1>
        {error && (
          <button className={btn} onClick={() => load()}>
            Retry
          </button>
        )}
      </section>
    );
  const { profile, counts } = data;
  const featured = data.featuredItem;
  return (
    <>
      <div className="profile-cover rich-cover">
        {featured && (
          <img
            src={`/art/${featured.metadata.imageHash.slice(2)}.png`}
            alt=""
          />
        )}
        <span className="cover-word">KEEP IT. PASS IT ON.</span>
      </div>
      <section className="profile-heading">
        <div className="profile-top">
          <div className="avatar">{profile.name.slice(0, 1).toUpperCase()}</div>
          <div className="actions">
            {owner ? (
              <RouteLink to="/settings/profile" nav={nav} className={btn}>
                Edit profile
              </RouteLink>
            ) : (
              <>
                <button
                  className={`${btn} ${data.viewer.following ? "is-active" : ""}`}
                  disabled={busy}
                  onClick={() => social("follow", !data.viewer.following)}
                >
                  {data.viewer.following ? "Following" : "Follow"}
                </button>
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() => social("like", !data.viewer.liked)}
                  aria-pressed={data.viewer.liked}
                >
                  {data.viewer.liked ? "♥ Liked" : "♡ Like"}
                </button>
              </>
            )}
            <button
              className={btn}
              onClick={() =>
                navigator.clipboard
                  .writeText(`${location.origin}${root}`)
                  .then(() => setCopied(true))
                  .catch((e) => onError(e.message))
              }
            >
              {copied ? "Link copied" : "Share"}
            </button>
          </div>
        </div>
        <p className="text-ledger">Public collection · ZVM devnet</p>
        <h1>{profile.name}</h1>
        <button
          className="identity mono"
          onClick={() =>
            navigator.clipboard
              .writeText(address)
              .then(() => setCopied(true))
              .catch((e) => onError(e.message))
          }
        >
          {short(address)} ⧉
        </button>
        <p className="profile-bio">{profile.bio}</p>
        <div className="profile-counts">
          {(
            [
              ["created", "Created"],
              ["collected", "Collected"],
              ["sent", "Sent"],
              ["followers", "Followers"],
              ["following", "Following"],
              ["likes", "Likes"],
            ] as const
          ).map(([key, label]) => (
            <RouteLink
              key={key}
              nav={nav}
              to={`${root}?tab=${key === "collected" ? "collection" : key === "likes" ? "created" : key}`}
            >
              <strong>{counts[key]}</strong>
              <span>{label}</span>
            </RouteLink>
          ))}
        </div>
      </section>
      <div
        className="profile-tabs"
        role="navigation"
        aria-label="Profile views"
      >
        {[
          ["created", "Created"],
          ["collection", "Collection"],
          ["sent", "Sent"],
          ["activity", "Activity"],
        ].map(([id, label]) => (
          <RouteLink
            key={id}
            to={`${root}?tab=${id}`}
            nav={nav}
            className={tab === id ? "selected" : ""}
          >
            {label}
          </RouteLink>
        ))}
        <button className={btn} disabled={busy} onClick={() => load()}>
          Refresh
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {tab === "activity" ? (
        <Activity profile={address} onError={onError} />
      ) : tab === "followers" || tab === "following" ? (
        <>
          <h2>{tab === "followers" ? "Followers" : "Following"}</h2>
          <div className="people-list">
            {people.map((p) => (
              <RouteLink key={p.address} to={`/p/${p.address}`} nav={nav}>
                <span className="mini-avatar">
                  {(p.name || "Z").slice(0, 1)}
                </span>
                <span>
                  {p.name || short(p.address)}
                  <small className="mono">{short(p.address)}</small>
                </span>
              </RouteLink>
            ))}
          </div>
          {!people.length && <p>No profiles here yet.</p>}
        </>
      ) : (
        <>
          <p className="muted">
            {tab === "collection"
              ? "Items this profile chose to publish with an ownership proof."
              : tab === "sent"
                ? "Previously published holdings whose ownership epoch has changed."
                : "Public creations are permanent mint provenance, independent of current ownership."}
          </p>
          <div className="gallery-grid">
            {items.map((i) => (
              <PublicCard
                key={i.tokenId}
                item={i}
                nav={nav}
                to={
                  tab === "sent"
                    ? `/item/${i.tokenId}`
                    : `${root}?tab=${tab}&nft=${i.tokenId}`
                }
              />
            ))}
          </div>
          {!items.length && !busy && (
            <div className="empty-state compact">
              <h2>No public pieces here yet.</h2>
              <p>
                Private browser collections are never published automatically.
              </p>
            </div>
          )}
        </>
      )}
      {cursor && tab !== "activity" && (
        <button
          className={`${btn} load-more`}
          disabled={busy}
          onClick={() => load(true)}
        >
          Load more
        </button>
      )}
      {selected && (
        <dialog
          ref={dialog}
          className="item-dialog"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <div className="dialog-bar">
            <span className="text-ledger">{profile.name} / Public artwork</span>
            <button className={btn} onClick={close} autoFocus>
              Close ×
            </button>
          </div>
          <PublicDetail
            id={selected}
            context={address}
            nav={nav}
            onError={onError}
          />
        </dialog>
      )}
    </>
  );
}
export function EditProfile({
  vault,
  nav,
  onError,
}: { vault: Vault } & Navigation) {
  const [profile, setProfile] = useState<Profile>(),
    [name, setName] = useState(""),
    [bio, setBio] = useState(""),
    [featured, setFeatured] = useState(""),
    [pieces, setPieces] = useState<PublicItem[]>([]),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const account = await vault.profile();
        let data: ProfileData | undefined;
        try {
          data = await api<ProfileData>(`/api/profiles/${account.address}`);
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
        }
        if (done) return;
        const p = data?.profile ?? {
          address: account.address,
          name: "",
          bio: "",
          featured: null,
          revision: 0,
          updated_at: 0,
        };
        setProfile(p);
        setName(p.name);
        setBio(p.bio);
        setFeatured(p.featured ?? "");
        if (data)
          setPieces(
            (
              await api<{ items: PublicItem[] }>(
                `/api/profiles/${account.address}/created`,
              )
            ).items,
          );
        if (data) {
          const held = await api<{ items: PublicItem[] }>(
            `/api/profiles/${account.address}/collection`,
          );
          setPieces((old) => [
            ...old,
            ...held.items.filter(
              (i) => !old.some((o) => o.tokenId === i.tokenId),
            ),
          ]);
        }
        setReady(true);
      } catch (e) {
        onError((e as Error).message);
      }
    })();
    return () => {
      done = true;
    };
  }, [vault]);
  return (
    <section className="panel narrow">
      <p className="text-ledger">Your public identity</p>
      <h1>Make it yours.</h1>
      <p>
        Your name and bio will be public. Imported collectibles stay private
        until you publish each one from your local collection.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await signedRequest(
              "/api/profile",
              {
                name,
                bio,
                featured: featured || null,
                revision: profile?.revision ?? 0,
              },
              await vault.profile(),
            );
            nav(`/p/${profile!.address}`);
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
            disabled={!ready || busy}
          />
        </label>
        <label>
          Bio
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={320}
            disabled={!ready || busy}
          />
        </label>
        <label>
          Featured artwork
          <select
            value={featured}
            onChange={(e) => setFeatured(e.target.value)}
            disabled={!ready || busy}
          >
            <option value="">Automatic cover</option>
            {pieces.map((i) => (
              <option key={i.tokenId} value={i.tokenId}>
                {i.metadata.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Shared previews may be retained by social platforms after an edit.
        </p>
        <button
          className="nom-btn nom-btn--primary nom-btn--default"
          type="submit"
          disabled={!ready || busy}
        >
          {busy ? "Saving…" : "Publish profile"}
        </button>
      </form>
    </section>
  );
}
