import { z } from "zod";
import { addressSchema, type Metadata } from "../../packages/protocol";
import type {
  ActivityEvent,
  ActivityPage,
} from "../../packages/protocol/activity";
import { HttpError } from "./http";
import type { Env } from "./types";

const number = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cursorSchema = z
  .object({
    v: z.literal(1),
    scope: z.string().max(100),
    viewer: z.string().max(42),
    revision: number,
    follows: number,
    publicMax: number,
    chainMax: number,
    until: number,
    key: z.tuple([number, z.enum(["public", "chain"]), number, number]),
  })
  .strict();
type Row = {
  kind: ActivityEvent["kind"];
  source: "public" | "chain";
  seq: number;
  sub: number;
  occurred_at: number;
  actor: string | null;
  actor_name: string | null;
  target: string | null;
  target_name: string | null;
  token_id: string | null;
  nonce: string | null;
  metadata_json: string | null;
  block_hash: string | null;
  tx_hash: string | null;
};
async function revision(env: Env) {
  return (await env.DB.prepare(
    "SELECT revision,follow_revision FROM activity_state WHERE id=1",
  ).first<{ revision: number; follow_revision: number }>())!;
}
const metadataJoin = `JOIN discovery_metadata d ON d.token_id=i.token_id AND d.metadata_hash=i.metadata_hash AND d.creator=i.creator AND d.version=1 AND d.valid=1`;

/** A bounded snapshot of public actions and canonical chain history. New actions
 * cannot shift an existing page; visibility changes require an explicit refresh. */
