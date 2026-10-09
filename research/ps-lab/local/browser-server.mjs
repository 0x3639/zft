// Loopback-only disposable test console. No public issuer API or arbitrary file access.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { PresentationApi, MAX_PRESENTATION_BODY } from "./presentation-api.mjs";
import { BrowserLab, MAX_BODY } from "./browser-lab.mjs";
import { PersistentLab } from "./persistent.mjs";
import { PersistentBrowserIssuer } from "./persistent-api.mjs";
import { parse } from "./profile.mjs";
import { BrowserIssuer, MAX_CLIENT_BODY } from "./browser-client-api.mjs";
import { productAssets, productRoute } from "./product-assets.mjs";
import { browserModules } from "../web/modules.mjs";
const assets = new Map(
  [
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ].map(([url, [file, type]]) => [
    url,
    { type, data: readFileSync(new URL("./browser/" + file, import.meta.url)) },
  ]),
);
for (const [url, data] of browserModules())
  assets.set(url, { type: "text/javascript; charset=utf-8", data });
for (const [url, file] of [
  ["/vault/", "index.html"],
  ["/client/", "client.html"],
])
  assets.set(url, {
    type: "text/html; charset=utf-8",
    data: readFileSync(new URL("../web/" + file, import.meta.url)),
  });
assets.set("/vault/style.css", {
  type: "text/css; charset=utf-8",
  data: readFileSync(new URL("../web/style.css", import.meta.url)),
});
for (const name of ["noble-curves", "noble-hashes"])
  assets.set("/licenses/" + name, {
    type: "text/plain; charset=utf-8",
    data: readFileSync(
      new URL("../licenses/" + name + "-LICENSE", import.meta.url),
    ),
  });
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
export async function startBrowserLab({
  product = false,
  productRoot = undefined,
  persistentDir = undefined,
} = {}) {
  assert(!persistentDir || product, "persistent mode requires product UI");
  const served = new Map(assets);
  if (persistentDir)
    for (const key of [
      "/",
      "/app.js",
      "/style.css",
      "/vault/",
      "/client/",
      "/vault/style.css",
    ])
      served.delete(key);
  if (product)
    for (const [url, asset] of productAssets(productRoot)) {
      assert(!served.has(url), "product asset collision");
      served.set(url, asset);
    }
  const lab = persistentDir
    ? new PersistentLab(persistentDir)
    : new BrowserLab();
  const browserIssuer = persistentDir
    ? new PersistentBrowserIssuer(lab)
    : new BrowserIssuer(lab.issuer);
  const token = randomBytes(32).toString("hex");
  let presentation,
    ready = false;
  let origin,
    host,
    active = 0;
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 },
    async (req, res) => {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      const reply = (status, value) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (!ready) return reply(503, { error: "Local issuer starting." });
      // Duplicate security headers are rejected even when Node coalesces them.
      const single = (name) => req.headersDistinct[name]?.length === 1;
      if (!single("host") || req.headers.host !== host)
        return reply(403, { error: "Loopback host required." });
      if (product && req.method === "GET") {
        if (req.url === "/ps/trust.json")
          return reply(200, presentation.pins());
        const publicPath =
          /^\/ps\/(evidence|art|proof)\/([0-9a-f]{64})(\.png)?$/.exec(req.url);
        if (publicPath) {
          const [, kind, id, suffix] = publicPath;
          if ((kind === "art") !== (suffix === ".png"))
            return reply(404, { error: "Not found." });
          const record = presentation.read(id);
          if (!record) return reply(404, { error: "Not found." });
          if (kind === "evidence") return reply(200, record);
          if (kind === "art") {
            res.writeHead(200, { "Content-Type": "image/png" });
            return res.end(
              Buffer.from(parse(record.wire, 150000).image, "hex"),
            );
          }
          const title = "ZFT PS evidence · " + id.slice(0, 8);
          const description =
            "Public PS evidence with a timestamped issuer report. This is not a spend reservation or guaranteed current ownership.";
          const head =
            '<meta name="description" content="' +
            description +
            '"><meta property="og:title" content="' +
            title +
            '"><meta property="og:description" content="' +
            description +
            '"><meta property="og:image" content="' +
            origin +
            "/ps/art/" +
            id +
            '.png"><meta property="og:url" content="' +
            origin +
            "/ps/proof/" +
            id +
            '">';
          const html = served
            .get("/ps/")
            .data.toString()
            .replace(/<title>[^<]*<\/title>/, "<title>" + title + "</title>")
            .replace(/<meta\s+name="description"[^>]*>/, "")
            .replace("</head>", head + "</head>");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(html);
        }
      }
      const path = product ? req.url.split("?")[0] : req.url;
      const staticPath = product && productRoute(path) ? "/ps/" : path;
      if (req.method === "GET" && served.has(staticPath)) {
        const asset = served.get(staticPath);
        res.writeHead(200, { "Content-Type": asset.type });
        return res.end(asset.data);
      }
      if (
        !(
          persistentDir
            ? ["/issuer", "/presentation"]
            : product
              ? ["/api", "/issuer", "/presentation"]
              : ["/api", "/issuer"]
        ).includes(req.url) ||
        req.method !== "POST"
      )
        return reply(404, { error: "Not found." });
      const authorization = req.headers.authorization;
      if (
        !single("origin") ||
        req.headers.origin !== origin ||
        !single("authorization") ||
        typeof authorization !== "string" ||
        !/^Bearer [0-9a-f]{64}$/.test(authorization) ||
        !timingSafeEqual(
          Buffer.from(authorization.slice(7)),
          Buffer.from(token),
        )
      )
        return reply(403, {
          error: "Open the launch link from the local terminal.",
        });
      if (
        req.headers["content-type"] !== "application/json" ||
        req.headers["content-encoding"] ||
        req.headers.expect
      )
        return reply(415, { error: "Plain JSON required." });
      if (active >= 2)
        return reply(429, {
          error: "Lab busy. Retry after the current action.",
        });
      active++;
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          assert(
            size <=
              (req.url === "/issuer"
                ? MAX_CLIENT_BODY
                : req.url === "/presentation"
                  ? MAX_PRESENTATION_BODY
                  : MAX_BODY),
            "body bound",
          );
          chunks.push(chunk);
        }
        const wire = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(Buffer.concat(chunks));
        const result =
          req.url === "/presentation"
            ? await presentation.dispatch(parse(wire, MAX_PRESENTATION_BODY))
            : req.url === "/issuer"
              ? browserIssuer.dispatch(parse(wire, MAX_CLIENT_BODY))
              : lab.dispatch(parse(wire, MAX_BODY));
        reply(200, result);
      } catch {
        // Never return assertion diffs, request bodies, passwords or credential material.
        if (!res.destroyed)
          reply(400, {
            error:
              "Action rejected. Check the selected client, exact file and password. A stale bearer or duplicate mint can also be rejected; preserve pending recovery.",
          });
      } finally {
        active--;
      }
    },
  );
  server.maxConnections = 8;
  server.setTimeout(10000, (socket) => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(persistentDir ? lab.config.port : 0, "127.0.0.1", resolve);
    });
    host = "127.0.0.1:" + server.address().port;
    origin = "http://" + host;
    if (product)
      presentation = new PresentationApi(
        lab.issuer,
        join(lab.dir, "presentations.db"),
        origin,
        persistentDir
          ? { privateKey: lab.statusPrivateKey, durable: true }
          : {},
      );
    if (persistentDir) await presentation.validateRecords();
    ready = true;
  } catch (error) {
    server.close();
    presentation?.close();
    lab.close();
    throw error;
  }
  return {
    origin,
    token,
    lab,
    url: origin + (product ? "/ps/#" : "/#") + token,
    close: async () => {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      presentation?.close();
      lab.close();
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const running = await startBrowserLab({
    product: process.argv.includes("--product"),
  });
  console.log(
    "Disposable PS browser lab — test keys only. Stopping deletes issuer and client state.",
  );
  console.log(running.url);
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await running.close();
      process.exit(0);
    });
}
