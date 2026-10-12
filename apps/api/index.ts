import { HttpError, json } from "./http";
import { galleryError, shieldedGallery } from "./shielded-gallery";
import type { Env } from "./types";
// Keep deployed Durable Object classes available for existing stored data. The public site no longer routes to them.
export { Sponsor } from "./sponsor";
export { Indexer } from "./indexer";

async function body(request: Request) {
  const limit = 14_000_000;
  if (Number(request.headers.get("content-length")) > limit)
    throw new HttpError(413, "Request is too large.");
  if (!request.body) throw new HttpError(400, "Request body required.");
  const reader = request.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) throw new HttpError(413, "Request is too large.");
      parts.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
const aliases: Record<string, string> = {
  "/mint": "/shielded/create",
  "/wallet": "/shielded",
  "/collection": "/shielded",
  "/claim": "/shielded/claim",
  "/recovery": "/shielded/recovery",
  "/explore": "/",
  "/explore/nfts": "/",
  "/about": "/how-it-works",
};
async function route(request: Request, env: Env) {
  const url = new URL(request.url),
    path = url.pathname;
  const gallery = shieldedGallery(env.MEDIA);
  if (path === "/api/shielded/gallery" && request.method === "POST") {
    if (request.headers.get("origin") !== env.PUBLIC_ORIGIN)
      throw new HttpError(403, "Use the configured ZFT app origin.");
    if (request.headers.get("content-type") !== "application/json")
      throw new HttpError(415, "JSON required.");
    return json(await gallery.publish(await body(request)));
  }
  if (!["GET", "HEAD"].includes(request.method))
    throw new HttpError(405, "Method not allowed.");
  if (path === "/api/shielded/gallery")
    return json(await gallery.list(url.searchParams.get("cursor")));
  const item = /^\/api\/shielded\/gallery\/(0x[0-9a-f]{64})(\/image)?$/.exec(
    path,
  );
  if (item) {
    if (!item[2]) return json(await gallery.item(item[1]));
    return new Response(new Uint8Array(await gallery.image(item[1])), {
      headers: { "content-type": "image/png" },
    });
  }
  if (
    path.startsWith("/api/") ||
    /^\/(art|metadata|profile-media)(\/|$)/.test(path)
  )
    throw new HttpError(404, "Not found.");
  if (aliases[path])
    return Response.redirect(
      new URL(aliases[path], env.PUBLIC_ORIGIN).href,
      308,
    );
  // Only the shielded public gallery and help use the HTML shell. Retired profiles and wallet pages are gone.
  if (
    path === "/" ||
    path === "/how-it-works" ||
    /^\/nft\/0x[0-9a-f]{64}$/.test(path)
  )
    return env.ASSETS.fetch(
      new Request(new URL("/index.html", request.url), { method: "GET" }),
    );
  if (
    !path.startsWith("/assets/") &&
    !path.startsWith("/licenses/") &&
    !["/favicon.ico", "/favicon.svg"].includes(path)
  )
    throw new HttpError(404, "Not found.");
  return env.ASSETS.fetch(request);
}
export default {
  // The retired wallet index is no longer refreshed; its stored data is left intact.
  async scheduled() {},
  async fetch(request: Request, env: Env) {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      response = galleryError(error);
    }
    const headers = new Headers(response.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    headers.set(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' https://devnet.zenon.foo; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
    headers.set("cache-control", "no-store");
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers,
    });
  },
};
