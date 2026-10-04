import { sha256, type Address, type Hex } from "viem";
import { z } from "zod";
import {
  canonical,
  digest,
  metadataSchema,
  operationSchema,
  sameAddress,
  abi,
  type Deployment,
} from "../../packages/protocol";
import manifest from "../../packages/protocol/deployment.json";
import {
  checkDeployment,
  ownership,
  publicClient,
} from "../../packages/protocol/client";
import { validatePublicImage } from "../../packages/file-codec";
import { unbase64 } from "../../packages/vault";
import { HttpError, json } from "./sponsor";
import type { Env } from "./types";
export { Sponsor } from "./sponsor";

const uploadSchema = z
  .object({ image: z.string().max(14_000_000), metadata: metadataSchema })
  .strict();
async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new HttpError(413, "Request is too large.");
  if (!request.body) throw new HttpError(400, "Request body required.");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      length += r.value.length;
      if (length > limit) throw new HttpError(413, "Request is too large.");
      parts.push(r.value);
    }
  } finally {
    await reader.cancel();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.length;
  }
  return body;
}
async function internal(env: Env, path: string, body?: unknown) {
  const stub = env.SPONSOR.get(env.SPONSOR.idFromName("zft-devnet-v1"));
  return stub.fetch(
    `https://internal${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
async function authenticated(
  request: Request,
  env: Env,
  body: Uint8Array,
  ip: string,
) {
  const proof = await internal(env, "/authenticate", {
    id: request.headers.get("x-zft-challenge") ?? "",
    signature: request.headers.get("x-zft-signature") ?? "",
    method: request.method,
    path: new URL(request.url).pathname,
    bodyHash: sha256(body),
    ip,
  });
  if (!proof.ok)
    throw new HttpError(
      proof.status,
      ((await proof.json()) as { error: string }).error,
    );
  return ((await proof.json()) as { address: Address }).address;
}
async function route(request: Request, env: Env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get("origin") !== env.PUBLIC_ORIGIN)
      throw new HttpError(403, "Use the configured ZFT app origin.");
    if (request.headers.get("content-type") !== "application/json")
      throw new HttpError(415, "JSON required.");
  }
  if (path === "/api/config")
    return json({
      deployment: manifest,
      sponsorEnabled:
        env.SPONSOR_ENABLED === "true" && !!env.SPONSOR_PRIVATE_KEY,
      stage: "devnet-alpha",
      imageFormat: "PNG",
      maxImageBytes: 10 * 1024 * 1024,
    });
  if (path === "/api/health") {
    if (!manifest.contract)
      return json({ ready: false, reason: "Contract not deployed" }, 503);
    await checkDeployment(manifest as unknown as Deployment);
    return json({
      ready: true,
      network: "ZVM devnet",
      sponsorEnabled: env.SPONSOR_ENABLED === "true",
    });
  }
  // Salt by day and deployment; only a short-lived admission fingerprint is persisted.
  const ip = sha256(
    new TextEncoder().encode(
      `${Math.floor(Date.now() / 86_400_000)}:${manifest.contract}:${request.headers.get("cf-connecting-ip") ?? "local"}`,
    ),
  );
  if (path === "/api/challenges" && request.method === "POST")
    return internal(env, "/challenge", {
      input: JSON.parse(
        new TextDecoder().decode(await boundedBody(request, 2048)),
      ),
      ip,
    });
  if (path === "/api/uploads" && request.method === "POST") {
    const body = await boundedBody(request, 14_100_000),
      profile = await authenticated(request, env, body, ip);
    const data = uploadSchema.parse(JSON.parse(new TextDecoder().decode(body))),
      image = unbase64(data.image),
      m = data.metadata;
    const dimensions = await validatePublicImage(image);
    if (
      sha256(image) !== m.imageHash ||
      dimensions.width !== m.width ||
      dimensions.height !== m.height ||
      !sameAddress(m.creator, profile) ||
      m.image !== `${manifest.metadataOrigin}/art/${m.imageHash.slice(2)}.png`
    )
      throw new HttpError(400, "Image metadata mismatch.");
    const metadataHash = digest(m);
    await env.MEDIA.put(`art/${m.imageHash.slice(2)}.png`, image, {
      httpMetadata: { contentType: "image/png" },
    });
    await env.MEDIA.put(
      `metadata/${metadataHash.slice(2)}.json`,
      canonical(m),
      { httpMetadata: { contentType: "application/json" } },
    );
    return json({ imageHash: m.imageHash, metadataHash });
  }
  if (path === "/api/operations" && request.method === "POST") {
    const body = await boundedBody(request, 8192),
      profile = await authenticated(request, env, body, ip);
    const op = operationSchema.parse(
      JSON.parse(new TextDecoder().decode(body)),
    );
    return internal(env, "/submit", { operation: op, profile });
  }
  if (
    /^\/api\/operations\/0x[\da-f]{64}$/.test(path) &&
    request.method === "GET"
  )
    return internal(env, `/operation/${path.split("/").at(-1)}`);
  if (path === "/api/gallery" && request.method === "GET") {
    const response = await internal(env, "/gallery"),
      catalog = (await response.json()) as {
        items: { tokenId: string; metadataHash: Hex }[];
      };
    const items = await Promise.all(
      catalog.items.map(async (item) => {
        const object = await env.MEDIA.get(
          `metadata/${item.metadataHash.slice(2)}.json`,
        );
        return object ? { ...item, metadata: await object.json() } : null;
      }),
    );
    return json({ items: items.filter(Boolean) });
  }
  if (/^\/api\/items\/\d{1,78}$/.test(path) && request.method === "GET") {
    if (!manifest.contract) throw new HttpError(503, "Contract not deployed.");
    const tokenId = path.split("/").at(-1)!;
    await checkDeployment(manifest as unknown as Deployment);
    const state = await ownership(manifest.contract as Address, tokenId),
      object = await env.MEDIA.get(
        `metadata/${state.metadataHash.slice(2)}.json`,
      );
    return json({
      tokenId,
      ...state,
      metadata: object ? await object.json() : null,
    });
  }
  const media = /^\/(art|metadata)\/([\da-f]{64})\.(png|json)$/.exec(path);
  if (media && request.method === "GET") {
    if (!manifest.contract || (media[1] === "art") !== (media[3] === "png"))
      throw new HttpError(404, "Not found.");
    // Draft objects are private until there is a corresponding on-chain mint.
    const object = await env.MEDIA.get(path.slice(1));
    if (!object) throw new HttpError(404, "Not found.");
    let tokenId: bigint,
      content: ReadableStream | string = object.body;
    if (media[1] === "metadata") {
      content = await object.text();
      const m = metadataSchema.parse(JSON.parse(content));
      tokenId = BigInt(m.imageHash);
    } else tokenId = BigInt(`0x${media[2]}`);
    const hash = await publicClient.readContract({
      address: manifest.contract as Address,
      abi,
      functionName: "metadataHashOf",
      args: [tokenId],
    });
    if (
      hash === "0x" + "0".repeat(64) ||
      (media[1] === "metadata" && hash !== `0x${media[2]}`)
    )
      throw new HttpError(404, "Not minted.");
    return new Response(content, {
      headers: {
        "content-type": media[1] === "art" ? "image/png" : "application/json",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (path.startsWith("/api/")) throw new HttpError(404, "Unknown API route.");
  return env.ASSETS.fetch(request);
}
export default {
  async fetch(request: Request, env: Env) {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      response = json(
        {
          error:
            error instanceof HttpError
              ? error.message
              : error instanceof z.ZodError
                ? "Invalid request format."
                : "Service unavailable. Keep your saved keys and retry.",
        },
        error instanceof HttpError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 503,
      );
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
    return new Response(response.body, { status: response.status, headers });
  },
};
