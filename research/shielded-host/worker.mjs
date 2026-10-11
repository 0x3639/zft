export const ORIGIN = "https://devnet.zft.foo";
const pages = new Set([
  "/shielded",
  "/shielded/",
  "/shielded/create",
  "/shielded/claim",
  "/shielded/recovery",
]);
const security = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy":
    "default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://devnet.zenon.foo/zvm/rpc; style-src 'self'; font-src 'self'; img-src 'self' blob: data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'",
};
const fail = (status, text) =>
  new Response(text, {
    status,
    headers: { ...security, "content-type": "text/plain; charset=utf-8" },
  });
export async function handle(request, env, manifest) {
  const u = new URL(request.url);
  if (u.origin !== ORIGIN || u.search || /%|\\/.test(u.pathname))
    return fail(404, "Not found");
  if (!["GET", "HEAD"].includes(request.method))
    return fail(405, "Read-only static host");
  const path = pages.has(u.pathname) ? "/shielded/index.html" : u.pathname;
  const entry = manifest.files[path];
  if (!entry || (path === "/shielded/index.html" && !pages.has(u.pathname)))
    return fail(404, "Not found");
  // Construct a fresh request: never forward cookies, authorization, Range or conditional headers.
  let response;
  try {
    response = await env.ASSETS.fetch(new Request(ORIGIN + path));
    if (response.status !== 200) {
      await response.body?.cancel();
      return fail(503, "Static package unavailable");
    }
    if (request.method === "HEAD") await response.body?.cancel();
  } catch {
    return fail(503, "Static package unavailable");
  }
  const headers = new Headers(security);
  headers.set("content-type", entry.type);
  headers.set("content-length", String(entry.bytes));
  if (path === "/shielded/config.json")
    headers.set(
      "content-disposition",
      'attachment; filename="zft-devnet-config.json"',
    );
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: 200,
    headers,
  });
}
