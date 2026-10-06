import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Metadata } from "../../../packages/protocol";
import { digest } from "../../../packages/protocol";
import type { Profile } from "../../../packages/protocol/public";
import type { Identity } from "./identity";
import manifest from "../../../packages/protocol/deployment.json";
import { verifyPublicEvidence } from "../../../packages/protocol/public-proof";
import { PublicDetail } from "./proof-card";
import { Modal } from "./site-controls";
import { api, ApiError, signedRequest } from "./api";
import type { ActivityKind } from "../../../packages/protocol/activity";
import { ActivityLoader, relativeActivityTime } from "./activity-loader";
import { profileMediaURL } from "../../../packages/protocol/profile-media";
import {
  ProfileImage,
  ProfileMediaEditor,
  type MediaDraft,
} from "./profile-media";

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
export function RouteLink({
  to,
  nav,
  children,
  className,
  current,
}: {
  to: string;
  nav: Navigation["nav"];
  children: React.ReactNode;
  className?: string;
  current?: boolean;
}) {
  return (
    <a
      href={to}
      className={className}
      aria-current={current ? "page" : undefined}
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
const activityVerbs: Record<ActivityKind, string> = {
  profile_created: "started a collection",
  profile_updated: "updated their profile",
  follow: "followed",
  unfollow: "unfollowed",
  like: "liked",
  unlike: "removed their like from",
  published: "published",
  minted: "minted",
  transferred: "Ownership changed",
};
export function Activity({
  profile,
  path = "/activity",
  viewer = "",
  nav,
  onUnlock,
}: {
  profile?: string;
  path?: string;
  viewer?: string;
  nav: Navigation["nav"];
  onUnlock: (returnTo: string) => void;
}) {
  const following =
    !profile &&
    new URLSearchParams(path.split("?")[1] ?? "").get("view") === "following";
  const query = new URLSearchParams({
    view: following ? "following" : "everyone",
    ...(viewer ? { viewer } : {}),
  });
  const endpoint = `${profile ? `/api/profiles/${profile}/activity` : "/api/activity"}?${query}`;
  const [, render] = useState(0),
    [now, setNow] = useState(Date.now());
  const loader = useMemo(
    () => new ActivityLoader(() => render((n) => n + 1)),
    [],
  );
  const state = loader.state;
  const Heading = profile ? "h2" : "h1";
  useEffect(() => {
    void loader.reset(endpoint);
    return () => loader.stop();
  }, [endpoint, loader]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <section aria-label={profile ? "Profile activity" : "Public activity"}>
      <div className="section-heading">
        <div>
          <p className="text-ledger">Public activity · ZVM devnet</p>
          <Heading>
            {profile ? "Collection activity" : "Around the network."}
          </Heading>
        </div>
        <button
          className={btn}
          disabled={state.busy}
          onClick={() => void loader.reset(endpoint)}
        >
          Refresh
        </button>
      </div>
      {!profile && (
        <nav className="discovery-tabs" aria-label="Activity view">
          <RouteLink
            to="/activity"
            nav={nav}
            className={!following ? "selected" : ""}
            current={!following}
          >
            Everyone
          </RouteLink>
          <RouteLink
            to="/activity?view=following"
            nav={nav}
            className={following ? "selected" : ""}
            current={following}
          >
            Following
          </RouteLink>
        </nav>
      )}
      <p className="muted activity-explanation">
        Public profile actions and confirmed ownership changes. Likes and
        follows stay in history after you undo them. Older profile actions are
        unavailable.
      </p>
      <div className="journal-list" aria-busy={state.busy}>
        {state.events.map((e) => (
          <article className="journal-row" key={e.id}>
            {e.item ? (
              <RouteLink to={e.item.href} nav={nav} className="journal-art">
                <img
                  src={`/art/${e.item.imageHash.slice(2)}.png`}
                  alt={e.item.title}
                  loading="lazy"
                />
              </RouteLink>
            ) : (
              <span className="journal-symbol" aria-hidden="true">
                {e.kind.includes("like")
                  ? "♡"
                  : e.kind.includes("follow")
                    ? "↗"
                    : "+"}
              </span>
            )}
            <div className="journal-description">
              <p>
                {e.actor && (
                  <>
                    <RouteLink to={`/p/${e.actor.address}`} nav={nav}>
                      {e.actor.name.startsWith("0x")
                        ? short(e.actor.name)
                        : e.actor.name}
                    </RouteLink>{" "}
                  </>
                )}
                {activityVerbs[e.kind]}
                {e.target && (
                  <>
                    {" "}
                    <RouteLink to={`/p/${e.target.address}`} nav={nav}>
                      {e.target.name.startsWith("0x")
                        ? short(e.target.name)
                        : e.target.name}
                    </RouteLink>
                  </>
                )}
                {e.item && (
                  <>
                    {e.kind === "transferred" ? " for " : " "}
                    <RouteLink to={e.item.href} nav={nav}>
                      {e.item.title}
                    </RouteLink>
                  </>
                )}
                .
              </p>
              <p className="journal-details">
                {e.occurredAt ? (
                  <time
                    dateTime={new Date(e.occurredAt).toISOString()}
                    title={new Date(e.occurredAt).toLocaleString()}
                    aria-label={new Date(e.occurredAt).toLocaleString()}
                  >
                    {relativeActivityTime(e.occurredAt, now)}
                  </time>
                ) : (
                  <span>Time unavailable</span>
                )}
                {" · "}
                {e.chain ? (
                  <>
                    <span>Confirmed block {e.chain.block}</span>
                    {" · "}
                    <a
                      href={`https://devnet.zenon.foo/explorer/tx/${e.chain.transaction}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Transaction ↗
                    </a>
                  </>
                ) : (
                  <span>Public profile action</span>
                )}
              </p>
            </div>
          </article>
        ))}
      </div>
      {state.busy && <p role="status">Loading activity…</p>}
      {state.error && (
        <div className="activity-error" role="alert">
          <p>{state.error}</p>
          <button
            className={btn}
            disabled={state.busy}
            onClick={() =>
              void (state.stale
                ? loader.reset(endpoint)
                : loader.load(!!state.nextCursor))
            }
          >
            {state.stale ? "Refresh activity" : "Retry activity"}
          </button>
        </div>
      )}
      {!state.busy && !state.error && !state.events.length && (
        <div className="empty-state">
          {state.state === "guest" ? (
            <>
              <h3>Follow your people.</h3>
              <p>
                Connect your wallet to see public activity from the profiles you
                follow.
              </p>
              <button
                className={btn}
                onClick={() => onUnlock("/activity?view=following")}
              >
                Connect wallet
              </button>
            </>
          ) : state.state === "no-follows" ? (
            <>
              <h3>Your Following feed starts here.</h3>
              <p>
                You are not following anyone yet. Find a collection and choose
                Follow.
              </p>
              <RouteLink to="/explore" nav={nav} className={btn}>
                Explore collections
              </RouteLink>
            </>
          ) : (
            <>
              <h3>
                {following
                  ? "No activity from your follows yet."
                  : "No public activity yet."}
              </h3>
              <p>
                {following
                  ? "New public actions from the people you follow will appear here."
                  : "Published profile actions and confirmed collectibles will appear here."}
              </p>
            </>
          )}
        </div>
      )}
      {state.nextCursor && !state.stale && (
        <button
          className={btn}
          disabled={state.busy}
          onClick={() => void loader.load(true)}
        >
          More activity
        </button>
      )}
    </section>
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
    [people, setPeople] = useState<
      { address: string; name: string | null; avatar?: string | null }[]
    >([]),
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
            <span className="mini-avatar">
              <ProfileImage
                src={profileMediaURL(p.address, p.avatar)}
                fallback={(p.name || "Z").slice(0, 1)}
              />
            </span>
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
  identity,
  viewer,
  onUnlock,
}: {
  address: string;
  path: string;
  identity?: Identity;
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
    if (!identity) {
      setGuest(kind);
      return;
    }
    setBusy(true);
    try {
      await signedRequest(
        "/api/social",
        { kind, target: address, active },
        identity!,
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
          " If this wallet is new, publish its profile first.",
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
      <div
        className={`profile-cover rich-cover ${profile.cover ? "custom-cover" : ""}`}
      >
        <ProfileImage
          src={profileMediaURL(profile.address, profile.cover)}
          fallback={
            data.featuredItem && (
              <ProfileImage
                src={`/art/${data.featuredItem.metadata.imageHash.slice(2)}.png`}
              />
            )
          }
        />
        {!profile.cover && (
          <span className="cover-word">KEEP IT. PASS IT ON.</span>
        )}
      </div>
      <section className="profile-heading">
        <div className="profile-top">
          <div className="avatar">
            <ProfileImage
              src={profileMediaURL(profile.address, profile.avatar)}
              fallback={profile.name.slice(0, 1).toUpperCase()}
            />
          </div>
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
            {!identity && (
              <button className={btn} onClick={() => setGuest("unlock")}>
                Connect wallet
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
              ? "Your profile is ready. You can continue with the action above."
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
        <Activity
          profile={address}
          nav={nav}
          onUnlock={onUnlock}
          viewer={viewer}
        />
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
        <Modal title="Connect your wallet" onClose={() => setGuest("")}>
          <p>
            {guest === "unlock"
              ? "Your wallet address is your profile identity. Connect the matching wallet to edit your profile."
              : "Connect your wallet to like and follow. You will return here to finish your action."}
          </p>
          <button
            className={btn}
            onClick={() => {
              setGuest("");
              onUnlock(`${root}?intent=${guest}`);
            }}
          >
            Connect wallet
          </button>
        </Modal>
      )}
    </>
  );
}
export function EditProfile({
  identity,
  nav,
  onError,
}: { identity: Identity } & Navigation) {
  const [profile, setProfile] = useState<Profile>(),
    [name, setName] = useState(""),
    [bio, setBio] = useState(""),
    [featured, setFeatured] = useState(""),
    [pieces, setPieces] = useState<PublicItem[]>([]),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [avatar, setAvatar] = useState<MediaDraft>(),
    [cover, setCover] = useState<MediaDraft>(),
    [conflict, setConflict] = useState(false),
    [reload, setReload] = useState(0);
  const generation = useRef(0),
    submitting = useRef(false);
  useEffect(() => {
    let done = false;
    generation.current++;
    setReady(false);
    setConflict(false);
    setAvatar(undefined);
    setCover(undefined);
    (async () => {
      try {
        const account = identity!;
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
        let created: PublicItem[] = [];
        if (data)
          created = (
            await api<{ items: PublicItem[] }>(
              `/api/profiles/${account.address}/created`,
            )
          ).items;
        if (data) {
          const held = await api<{ items: PublicItem[] }>(
            `/api/profiles/${account.address}/collection`,
          );
          if (done) return;
          setPieces([
            ...created,
            ...held.items.filter(
              (i) => !created.some((o) => o.tokenId === i.tokenId),
            ),
          ]);
        }
        if (done) return;
        setReady(true);
      } catch (e) {
        if (!done) onError((e as Error).message);
      }
    })();
    return () => {
      done = true;
      generation.current++;
    };
  }, [identity.address, reload]);
  return (
    <section className="panel narrow">
      <p className="text-ledger">Your public identity</p>
      <h1>Make it yours.</h1>
      <p className="mono wrap">{identity.address}</p>
      <p>
        Your name, bio and profile images will be public. Imported collectibles
        stay private until you publish each one from your local collection.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current || !ready || conflict) return;
          submitting.current = true;
          const run = generation.current;
          setBusy(true);
          try {
            await signedRequest(
              "/api/profile",
              {
                name,
                bio,
                featured: featured || null,
                revision: profile?.revision ?? 0,
                ...(avatar !== undefined ? { avatar } : {}),
                ...(cover !== undefined ? { cover } : {}),
              },
              identity!,
            );
            if (run === generation.current) nav(`/p/${profile!.address}`);
          } catch (e) {
            if (run === generation.current) {
              if (e instanceof ApiError && e.status === 409) setConflict(true);
              onError((e as Error).message);
            }
          } finally {
            submitting.current = false;
            if (run === generation.current) setBusy(false);
          }
        }}
      >
        <div className="profile-media-editors">
          <ProfileMediaEditor
            kind="avatar"
            address={identity.address}
            saved={profile?.avatar}
            value={avatar}
            onChange={setAvatar}
            disabled={!ready || busy || conflict}
          />
          <ProfileMediaEditor
            kind="cover"
            address={identity.address}
            saved={profile?.cover}
            value={cover}
            onChange={setCover}
            disabled={!ready || busy || conflict}
          />
        </div>
        <p className="muted">
          Choose a JPG or PNG up to 10 MiB. Crop and preview here, then save
          everything with one wallet signature.
        </p>
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
            <option value="">No featured artwork</option>
            {pieces.map((i) => (
              <option key={i.tokenId} value={i.tokenId}>
                {i.metadata.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Featured artwork appears on your profile when no custom cover is set.
        </p>
        <p className="muted">
          Shared previews may be retained by social platforms after an edit.
        </p>
        {conflict && (
          <div role="alert">
            <p>
              Your profile changed in another session. Reload the saved profile
              before editing again. This replaces your unsaved changes.
            </p>
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => setReload((n) => n + 1)}
            >
              Reload saved profile
            </button>
          </div>
        )}
        <button
          className="nom-btn nom-btn--primary nom-btn--default"
          type="submit"
          disabled={!ready || busy || conflict}
        >
          {busy ? "Saving…" : "Publish profile"}
        </button>
      </form>
    </section>
  );
}