export async function activity(
  env: Env,
  url: URL,
  profile?: string,
): Promise<ActivityPage> {
  const view = url.searchParams.get("view") ?? "everyone";
  if (
    !["everyone", "following"].includes(view) ||
    (profile && view !== "everyone")
  )
    throw new HttpError(400, "Unknown activity view.");
  const viewer = url.searchParams.has("viewer")
    ? addressSchema.parse(url.searchParams.get("viewer")).toLowerCase()
    : "";
  const scope = profile
    ? `profile:${addressSchema.parse(profile).toLowerCase()}`
    : view;
  const limitText = url.searchParams.get("limit") ?? "24";
  if (!/^(?:[1-9]|1\d|2[0-4])$/.test(limitText))
    throw new HttpError(400, "Page size must be between 1 and 24.");
  const limit = Number(limitText),
    now = Date.now(),
    rev = await revision(env);
  let after: z.infer<typeof cursorSchema> | undefined;
  const raw = url.searchParams.get("cursor");
  if (raw) {
    try {
      if (raw.length > 2048) throw new Error();
      after = cursorSchema.parse(
        JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/"))),
      );
    } catch {
      throw new HttpError(400, "Invalid activity cursor.");
    }
    if (
      after.scope !== scope ||
      after.viewer !== (view === "following" ? viewer : "")
    )
      throw new HttpError(400, "Cursor belongs to a different activity view.");
    if (
      after.revision !== rev.revision ||
      after.until <= now ||
      (view === "following" && after.follows !== rev.follow_revision)
    )
      throw new HttpError(409, "Activity changed. Refresh to continue.");
  }
  if (view === "following" && !viewer)
    return { events: [], nextCursor: null, state: "guest" };
  if (
    view === "following" &&
    !(await env.DB.prepare(
      "SELECT 1 FROM relations WHERE actor=? AND kind='follow' LIMIT 1",
    )
      .bind(viewer)
      .first())
  )
    return { events: [], nextCursor: null, state: "no-follows" };
  const bounds = await env.DB.prepare(
    `SELECT
    COALESCE((SELECT MAX(id) FROM public_events),0) publicMax,
    COALESCE((SELECT MAX(block_number) FROM chain_events),0) chainMax,
    (SELECT MIN(expires)*1000 FROM possessions WHERE expires>?) expiry`,
  )
    .bind(Math.floor(now / 1000))
    .first<{ publicMax: number; chainMax: number; expiry: number | null }>();
  const publicMax = after?.publicMax ?? bounds!.publicMax,
    chainMax = after?.chainMax ?? bounds!.chainMax;
  const until =
    after?.until ?? Math.min(now + 300_000, bounds!.expiry ?? Infinity);
  const actorFilter = profile
    ? "AND (e.actor=? OR e.target=?)"
    : view === "following"
      ? "AND EXISTS(SELECT 1 FROM relations r WHERE r.actor=? AND r.kind='follow' AND r.target=e.actor)"
      : "";
  // Unattributed transfers stay in Everyone. They are not actions by a creator,
  // recipient profile, gift or sale merely because an address happens to match.
  const chainFilter = profile
    ? "AND c.kind='Minted' AND c.creator=?"
    : view === "following"
      ? "AND c.kind='Minted' AND EXISTS(SELECT 1 FROM relations r WHERE r.actor=? AND r.kind='follow' AND r.target=c.creator)"
      : "";
  const args: unknown[] = [
    publicMax,
    Math.floor(now / 1000),
    ...(profile
      ? [profile.toLowerCase(), profile.toLowerCase()]
      : view === "following"
        ? [viewer]
        : []),
    chainMax,
    ...(profile
      ? [profile.toLowerCase()]
      : view === "following"
        ? [viewer]
        : []),
  ];
  const key = after?.key;
  if (key) args.push(...key);
  args.push(limit + 1);
  const rows = await env.DB.prepare(
    `WITH feed AS (
    SELECT e.kind,'public' source,e.id seq,0 sub,e.occurred_at,e.actor,a.name actor_name,e.target,t.name target_name,
      e.token_id,e.nonce,d.metadata_json,NULL block_hash,NULL tx_hash
    FROM public_events e LEFT JOIN profiles a ON a.address=e.actor LEFT JOIN profiles t ON t.address=e.target
    LEFT JOIN indexed_items i ON i.token_id=e.token_id
    LEFT JOIN discovery_metadata d ON d.token_id=i.token_id AND d.metadata_hash=i.metadata_hash AND d.creator=i.creator AND d.version=1 AND d.valid=1
    WHERE e.id<=? AND (e.kind<>'published' OR (
      d.valid=1 AND EXISTS(SELECT 1 FROM activity_publications b JOIN possessions p USING(profile,token_id,nonce)
        WHERE b.event_id=e.id AND p.owner=e.owner AND p.expires>?)
      AND EXISTS(SELECT 1 FROM chain_events m WHERE m.kind='Minted' AND m.token_id=e.token_id AND m.block_hash=e.mint_hash)
      AND EXISTS(SELECT 1 FROM chain_events x WHERE x.kind='Transfer' AND x.token_id=e.token_id AND x.to_address=e.owner
        AND (SELECT COUNT(*)-1 FROM chain_events y WHERE y.kind='Transfer' AND y.token_id=x.token_id AND (y.block_number<x.block_number OR (y.block_number=x.block_number AND y.log_index<=x.log_index)))=CAST(e.nonce AS INTEGER))
    )) ${actorFilter}
    UNION ALL
    SELECT CASE c.kind WHEN 'Minted' THEN 'minted' ELSE 'transferred' END,'chain',c.block_number,c.log_index,COALESCE(time.timestamp,0),
      CASE c.kind WHEN 'Minted' THEN c.creator ELSE NULL END,a.name,NULL,NULL,c.token_id,NULL,d.metadata_json,c.block_hash,c.tx_hash
    FROM chain_events c JOIN indexed_items i ON i.token_id=c.token_id ${metadataJoin}
    LEFT JOIN chain_event_times time ON time.block_number=c.block_number AND time.block_hash=c.block_hash
    LEFT JOIN profiles a ON a.address=c.creator
    WHERE c.block_number<=? AND (c.kind='Minted' OR (c.kind='Transfer' AND c.from_address<>'0x0000000000000000000000000000000000000000')) ${chainFilter}
  ) SELECT * FROM feed ${key ? "WHERE (occurred_at,source,seq,sub)<(?,?,?,?)" : ""}
  ORDER BY occurred_at DESC,source DESC,seq DESC,sub DESC LIMIT ?`,
  )
    .bind(...args)
    .all<Row>();
  const end = await revision(env);
  if (
    end.revision !== rev.revision ||
    (view === "following" && end.follow_revision !== rev.follow_revision) ||
    Date.now() >= until
  )
    throw new HttpError(409, "Activity changed. Refresh to continue.");
  const page = rows.results.slice(0, limit),
    last = page.at(-1);
  return {
    state: "ready",
    events: page.map((r) => {
      const metadata = r.metadata_json
        ? (JSON.parse(r.metadata_json) as Metadata)
        : null;
      return {
        id:
          r.source === "public"
            ? `public:${r.seq}`
            : `chain:${r.block_hash}:${r.sub}`,
        source: r.source,
        kind: r.kind,
        occurredAt: r.occurred_at || null,
        actor: r.actor
          ? { address: r.actor, name: r.actor_name || r.actor }
          : null,
        target: r.target
          ? { address: r.target, name: r.target_name || r.target }
          : null,
        item:
          metadata && r.token_id
            ? {
                tokenId: r.token_id,
                title: metadata.name,
                imageHash: metadata.imageHash,
                href:
                  r.kind === "published"
                    ? `/p/${r.actor}?nft=${r.token_id}&epoch=${r.nonce}`
                    : `/item/${r.token_id}`,
              }
            : null,
        chain:
          r.source === "chain"
            ? { block: r.seq, transaction: r.tx_hash! }
            : null,
      };
    }),
    nextCursor:
      rows.results.length > limit && last
        ? btoa(
            JSON.stringify({
              v: 1,
              scope,
              viewer: view === "following" ? viewer : "",
              revision: rev.revision,
              follows: rev.follow_revision,
              publicMax,
              chainMax,
              until,
              key: [last.occurred_at, last.source, last.seq, last.sub],
            }),
          )
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, "")
        : null,
  };
}
