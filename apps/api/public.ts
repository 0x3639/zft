import { verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";
import {
  addressSchema,
  digest,
  metadataSchema,
  sameAddress,
  uintSchema,
  type Metadata,
  type Deployment,
} from "../../packages/protocol";
import {
  profileInput,
  socialInput,
  possessionInput,
  unpublishInput,
  possessionText,
  type Profile,
  type Publication,
} from "../../packages/protocol/public";
import { searchKey } from "../../packages/protocol/discovery";
import manifest from "../../packages/protocol/deployment.json";
import { checkDeployment, ownership } from "../../packages/protocol/client";
import { HttpError, json } from "./http";
import type { Env } from "./types";

const projectedArtwork = `EXISTS(SELECT 1 FROM discovery_metadata d WHERE d.token_id=i.token_id AND d.metadata_hash=i.metadata_hash AND d.creator=i.creator AND d.version=1 AND d.valid=1)`;

export type IndexedItem = {
  token_id: string;
  metadata_hash: Hex;
  creator: string;
  owner: string;
  nonce: number;
  mint_block: number;
  mint_log: number;
};
export type PublicItem = {
  tokenId: string;
  metadataHash: Hex;
  metadata: Metadata;
  owner: string;
  nonce: string;
  mintBlock: number;
  publicationNonce?: string;
};
export async function hydrate(
  env: Env,
  row: IndexedItem,
): Promise<PublicItem | null> {
  const object = await env.MEDIA.get(
    `metadata/${row.metadata_hash.slice(2)}.json`,
  );
  if (!object) return null;
  let value: unknown;
  try {
    value = await object.json();
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const parsed = metadataSchema.safeParse(value);
  if (!parsed.success) return null;
  const m = parsed.data;
  if (
    digest(m) !== row.metadata_hash ||
    BigInt(m.imageHash).toString() !== row.token_id ||
    !sameAddress(m.creator, row.creator)
  )
    // Permissionless mints can reference foreign metadata; omit only that token.
    return null;
  return {
    tokenId: row.token_id,
    metadataHash: row.metadata_hash,
    metadata: m,
    owner: row.owner,
    nonce: String(row.nonce),
    mintBlock: row.mint_block,
  };
}
export async function item(env: Env, id: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM indexed_items WHERE token_id=?",
  )
    .bind(id)
    .first<IndexedItem>();
  if (!row) throw new HttpError(404, "Collectible not indexed yet.");
  const result = await hydrate(env, row);
  if (!result) throw new HttpError(404, "Public artwork is not available.");
  return result;
}
export function cursor(value: string | null): [number, number] {
  if (!value) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  if (!/^\d{1,15}:\d{1,15}$/.test(value))
    throw new HttpError(400, "Invalid page cursor.");
  return value.split(":").map(Number) as [number, number];
}
export async function gallery(
  env: Env,
  url: URL,
  profile?: string,
  tab = "created",
) {
  const [block, log] = cursor(url.searchParams.get("cursor"));
  let filter = "1=1";
  const values: unknown[] = [];
  if (profile) {
    if (tab === "wallet") {
      filter = "owner=?";
      values.push(profile);
    } else if (tab === "created") {
      filter = "creator=?";
      values.push(profile);
    } else {
      filter = `EXISTS (SELECT 1 FROM possessions p WHERE p.token_id=i.token_id AND p.profile=? AND ${tab === "sent" ? "(p.owner<>i.owner OR CAST(p.nonce AS INTEGER)<>i.nonce)" : "p.owner=i.owner AND CAST(p.nonce AS INTEGER)=i.nonce AND p.expires>?"})`;
      values.push(profile);
      filter += ` AND ${projectedArtwork}`;
      if (tab !== "sent") values.push(Math.floor(Date.now() / 1000));
    }
  }
  const rows = await env.DB.prepare(
    `SELECT * FROM indexed_items i WHERE ${filter} AND (mint_block<? OR (mint_block=? AND mint_log<?)) ORDER BY mint_block DESC,mint_log DESC LIMIT 25`,
  )
    .bind(...values, block, block, log)
    .all<IndexedItem>();
  const page = rows.results.slice(0, 24);
  const items = (await Promise.all(page.map((r) => hydrate(env, r)))).filter(
    (r): r is PublicItem => !!r,
  );
  const last = page.at(-1);
  if (profile && ["collection", "sent"].includes(tab))
    await Promise.all(
      items.map(async (i) => {
        const p = await env.DB.prepare(
          `SELECT nonce FROM possessions WHERE profile=? AND token_id=? AND ${tab === "sent" ? "(owner<>? OR nonce<>?)" : "owner=? AND nonce=?"} ORDER BY length(nonce) DESC,nonce DESC LIMIT 1`,
        )
          .bind(profile, i.tokenId, i.owner, i.nonce)
          .first<{ nonce: string }>();
        i.publicationNonce = p?.nonce;
      }),
    );
  return {
    items,
    nextCursor:
      rows.results.length > 24 && last
        ? `${last.mint_block}:${last.mint_log}`
        : null,
  };
}
export async function profileData(env: Env, address: string, viewer?: string) {
  const addr = addressSchema.parse(address).toLowerCase();
  const p = await env.DB.prepare("SELECT * FROM profiles WHERE address=?")
    .bind(addr)
    .first<Profile>();
  const created = await env.DB.prepare(
    "SELECT COUNT(*) n FROM indexed_items WHERE creator=?",
  )
    .bind(addr)
    .first<{ n: number }>();
  if (!p && !created?.n)
    throw new HttpError(404, "This profile has not been published.");
  const now = Math.floor(Date.now() / 1000);
  const count = async (sql: string, ...args: unknown[]) =>
    (
      await env.DB.prepare(sql)
        .bind(...args)
        .first<{ n: number }>()
    )?.n ?? 0;
  const [collected, sent, followers, following, likes, viewerRows] =
    await Promise.all([
      count(
        `SELECT COUNT(DISTINCT p.token_id) n FROM possessions p JOIN indexed_items i USING(token_id) WHERE p.profile=? AND p.owner=i.owner AND CAST(p.nonce AS INTEGER)=i.nonce AND p.expires>? AND ${projectedArtwork}`,
        addr,
        now,
      ),
      count(
        `SELECT COUNT(DISTINCT p.token_id) n FROM possessions p JOIN indexed_items i USING(token_id) WHERE p.profile=? AND (p.owner<>i.owner OR CAST(p.nonce AS INTEGER)<>i.nonce) AND ${projectedArtwork}`,
        addr,
      ),
      count(
        "SELECT COUNT(*) n FROM relations WHERE kind='follow' AND target=?",
        addr,
      ),
      count(
        "SELECT COUNT(*) n FROM relations WHERE kind='follow' AND actor=?",
        addr,
      ),
      count(
        "SELECT COUNT(*) n FROM relations WHERE kind='like' AND target=?",
        addr,
      ),
      env.DB.prepare("SELECT kind FROM relations WHERE target=? AND actor=?")
        .bind(addr, viewer?.toLowerCase() ?? "")
        .all<{ kind: string }>(),
    ]);
  return {
    featuredItem:
      p?.featured && (await inProfile(env, addr, p.featured))
        ? await item(env, p.featured).catch(() => null)
        : null,
    profile: p ?? {
      address: addr,
      name: `${addr.slice(0, 8)}…${addr.slice(-6)}`,
      bio: "Collectibles created on ZVM devnet.",
      featured: null,
      revision: 0,
      updated_at: 0,
    },
    counts: {
      created: created?.n ?? 0,
      collected,
      sent,
      followers,
      following,
      likes,
    },
    viewer: {
      following: viewerRows.results.some((r) => r.kind === "follow"),
      liked: viewerRows.results.some((r) => r.kind === "like"),
    },
  };
}
export async function inProfile(env: Env, address: string, tokenId: string) {
  const row = await env.DB.prepare(
    `SELECT i.token_id FROM indexed_items i WHERE i.token_id=? AND (i.creator=? OR EXISTS(SELECT 1 FROM possessions p WHERE p.token_id=i.token_id AND p.profile=? AND p.owner=i.owner AND CAST(p.nonce AS INTEGER)=i.nonce AND p.expires>?))`,
  )
    .bind(
      tokenId,
      address.toLowerCase(),
      address.toLowerCase(),
      Math.floor(Date.now() / 1000),
    )
    .first();
  return !!row;
}
export async function collectionPreview(env: Env, address: string) {
  const rows = await env.DB.prepare(
    `SELECT i.* FROM indexed_items i JOIN possessions p ON p.token_id=i.token_id
     WHERE p.profile=? AND p.owner=i.owner AND CAST(p.nonce AS INTEGER)=i.nonce AND p.expires>?
     ORDER BY p.published_at DESC,length(i.token_id) DESC,i.token_id DESC LIMIT 3`,
  )
    .bind(address.toLowerCase(), Math.floor(Date.now() / 1000))
    .all<IndexedItem>();
  return (
    await Promise.all(rows.results.map((row) => hydrate(env, row)))
  ).filter((row): row is PublicItem => !!row);
}
// Historical routes require the exact retained, explicitly published epoch.
// Creator provenance and current membership do not grant historical membership.
export async function publication(
  env: Env,
  profile: string,
  tokenId: string,
  epoch?: string,
) {
  const addr = addressSchema.parse(profile).toLowerCase();
  uintSchema.parse(tokenId);
  if (epoch !== undefined) uintSchema.parse(epoch);
  const row = await env.DB.prepare(
    `SELECT * FROM possessions WHERE profile=? AND token_id=? ${epoch === undefined ? "" : "AND nonce=?"} ORDER BY length(nonce) DESC,nonce DESC LIMIT 1`,
  )
    .bind(addr, tokenId, ...(epoch === undefined ? [] : [epoch]))
    .first<{
      profile: string;
      token_id: string;
      owner: string;
      nonce: string;
      signature: Hex;
      expires: number;
      published_at: number;
    }>();
  if (!row) return null;
  return {
    profile: addr as Address,
    tokenId: row.token_id,
    owner: row.owner as Address,
    nonce: row.nonce,
    signature: row.signature,
    expires: row.expires,
    publishedAt: row.published_at,
  } satisfies Publication;
}
export async function publicContext(
  env: Env,
  profile: string,
  tokenId: string,
  epoch?: string,
) {
  const p = await publication(env, profile, tokenId, epoch);
  if (epoch !== undefined) {
    if (!p)
      throw new HttpError(
        404,
        "This ownership epoch is not published by this profile.",
      );
  } else if (!(await inProfile(env, profile, tokenId))) {
    throw new HttpError(404, "This artwork is not in the public profile.");
  }
  if (epoch === undefined && p) {
    const current = await env.DB.prepare(
      "SELECT owner,nonce FROM indexed_items WHERE token_id=?",
    )
      .bind(tokenId)
      .first<{ owner: string; nonce: number }>();
    if (
      !current ||
      !sameAddress(current.owner, p.owner) ||
      String(current.nonce) !== p.nonce ||
      p.expires * 1000 <= Date.now()
    )
      return null;
  }
  return p;
}
export async function directory(
  env: Env,
  address: string,
  kind: string,
  url: URL,
) {
  await profileData(env, address);
  const after = url.searchParams.get("after") ?? "";
  if (after && !/^0x[0-9a-f]{40}$/.test(after))
    throw new HttpError(400, "Invalid directory cursor.");
  const field = kind === "following" ? "target" : "actor",
    match = kind === "following" ? "actor" : "target";
  const rows = await env.DB.prepare(
    `SELECT r.${field} address,p.name,p.bio FROM relations r LEFT JOIN profiles p ON p.address=r.${field} WHERE kind='follow' AND r.${match}=? AND r.${field}>? ORDER BY r.${field} LIMIT 25`,
  )
    .bind(address, after)
    .all<{ address: string; name: string | null; bio: string | null }>();
  return {
    profiles: rows.results.slice(0, 24),
    nextCursor: rows.results.length > 24 ? rows.results[23].address : null,
  };
}
export async function publicMutation(
  env: Env,
  path: string,
  actor: Address,
  input: unknown,
) {
  const addr = actor.toLowerCase(),
    now = Date.now();
  if (path === "/api/profile") {
    const p = profileInput.parse(input);
    if (p.featured && !(await inProfile(env, addr, p.featured)))
      throw new HttpError(400, "Feature one of your public collectibles.");
    const result = await env.DB.prepare(
      `INSERT INTO profiles SELECT ?,?,?,?,1,? WHERE ?=0 OR EXISTS(SELECT 1 FROM profiles WHERE address=?) ON CONFLICT(address) DO UPDATE SET name=excluded.name,bio=excluded.bio,featured=excluded.featured,revision=profiles.revision+1,updated_at=excluded.updated_at WHERE profiles.revision=?`,
    )
      .bind(addr, p.name, p.bio, p.featured, now, p.revision, addr, p.revision)
      .run();
    // A nonexistent profile is revision 0; stale updates must never resurrect it.
    if (result.meta.changes === 0)
      throw new HttpError(409, "Profile changed. Reload before saving.");
    await env.DB.prepare(
      "UPDATE profile_discovery SET search_name=? WHERE address=? AND EXISTS(SELECT 1 FROM profiles p WHERE p.address=profile_discovery.address AND p.revision=?)",
    )
      .bind(searchKey(p.name), addr, p.revision + 1)
      .run();
    return json(await profileData(env, addr, addr));
  }
  if (path === "/api/social") {
    const s = socialInput.parse(input),
      target = s.target.toLowerCase();
    await profileData(env, addr);
    await profileData(env, target);
    if (target === addr) throw new HttpError(400, "Choose another profile.");
    if (s.active)
      await env.DB.prepare("INSERT OR IGNORE INTO relations VALUES(?,?,?,?)")
        .bind(addr, s.kind, target, now)
        .run();
    else
      await env.DB.prepare(
        "DELETE FROM relations WHERE actor=? AND kind=? AND target=?",
      )
        .bind(addr, s.kind, target)
        .run();
    return json({ ok: true });
  }
  if (path === "/api/possessions") {
    const p = possessionInput.parse(input);
    const seconds = Math.floor(now / 1000);
    if (p.expires <= seconds || p.expires > seconds + 31 * 86400)
      throw new HttpError(400, "Possession proof must expire within 31 days.");
    await profileData(env, addr);
    await checkDeployment(manifest as unknown as Deployment);
    const state = await ownership(manifest.contract as Address, p.tokenId);
    if (
      !sameAddress(p.owner, state.owner) ||
      p.nonce !== state.nonce ||
      !(await verifyMessage({
        address: p.owner,
        message: possessionText(addr, p),
        signature: p.signature,
      }))
    )
      throw new HttpError(409, "Ownership changed or proof is invalid.");
    await item(env, p.tokenId);
    await env.DB.prepare(
      "INSERT INTO possessions VALUES(?,?,?,?,?,?,?) ON CONFLICT(profile,token_id,nonce) DO UPDATE SET signature=excluded.signature,expires=excluded.expires",
    )
      .bind(
        addr,
        p.tokenId,
        p.owner.toLowerCase(),
        p.nonce,
        p.signature,
        p.expires,
        now,
      )
      .run();
    return json({ ok: true });
  }
  const p = unpublishInput.parse(input);
  await env.DB.prepare("DELETE FROM possessions WHERE profile=? AND token_id=?")
    .bind(addr, p.tokenId)
    .run();
  return json({ ok: true });
}
