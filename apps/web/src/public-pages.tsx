import React, { useEffect, useRef, useState } from "react";
import type { Metadata } from "../../../packages/protocol";
import { digest } from "../../../packages/protocol";
import type { Profile } from "../../../packages/protocol/public";
import type { Vault } from "../../../packages/vault";
import manifest from "../../../packages/protocol/deployment.json";
import { verifyPublicEvidence } from "../../../packages/protocol/public-proof";
import { PublicDetail } from "./proof-card";
import { Modal } from "./site-controls";
import { api, ApiError, signedRequest } from "./api";

export type PublicItem = {
  tokenId: string;
  metadataHash: string;
  metadata: Metadata;
  owner?: string;
  nonce?: string;
  blockNumber?: string;
  blockHash?: string;
  publicationNonce?: string;
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
export { PublicDetail } from "./proof-card";
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
function NetworkDialog({
  address,
  kind,
  onClose,
  nav,
}: {
  address: string;
  kind: "followers" | "following";
  onClose: () => void;
  nav: Navigation["nav"];
}) {
  const [tab, setTab] = useState(kind),
    [people, setPeople] = useState<{ address: string; name: string | null }[]>(
      [],
    ),
    [cursor, setCursor] = useState<string | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  async function load(more = false) {
    const run = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const data = await api<{
        profiles: typeof people;
        nextCursor: string | null;
      }>(
        `/api/profiles/${address}/${tab}${more && cursor ? `?after=${cursor}` : ""}`,
      );
      if (run === generation.current) {
        setPeople((old) => (more ? [...old, ...data.profiles] : data.profiles));
        setCursor(data.nextCursor);
      }
    } catch (e) {
      if (run === generation.current) setError((e as Error).message);
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setPeople([]);
    setCursor(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [tab, address]);
  return (
    <Modal title="Network" onClose={onClose}>
      <div
        className="segment-control"
        role="tablist"
        aria-label="Network views"
      >
        {(["followers", "following"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "followers" ? "Followers" : "Following"}
          </button>
        ))}
      </div>
      <div className="people-list">
        {people.map((p) => (
          <RouteLink
            key={p.address}
            to={`/p/${p.address}`}
            nav={(to) => {
              onClose();
              nav(to);
            }}
          >
            <span className="mini-avatar">{(p.name || "Z").slice(0, 1)}</span>
            <span>
              {p.name || short(p.address)}
              <small className="mono">{short(p.address)}</small>
            </span>
          </RouteLink>
        ))}
      </div>
      {busy && <p role="status">Loading profiles…</p>}
      {!busy && !error && !people.length && (
        <p>
          {tab === "followers"
            ? "No followers yet."
            : "This profile is not following anyone yet."}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {(error || cursor) && (
        <button
          className={btn}
          disabled={busy}
          onClick={() => load(!!cursor && !error)}
        >
          {error ? "Retry" : "Load more"}
        </button>
      )}
    </Modal>
  );
}
export function PublicProfile({
  address,
  path,
  nav,
  onError,
  vault,
  viewer,
  onUnlock,
}: {
  address: string;
  path: string;
  vault?: Vault;
  viewer: string;
  onUnlock: (returnTo: string) => void;
} & Navigation) {
  const [data, setData] = useState<ProfileData>(),
    [items, setItems] = useState<PublicItem[]>([]),
    [cursor, setCursor] = useState<string | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [network, setNetwork] = useState<"followers" | "following">(),
    [guest, setGuest] = useState(""),
    [checking, setChecking] = useState(false),
    [states, setStates] = useState<Record<string, string>>({});
  const generation = useRef(0),
    reverify = useRef(0);
  const query = new URLSearchParams(path.split("?")[1] ?? ""),
    requested = query.get("tab") ?? "collection",
    tab = ["created", "collection", "sent", "activity"].includes(requested)
      ? requested
      : "collection",
    selected = query.get("nft"),
    epoch = query.get("epoch") ?? undefined;
  const root = `/p/${address.toLowerCase()}`,
    owner = viewer.toLowerCase() === address.toLowerCase();
  async function load(more = false) {
    const run = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const p = await api<ProfileData>(
        `/api/profiles/${address}${viewer ? `?viewer=${viewer}` : ""}`,
      );
      if (run !== generation.current) return;
      setData(p);
      if (tab !== "activity") {
        const r = await api<{ items: PublicItem[]; nextCursor: string | null }>(
          `/api/profiles/${address}/${tab}${more && cursor ? `?cursor=${cursor}` : ""}`,
        );
        if (run === generation.current) {
          setItems((old) => (more ? [...old, ...r.items] : r.items));
          setCursor(r.nextCursor);
        }
      }
    } catch (e) {
      if (run === generation.current) setError((e as Error).message);
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setStates({});
    setChecking(false);
    void load();
    return () => {
      generation.current++;
      reverify.current++;
    };
  }, [address, tab, viewer]);
  const close = () => {
    const q = new URLSearchParams(query);
    q.delete("nft");
    q.delete("epoch");
    nav(`${root}${q.size ? `?${q}` : ""}`);
  };
  async function social(kind: "follow" | "like", active: boolean) {
    if (!vault?.unlocked) {
      setGuest(kind);
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
      setNotice(
        kind === "follow"
          ? active
            ? "Following collection"
            : "Unfollowed collection"
          : active
            ? "Collection liked"
            : "Like removed",
      );
    } catch (e) {
      onError(
        (e as Error).message +
          " If this is a new local collection, publish your profile from My collection first.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function verifyVisible() {
    const run = ++reverify.current;
    setChecking(true);
    setStates({});
    for (let start = 0; start < items.length; start += 4) {
      if (run !== reverify.current) return;
      await Promise.all(
        items.slice(start, start + 4).map(async (i) => {
          let label = "Could not check";
          try {
            const r = await api<
              import("../../../packages/protocol/public-proof").Evidence
            >(
              `/api/items/${i.tokenId}?profile=${address}${i.publicationNonce === undefined ? "" : `&epoch=${i.publicationNonce}`}`,
            );
            const check = await verifyPublicEvidence(
              r,
              undefined,
              Date.now(),
              address,
            );
            label =
              check.current === "pass"
                ? "Ownership current"
                : check.current === "historical"
                  ? "Ownership changed"
                  : check.current === "expired"
                    ? "Proof expired"
                    : check.current === "fail"
                      ? "Proof invalid"
                      : !r.publication && r.chainVerified
                        ? "Chain checked · creator view"
                        : "Could not check";
          } catch {}
          if (run === reverify.current)
            setStates((old) => ({ ...old, [i.tokenId]: label }));
        }),
      );
    }
    if (run === reverify.current) setChecking(false);
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
  return (
    <>
      <div className="profile-cover rich-cover">
        {data.featuredItem && (
          <img
            src={`/art/${data.featuredItem.metadata.imageHash.slice(2)}.png`}
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
                  aria-pressed={data.viewer.following}
                  onClick={() => social("follow", !data.viewer.following)}
                >
                  {data.viewer.following ? "Following" : "Follow"}
                </button>
                <button
                  className={btn}
                  disabled={busy}
                  aria-pressed={data.viewer.liked}
                  onClick={() => social("like", !data.viewer.liked)}
                >
                  {data.viewer.liked ? "♥ Liked" : "♡ Like"} · {counts.likes}
                </button>
              </>
            )}
            <button
              className={btn}
              onClick={() =>
                navigator.clipboard
                  .writeText(`${location.origin}${root}`)
                  .then(() => setNotice("Profile link copied"))
                  .catch(() => onError("Could not copy the profile link."))
              }
            >
              Share
            </button>
            {!vault?.unlocked && (
              <button className={btn} onClick={() => setGuest("unlock")}>
                Unlock
              </button>
            )}
          </div>
        </div>
        <p className="text-ledger">Public collection · ZVM devnet</p>
        <h1>{profile.name}</h1>
        <button
          className="identity mono"
          title={address}
          onClick={() =>
            navigator.clipboard
              .writeText(address)
              .then(() => setNotice("Public identity copied"))
              .catch(() => onError("Could not copy the identity."))
          }
        >
          {short(address)} ⧉
        </button>
        <p className="profile-bio">{profile.bio}</p>
        <div className="profile-counts">
          {(
            [
              ["collected", "Collected", "collection"],
              ["sent", "Sent", "sent"],
              ["created", "Created", "created"],
            ] as const
          ).map(([key, label, view]) => (
            <RouteLink key={key} nav={nav} to={`${root}?tab=${view}`}>
              <strong>{counts[key]}</strong>
              <span>{label}</span>
            </RouteLink>
          ))}
          <div>
            <strong>{counts.likes}</strong>
            <span>Likes</span>
          </div>
          {(["followers", "following"] as const).map((kind) => (
            <button
              className="text-button"
              key={kind}
              onClick={() => setNetwork(kind)}
            >
              <strong>{counts[kind]}</strong>
              <span>{kind === "followers" ? "Followers" : "Following"}</span>
            </button>
          ))}
        </div>
        <p role="status" className="profile-notice">
          {notice ||
            (query.get("intent")
              ? "Your collection is unlocked. You can continue with the profile action above."
              : "")}
        </p>
      </section>
      <nav className="profile-tabs" aria-label="Profile views">
        {[
          ["collection", "Collection"],
          ["sent", "Sent"],
          ["activity", "Activity"],
          ["created", "Created"],
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
        {tab !== "activity" && (
          <button
            className={btn}
            disabled={busy || checking || !items.length}
            onClick={verifyVisible}
          >
            {checking ? "Checking…" : "Re-verify"}
          </button>
        )}
      </nav>
      {error && <p role="alert">{error}</p>}
      {tab === "activity" ? (
        <Activity profile={address} onError={onError} />
      ) : (
        <>
          <p className="muted">
            {tab === "collection"
              ? "Public holdings with an unexpired ownership statement."
              : tab === "sent"
                ? "Previous public ownership epochs. Changes can include transfers or cancellations."
                : "Permanent mint provenance, independent of current ownership."}
          </p>
          <div className="gallery-grid">
            {items.map((i) => (
              <div key={i.tokenId}>
                <PublicCard
                  item={i}
                  nav={nav}
                  to={`${root}?tab=${tab}&nft=${i.tokenId}${i.publicationNonce === undefined ? "" : `&epoch=${i.publicationNonce}`}`}
                />
                <p role="status" className="card-check">
                  {states[i.tokenId] ||
                    (tab === "sent" ? "Previous ownership epoch" : "")}
                </p>
              </div>
            ))}
          </div>
          {busy && <p role="status">Loading public pieces…</p>}
          {!items.length && !busy && (
            <div className="empty-state compact">
              <h2>No public pieces here yet.</h2>
              <p>
                Holding publication is optional. Created items have a separate
                provenance view.
              </p>
            </div>
          )}
          {cursor && (
            <button
              className={`${btn} load-more`}
              disabled={busy}
              onClick={() => load(true)}
            >
              Load more
            </button>
          )}
        </>
      )}
      {selected && (
        <Modal title={`${profile.name} / Public artwork`} onClose={close} wide>
          <PublicDetail
            id={selected}
            context={address}
            epoch={epoch}
            nav={nav}
            onError={onError}
          />
        </Modal>
      )}
      {network && (
        <NetworkDialog
          address={address}
          kind={network}
          onClose={() => setNetwork(undefined)}
          nav={nav}
        />
      )}
      {guest && (
        <Modal
          title={
            guest === "unlock"
              ? "Unlock your collection"
              : "Start with your collection"
          }
          onClose={() => setGuest("")}
        >
          <p>
            {guest === "unlock"
              ? "Unlock this browser's vault or restore its recovery snapshot. Editing requires the matching profile identity."
              : "Unlock or create a local collection to like and follow public profiles. You will return here to finish your action."}
          </p>
          <button
            className={btn}
            onClick={() => {
              setGuest("");
              onUnlock(`${root}?intent=${guest}`);
            }}
          >
            Unlock or create collection
          </button>
          <RouteLink to="/recovery" nav={nav} className={btn}>
            Restore recovery file
          </RouteLink>
        </Modal>
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
