import { digest, addressSchema, uintSchema } from "../../packages/protocol";
import { ZodError } from "zod";
import manifest from "../../packages/protocol/deployment.json";
import {
  item,
  profileData,
  inProfile,
  collectionPreview,
  publicContext,
  publication,
} from "./public";
import { discoverNFTs, discoverCollections } from "./discovery";
import { HttpError } from "./http";
import type { Env } from "./types";

export type Snapshot = {
  version: 1;
  deployment: string;
  path: string;
  imagePath: string;
  title: string;
  description: string;
  label: string;
  subtitle: string;
  art: { hash: string; width: number; height: number; title?: string }[];
  profileMedia?: {
    address: string;
    avatar: string | null;
    cover: string | null;
  };
  publication?: { profile: string; tokenId: string; nonce: string };
  revisionData: unknown;
  private?: boolean;
};
const staticPages: Record<string, [string, string]> = {
  "/": [
    "The collectible is the file.",
    "Mint a picture. Keep it in your collection. Pass the original file to someone else.",
  ],
  "/explore": [
    "Find your next favorite collection.",
    "Discover public collections and collectors on Zenon ZVM devnet.",
  ],
  "/explore/nfts": [
    "Pictures worth keeping.",
    "Discover freshly minted pictures on Zenon ZVM devnet.",
  ],
  "/activity": [
    "Around the network.",
    "Public profile actions and confirmed collectible activity on ZVM devnet.",
  ],
  "/about": [
    "Keep it. Pass it on.",
    "Learn how pictures carry ownership, and why claiming makes old copies stale.",
  ],
  "/how-it-works": [
    "Keep it. Pass it on.",
    "Learn how pictures carry ownership, and why claiming makes old copies stale.",
  ],
};
export async function snapshot(env: Env, url: URL): Promise<Snapshot> {
  const path = url.pathname;
  const base = {
    version: 1 as const,
    deployment: manifest.contract,
    path,
    imagePath: "",
    title: "ZFT · Your local collection",
    description: "Your collection and keys stay on your device.",
    label: "File collectibles",
    subtitle: "Public ownership. Local keys.",
    art: [] as Snapshot["art"],
    revisionData: null as unknown,
  };
  if (staticPages[path]) {
    // Discovery artwork enriches static pages; its availability must not gate them.
    const artwork =
      path === "/explore"
        ? (
            await discoverCollections(
              env,
              new URL("https://internal?limit=3"),
            ).catch(() => ({ items: [] }))
          ).items.flatMap((p) => (p.preview ? [p.preview] : []))
        : ["/", "/explore/nfts"].includes(path)
          ? (
              await discoverNFTs(
                env,
                new URL("https://internal?limit=3"),
              ).catch(() => ({ items: [] }))
            ).items
          : [];
    const art = [...new Map(artwork.map((i) => [i.tokenId, i])).values()].map(
      (i) => ({
        hash: i.metadata.imageHash,
        width: i.metadata.width,
        height: i.metadata.height,
        title: i.metadata.name,
      }),
    );
    return {
      ...base,
      title: staticPages[path][0],
      description: staticPages[path][1],
      imagePath: `/api/og/page/${path === "/explore/nfts" ? "explore-nfts" : path.slice(1) || "home"}.png`,
      art,
      revisionData: art,
    };
  }
  if (
    [
      "/collection",
      "/mint",
      "/claim",
      "/recovery",
      "/settings/profile",
      "/wallet",
    ].includes(path)
  )
    return { ...base, private: true };
  const profile = /^\/p\/(0x[\da-fA-F]{40})$/.exec(path);
  const artwork = /^\/item\/(\d{1,78})$/.exec(path);
  if (profile) {
    const address = addressSchema.parse(profile[1]).toLowerCase();
    const p = await profileData(env, address);
    const profileMedia = {
      address,
      avatar: p.profile.avatar ?? null,
      cover: p.profile.cover ?? null,
    };
    const selected = url.searchParams.get("nft");
    if (selected) {
      uintSchema.parse(selected);
      const epoch = url.searchParams.get("epoch") ?? undefined;
      const proof = await publicContext(env, address, selected, epoch);
      const i = await item(env, selected);
      const historical =
        proof &&
        (proof.owner.toLowerCase() !== i.owner.toLowerCase() ||
          proof.nonce !== i.nonce);
      return {
        ...base,
        path: `/p/${address}?nft=${selected}${epoch === undefined ? "" : `&epoch=${epoch}`}`,
        imagePath: `/api/og/p/${address}/${selected}${epoch === undefined ? "" : `/epoch/${epoch}`}.png`,
        title: i.metadata.name,
        description:
          i.metadata.description ||
          `A collectible shared by ${p.profile.name}.`,
        label: p.profile.name,
        profileMedia,
        subtitle: historical
          ? "PREVIOUS OWNERSHIP EPOCH"
          : "ONE PICTURE / ONE COLLECTIBLE",
        art: [
          {
            hash: i.metadata.imageHash,
            width: i.metadata.width,
            height: i.metadata.height,
            title: i.metadata.name,
          },
        ],
        ...(epoch !== undefined
          ? {
              publication: {
                profile: address,
                tokenId: selected,
                nonce: epoch,
              },
            }
          : {}),
        revisionData: [
          3,
          i.metadataHash,
          p.profile.revision,
          proof,
          historical,
        ],
      };
    }
    const collected = await collectionPreview(env, address);
    const featured =
      p.profile.featured &&
      (await publicContext(env, address, p.profile.featured).catch(() => null))
        ? await item(env, p.profile.featured).catch(() => null)
        : null;
    const pieces = [
      ...(featured ? [featured] : []),
      ...collected.filter((i) => i.tokenId !== featured?.tokenId),
    ].slice(0, 3);
    return {
      ...base,
      path: `/p/${address}`,
      imagePath: `/api/og/p/${address}.png`,
      title: p.profile.name,
      description: p.profile.bio || "A public ZFT collection on ZVM devnet.",
      label: "Public collection",
      profileMedia,
      subtitle: `${p.counts.collected} COLLECTED / ${p.counts.followers} FOLLOWERS / ${p.counts.likes} LIKES`,
      art: pieces.map((i) => ({
        hash: i.metadata.imageHash,
        width: i.metadata.width,
        height: i.metadata.height,
        title: i.metadata.name,
      })),
      revisionData: [3, p.profile.revision, p.counts],
    };
  }
  if (artwork) {
    const id = uintSchema.parse(artwork[1]),
      i = await item(env, id);
    return {
      ...base,
      imagePath: `/api/og/item/${id}.png`,
      title: i.metadata.name,
      description:
        i.metadata.description || "A file collectible on ZVM devnet.",
      label: "Public collectible",
      subtitle: `CREATED BY ${i.metadata.creator.slice(0, 8)}…${i.metadata.creator.slice(-6)}`,
      art: [
        {
          hash: i.metadata.imageHash,
          width: i.metadata.width,
          height: i.metadata.height,
          title: i.metadata.name,
        },
      ],
      revisionData: [3, i.metadataHash],
    };
  }
  throw new HttpError(404, "Page not found.");
}
export const escapeHTML = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function headTags(page: Snapshot, origin: string, revision: string) {
  const esc = escapeHTML,
    title = esc(`${page.title} · ZFT`),
    description = esc(page.description),
    canonical = esc(`${origin}${page.path}`),
    img = esc(`${origin}${page.imagePath}?v=${revision}`);
  const tags = `<title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:site_name" content="ZFT"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}">`;
  if (page.private)
    return tags + '<meta name="robots" content="noindex,nofollow">';
  return (
    tags +
    `<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:type" content="image/png"><meta property="og:image:alt" content="${title} — ZVM devnet"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${img}">`
  );
}
export async function shareHTML(request: Request, env: Env) {
  const url = new URL(request.url);
  let page: Snapshot,
    revision = "",
    status = 200;
  try {
    page = await snapshot(env, url);
    revision = digest(page).slice(2);
    if (!page.private) {
      const key = `og-snapshots${page.imagePath}/${revision}.json`;
      if (!(await env.MEDIA.head(key)))
        await env.MEDIA.put(key, JSON.stringify(page), {
          httpMetadata: { contentType: "application/json" },
        });
    }
  } catch (error) {
    status =
      error instanceof HttpError
        ? error.status
        : error instanceof ZodError
          ? 400
          : 503;
    // The client still needs to mount its not-found, indexing and retry states.
    page = {
      version: 1,
      deployment: manifest.contract,
      path: url.pathname,
      imagePath: "",
      title: "File collectibles",
      description: "Picture-based collectibles on Zenon ZVM devnet.",
      label: "",
      subtitle: "",
      art: [],
      revisionData: null,
      private: true,
    };
  }
  const shell = await env.ASSETS.fetch(
    new Request(new URL("/index.html", request.url), {
      headers: { accept: "text/html" },
    }),
  );
  const headers = new Headers(shell.headers);
  headers.set("cache-control", "no-store");
  headers.delete("etag");
  return new HTMLRewriter()
    .on(
      'title, meta[name="description"], meta[name="robots"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]',
      {
        element(e) {
          e.remove();
        },
      },
    )
    .on("head", {
      element(e) {
        e.append(headTags(page, env.PUBLIC_ORIGIN, revision), { html: true });
      },
    })
    .transform(
      new Response(shell.body, {
        status: shell.ok ? status : shell.status,
        headers,
      }),
    );
}
export async function ogResponse(env: Env, url: URL) {
  if (
    !/^\/api\/og\/(page\/(home|explore|explore-nfts|activity|about|how-it-works)|item\/\d{1,78}|p\/0x[\da-f]{40}(\/\d{1,78}(\/epoch\/\d{1,78})?)?)\.png$/.test(
      url.pathname,
    )
  )
    throw new HttpError(404, "Image not found.");
  const revision = url.searchParams.get("v") ?? "";
  if (!/^[\da-f]{64}$/.test(revision))
    throw new HttpError(404, "Unknown image revision.");
  const key = `og${url.pathname}/${revision}.png`;
  const source = await env.MEDIA.get(
    `og-snapshots${url.pathname}/${revision}.json`,
  );
  if (!source) throw new HttpError(404, "Unknown image revision.");
  const page = await source.json<Snapshot>();
  if (digest(page).slice(2) !== revision || page.imagePath !== url.pathname)
    throw new HttpError(404, "Image revision mismatch.");
  const profileContext = /^\/p\/(0x[\da-f]{40})/.exec(page.path)?.[1];
  if (page.publication) {
    const p = page.publication;
    if (
      p.profile !== profileContext ||
      !(await publication(env, p.profile, p.tokenId, p.nonce))
    )
      throw new HttpError(
        404,
        "This profile no longer publishes that artwork.",
      );
  } else if (profileContext)
    for (const art of page.art)
      if (!(await inProfile(env, profileContext, BigInt(art.hash).toString())))
        throw new HttpError(
          404,
          "This profile no longer publishes that artwork.",
        );
  let object = await env.MEDIA.get(key);
  if (!object) {
    const { renderOG } = await import("./og-render");
    let image = await renderOG(page, env).catch(() =>
      renderOG({ ...page, art: [] }, env),
    );
    if (image.length > 1_048_576)
      image = await renderOG({ ...page, art: [] }, env);
    await env.MEDIA.put(key, image, {
      httpMetadata: { contentType: "image/png" },
    });
    object = await env.MEDIA.get(key);
  }
  if (!object) throw new HttpError(503, "Image unavailable.");
  return new Response(object.body, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${revision}"`,
    },
  });
}
