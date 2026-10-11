// Local, read-only view of the prepared static package; never starts a chain or fee wallet.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handle, ORIGIN } from "./worker.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const directory = resolve(here, "build/candidate/public");
const manifest = JSON.parse(
  readFileSync(resolve(here, "build/candidate/asset-manifest.json")),
);
let host;
const env = {
  ASSETS: {
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (!Object.hasOwn(manifest.files, path))
        return new Response(null, { status: 404 });
      return new Response(readFileSync(resolve(directory, "." + path)));
    },
  },
};
const server = createServer(async (req, res) => {
  try {
    if (
      req.headers.host !== host ||
      !["GET", "HEAD"].includes(req.method) ||
      !req.url?.startsWith("/") ||
      req.url.startsWith("//")
    ) {
      res.writeHead(400, { "cache-control": "no-store" });
      res.end("Read-only local preview");
      return;
    }
    const r = await handle(
      new Request(ORIGIN + req.url, { method: req.method }),
      env,
      manifest,
    );
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.writeHead(503, { "cache-control": "no-store" });
    res.end("Preview unavailable");
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
await new Promise((yes, no) => {
  server.once("error", no);
  server.listen(0, "127.0.0.1", yes);
});
host = "127.0.0.1:" + server.address().port;
console.log(
  JSON.stringify({
    url: "http://" + host + "/shielded",
    scope:
      "Local static preview; chain reads use the selected ZVM devnet only. No injected wallet, funding, mining or deployment.",
  }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close(() => process.exit(0)));
