import { digest, addressSchema, uintSchema } from "../../packages/protocol";
import manifest from "../../packages/protocol/deployment.json";
import { item, profileData, inProfile, gallery } from "./public";
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
  art: { hash: string; width: number; height: number }[];
  revisionData: unknown;
  private?: boolean;
};
const staticPages: Record<string, [string, string]> = {
  "/": [
    "The collectible is the file.",
    "Mint a picture. Keep it in your collection. Pass the original file to someone else.",
  ],
  "/explore": [
    "Explore the network.",
    "Discover public collectibles on Zenon ZVM devnet.",
  ],
  "/activity": [
    "Pictures on the move.",
    "Confirmed mints and transfers from the ZFT contract on ZVM devnet.",
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
  if (staticPages[path])
    return {
      ...base,
      title: staticPages[path][0],
      description: staticPages[path][1],
      imagePath: `/api/og/page/${path.slice(1) || "home"}.png`,
    };
  if (
    [
      "/collection",
      "/mint",
      "/claim",
      "/recovery",
      "/settings/profile",
    ].includes(path)
  )
    return { ...base, private: true };
  const profile = /^\/p\/(0x[\da-fA-F]{40})$/.exec(path);
  const artwork = /^\/item\/(\d{1,78})$/.exec(path);
  if (profile) {
    const address = addressSchema.parse(profile[1]).toLowerCase();
    const p = await profileData(env, address);
    const selected = url.searchParams.get("nft");
    if (selected) {
      uintSchema.parse(selected);
      if (!(await inProfile(env, address, selected)))
        throw new HttpError(404, "This artwork is not in the public profile.");
      const i = await item(env, selected);
      return {
        ...base,
        path: `/p/${address}?nft=${selected}`,
        imagePath: `/api/og/p/${address}/${selected}.png`,
        title: i.metadata.name,
        description:
          i.metadata.description ||
          `A collectible shared by ${p.profile.name}.`,
        label: p.profile.name,
        subtitle: "ONE PICTURE / ONE COLLECTIBLE",
        art: [
          {
            hash: i.metadata.imageHash,
            width: i.metadata.width,
            height: i.metadata.height,
          },
        ],
        revisionData: [i.metadataHash, p.profile.revision],
      };
    }
    const created = await gallery(env, new URL("https://internal"), address);
    const collected = await gallery(
      env,
      new URL("https://internal"),
      address,
      "collection",
    );
    const featured =
      p.profile.featured && (await inProfile(env, address, p.profile.featured))
        ? await item(env, p.profile.featured).catch(() => null)
        : null;
    const pieces = [
      ...(featured ? [featured] : []),
      ...created.items.filter((i) => i.tokenId !== featured?.tokenId),
      ...collected.items.filter(
        (i) =>
          i.tokenId !== featured?.tokenId &&
          !created.items.some((c) => c.tokenId === i.tokenId),
      ),
    ].slice(0, 3);
    return {
      ...base,
      path: `/p/${address}`,
      imagePath: `/api/og/p/${address}.png`,
      title: p.profile.name,
      description: p.profile.bio || "A public ZFT collection on ZVM devnet.",
      label: "Public collection",
      subtitle: `${p.counts.created} CREATED / ${p.counts.collected} COLLECTED / ${p.counts.followers} FOLLOWERS`,
      art: pieces.map((i) => ({
        hash: i.metadata.imageHash,
        width: i.metadata.width,
        height: i.metadata.height,
      })),
      revisionData: [p.profile.revision, p.counts],
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
        },
      ],
      revisionData: i.metadataHash,
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
  const page = await snapshot(env, new URL(request.url));
  const revision = digest(page).slice(2);
  if (!page.private) {
    const key = `og-snapshots${page.imagePath}/${revision}.json`;
    if (!(await env.MEDIA.head(key)))
      await env.MEDIA.put(key, JSON.stringify(page), {
        httpMetadata: { contentType: "application/json" },
      });
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
      'title, meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]',
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
    .transform(new Response(shell.body, { status: shell.status, headers }));
}
export async function ogResponse(env: Env, url: URL) {
  if (
    !/^\/api\/og\/(page\/(home|explore|activity|about|how-it-works)|item\/\d{1,78}|p\/0x[\da-f]{40}(\/\d{1,78})?)\.png$/.test(
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
  if (profileContext)
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
