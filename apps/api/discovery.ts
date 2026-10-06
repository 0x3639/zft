import { z } from "zod";
import { addressSchema, type Metadata } from "../../packages/protocol";
import {
  searchKey,
  type CollectionEntry,
  type DiscoveredItem,
} from "../../packages/protocol/discovery";
import { hydrate, type IndexedItem } from "./public";
import { HttpError } from "./http";
import type { Env } from "./types";

const joinMetadata = `JOIN discovery_metadata d ON d.token_id=i.token_id AND d.metadata_hash=i.metadata_hash AND d.creator=i.creator AND d.version=1 AND d.valid=1`;
const eligible = `p.owner=i.owner AND p.nonce=CAST(i.nonce AS TEXT) AND p.expires>?`;
// Bounded incremental backfill. Invalid/missing metadata is retried; R2 outages
// abort without caching a failure. Reorgs stay correct through the journal join.
export async function projectDiscovery(env: Env) {
  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT i.* FROM indexed_items i LEFT JOIN discovery_metadata d ON d.token_id=i.token_id AND d.metadata_hash=i.metadata_hash AND d.creator=i.creator WHERE d.version IS NULL OR d.version<>1 OR (d.valid=0 AND d.retry_at<=?) ORDER BY COALESCE(d.retry_at,0),i.mint_block,i.mint_log LIMIT 8`,
  )
    .bind(now)
    .all<IndexedItem>();
  for (const row of rows.results) {
    const value = await hydrate(env, row);
    await env.DB.prepare(
      `INSERT INTO discovery_metadata VALUES(?,?,?,1,?,?,?,?,?) ON CONFLICT(token_id,metadata_hash,creator) DO UPDATE SET version=1,valid=excluded.valid,title_key=excluded.title_key,metadata_json=excluded.metadata_json,checked_at=excluded.checked_at,retry_at=excluded.retry_at`,
    )
      .bind(
        row.token_id,
        row.metadata_hash,
        row.creator,
        value ? 1 : 0,
        value ? searchKey(value.metadata.name) : null,
        value ? JSON.stringify(value.metadata) : null,
        now,
        now + 300_000,
      )
      .run();
  }
  const profiles = await env.DB.prepare(
    "SELECT p.address,p.name,p.revision FROM profiles p JOIN profile_discovery s USING(address) WHERE s.search_name IS NULL LIMIT 8",
  ).all<{ address: string; name: string; revision: number }>();
  for (const p of profiles.results)
    await env.DB.prepare(
      "UPDATE profile_discovery SET search_name=? WHERE address=? AND search_name IS NULL AND EXISTS(SELECT 1 FROM profiles p WHERE p.address=profile_discovery.address AND p.revision=?)",
    )
      .bind(searchKey(p.name), p.address, p.revision)
      .run();
  return rows.results.length === 8 || profiles.results.length === 8;
}
const cursorSchema = z
  .object({
    v: z.literal(1),
    scope: z.string(),
    q: z.string().max(256),
    sort: z.string(),
    revision: z.number().int().nonnegative(),
    until: z.number().int().positive(),
    key: z.tuple([
      z.union([z.number(), z.string()]),
      z.number(),
      z.string().max(100),
    ]),
  })
  .strict();
async function revision(env: Env) {
  return (await env.DB.prepare(
    "SELECT revision FROM discovery_state WHERE id=1",
  ).first<{ revision: number }>())!.revision;
}
async function parameters(
  env: Env,
  url: URL,
  scope: string,
  sorts: readonly string[],
) {
  const q = searchKey(
    z
      .string()
      .max(64)
      .parse(url.searchParams.get("q") ?? ""),
  );
  const sort = url.searchParams.get("sort") ?? sorts[0];
  if (!sorts.includes(sort))
    throw new HttpError(400, "Unknown discovery sort.");
  const limit = Number(url.searchParams.get("limit") ?? 24);
  if (!Number.isInteger(limit) || limit < 1 || limit > 24)
    throw new HttpError(400, "Page size must be between 1 and 24.");
  const rev = await revision(env),
    now = Math.floor(Date.now() / 1000);
  const expiry = await env.DB.prepare(
    "SELECT MIN(expires) n FROM possessions WHERE expires>?",
  )
    .bind(now)
    .first<{ n: number | null }>();
  const until = Math.min(
    Date.now() + 300_000,
    expiry?.n ? expiry.n * 1000 : Infinity,
  );
  let after: z.infer<typeof cursorSchema> | undefined;
  const raw = url.searchParams.get("cursor");
  if (raw) {
    try {
      if (raw.length > 4096) throw new Error();
      after = cursorSchema.parse(
        JSON.parse(
          decodeURIComponent(atob(raw.replace(/-/g, "+").replace(/_/g, "/"))),
        ),
      );
    } catch {
      throw new HttpError(400, "Invalid discovery cursor.");
    }
    if (after.scope !== scope || after.q !== q || after.sort !== sort)
      throw new HttpError(400, "Cursor belongs to different filters.");
    if (after.revision !== rev || after.until <= Date.now())
      throw new HttpError(
        409,
        "Discovery changed. Refresh results to continue.",
      );
  }
  return {
    q,
    sort,
    limit,
    now,
    rev,
    after,
    cursor: (key: z.infer<typeof cursorSchema>["key"]) =>
      btoa(
        encodeURIComponent(
          JSON.stringify({
            v: 1,
            scope,
            q,
            sort,
            revision: rev,
            until: after?.until ?? until,
            key,
          }),
        ),
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
  };
}
async function unchanged(env: Env, rev: number) {
  if ((await revision(env)) !== rev)
    throw new HttpError(409, "Discovery changed. Refresh results to continue.");
}
async function pending(env: Env) {
  return (
    (
      await env.DB.prepare(
        `SELECT COUNT(*) n FROM indexed_items i LEFT JOIN discovery_metadata d ON d.token_id=i.token_id AND d.metadata_hash=i.metadata_hash AND d.creator=i.creator AND d.version=1 WHERE d.token_id IS NULL`,
      ).first<{ n: number }>()
    )?.n ?? 0
  );
}
type Row = IndexedItem & {
  metadata_json: string;
  title_key: string;
  a: number | string;
  b: number;
  c: string;
};
async function presented(
  env: Env,
  row: Row,
  now: number,
): Promise<DiscoveredItem> {
  const bindings = await env.DB.prepare(
    `SELECT DISTINCT profile FROM possessions p WHERE token_id=? AND owner=? AND nonce=? AND expires>? LIMIT 2`,
  )
    .bind(row.token_id, row.owner, String(row.nonce), now)
    .all<{ profile: string }>();
  return presentedItem(
    row,
    bindings.results.length === 1
      ? `/p/${bindings.results[0].profile}?nft=${row.token_id}`
      : `/item/${row.token_id}`,
  );
}
function presentedItem(row: Row, href: string): DiscoveredItem {
  return {
    tokenId: row.token_id,
    metadataHash: row.metadata_hash,
    metadata: JSON.parse(row.metadata_json) as Metadata,
    owner: row.owner,
    nonce: String(row.nonce),
    mintBlock: row.mint_block,
    href,
  };
}
export async function discoverNFTs(env: Env, url: URL) {
  const p = await parameters(env, url, "nfts", ["newest", "oldest", "az"]);
  const ascending = p.sort !== "newest",
    dir = ascending ? "ASC" : "DESC",
    cmp = ascending ? ">" : "<";
  const a = p.sort === "az" ? "d.title_key" : "i.mint_block",
    b = p.sort === "az" ? "length(i.token_id)" : "i.mint_log";
  const from = `FROM indexed_items i ${joinMetadata} WHERE instr(d.title_key,?)>0`;
  const rows = await env.DB.prepare(
    `WITH ranked AS (SELECT i.*,d.metadata_json,d.title_key,${a} a,${b} b,i.token_id c ${from}) SELECT * FROM ranked ${p.after ? `WHERE (a,b,c) ${cmp} (?,?,?)` : ""} ORDER BY a ${dir},b ${dir},c ${dir} LIMIT ?`,
  )
    .bind(p.q, ...(p.after?.key ?? []), p.limit + 1)
    .all<Row>();
  const total = (await env.DB.prepare(`SELECT COUNT(*) n ${from}`)
    .bind(p.q)
    .first<{ n: number }>())!.n;
  const page = rows.results.slice(0, p.limit),
    last = page.at(-1);
  const items = await Promise.all(page.map((r) => presented(env, r, p.now)));
  const waiting = await pending(env);
  await unchanged(env, p.rev);
  return {
    items,
    total,
    pending: waiting,
    nextCursor:
      rows.results.length > p.limit && last
        ? p.cursor([last.a, last.b, last.c])
        : null,
  };
}
export async function discoverCollections(env: Env, url: URL) {
  const viewer = url.searchParams.get("viewer");
  if (viewer) addressSchema.parse(viewer);
  const p = await parameters(env, url, "collections", [
    "popular",
    "newest",
    "biggest",
  ]);
  // Explicit profiles plus immutable creator identities. A creator's mint date
  // is not a profile creation date. Legacy/implicit dates sort last.
  const cte = `WITH addresses AS (SELECT address FROM profiles UNION SELECT creator address FROM indexed_items), directory AS (
    SELECT a.address,COALESCE(p.name,substr(a.address,1,8)||'…'||substr(a.address,-6)) name,s.created_at,m.avatar,m.cover,
    COALESCE(s.search_name,substr(a.address,1,8)||'…'||substr(a.address,-6)) search_name,
    (SELECT COUNT(*) FROM indexed_items i ${joinMetadata} WHERE EXISTS(SELECT 1 FROM possessions p WHERE p.token_id=i.token_id AND p.profile=a.address AND ${eligible})) collected,
    (SELECT COUNT(*) FROM relations WHERE target=a.address AND kind='follow') followers,
    (SELECT COUNT(*) FROM relations WHERE target=a.address AND kind='like') likes,
    EXISTS(SELECT 1 FROM relations WHERE target=a.address AND kind='like' AND actor=?) liked
    FROM addresses a LEFT JOIN profiles p USING(address) LEFT JOIN profile_discovery s USING(address) LEFT JOIN profile_media m USING(address) WHERE p.address IS NULL OR s.search_name IS NOT NULL
  ), ranked AS (SELECT *,${p.sort === "popular" ? "likes" : p.sort === "biggest" ? "collected" : "COALESCE(created_at,-1)"} a,${p.sort === "popular" ? "followers" : "0"} b,address c FROM directory WHERE instr(search_name,?)>0)`;
  const args = [p.now, viewer?.toLowerCase() ?? "", p.q];
  type CollectionRow = {
    avatar: string | null;
    cover: string | null;
    address: string;
    name: string;
    created_at: number | null;
    collected: number;
    followers: number;
    likes: number;
    liked: number;
    a: number;
    b: number;
    c: string;
  };
  const rows = await env.DB.prepare(
    `${cte} SELECT * FROM ranked ${p.after ? "WHERE a<? OR (a=? AND b<?) OR (a=? AND b=? AND c>?)" : ""} ORDER BY a DESC,b DESC,c ASC LIMIT ?`,
  )
    .bind(
      ...args,
      ...(p.after
        ? [
            p.after.key[0],
            p.after.key[0],
            p.after.key[1],
            p.after.key[0],
            p.after.key[1],
            p.after.key[2],
          ]
        : []),
      p.limit + 1,
    )
    .all<CollectionRow>();
  const total = (await env.DB.prepare(`${cte} SELECT COUNT(*) n FROM ranked`)
    .bind(...args)
    .first<{ n: number }>())!.n;
  const page = rows.results.slice(0, p.limit),
    last = page.at(-1);
  const items: CollectionEntry[] = await Promise.all(
    page.map(async (row) => {
      const art = await env.DB.prepare(
        `SELECT i.*,d.metadata_json FROM indexed_items i ${joinMetadata} JOIN possessions p ON p.token_id=i.token_id WHERE p.profile=? AND ${eligible} ORDER BY p.published_at DESC,i.mint_block DESC,i.mint_log DESC LIMIT 1`,
      )
        .bind(row.address, p.now)
        .first<Row>();
      return {
        address: row.address,
        avatar: row.avatar,
        cover: row.cover,
        name: row.name,
        createdAt: row.created_at,
        collected: row.collected,
        followers: row.followers,
        likes: row.likes,
        liked: !!row.liked,
        preview: art
          ? presentedItem(art, `/p/${row.address}?nft=${art.token_id}`)
          : null,
      };
    }),
  );
  const waiting =
    (await pending(env)) +
    (await env.DB.prepare(
      "SELECT COUNT(*) n FROM profile_discovery WHERE search_name IS NULL",
    ).first<{ n: number }>())!.n;
  await unchanged(env, p.rev);
  return {
    items,
    total,
    pending: waiting,
    nextCursor:
      rows.results.length > p.limit && last
        ? p.cursor([last.a, last.b, last.c])
        : null,
  };
}

export async function recentDiscoveryActivity(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT e.block_number,e.log_index,e.tx_hash,e.from_address,i.*,d.metadata_json FROM chain_events e JOIN indexed_items i USING(token_id) ${joinMetadata} WHERE e.kind='Transfer' ORDER BY e.block_number DESC,e.log_index DESC LIMIT 6`,
  ).all<
    Row & {
      block_number: number;
      log_index: number;
      tx_hash: string;
      from_address: string;
    }
  >();
  return {
    events: rows.results.map((row) => ({
      id: `${row.block_number}:${row.log_index}`,
      kind: row.from_address === "0x" + "0".repeat(40) ? "mint" : "transfer",
      block: row.block_number,
      tx: row.tx_hash,
      tokenId: row.token_id,
      metadata: JSON.parse(row.metadata_json) as Metadata,
    })),
  };
}
