// Serves only a disposable local app trial. No user state, secrets or remote chain inputs.
import { createServer } from "node:http";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { encode } from "fast-png";
import { startAnvil, lab } from "../shielded-lab/evm-test.mjs";
import { deployFixture } from "../shielded-lab/local-fixture.mjs";
import { canonical } from "../shielded-lab/core.mjs";
import { configuration } from "./test/support.mjs";
const dir = fileURLToPath(new URL("./", import.meta.url)),
  temp = mkdtempSync(join(tmpdir(), "zft-shielded-app-demo-"));
await build({
  configFile: false,
  build: {
    target: "es2022",
    outDir: resolve(dir, "build/test-wallet"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(dir, "browser-wallet.mjs"),
      output: { entryFileNames: "wallet.js" },
    },
  },
  logLevel: "error",
});
const cache = new Map();
function load(folder, prefix = "") {
  for (const e of readdirSync(folder, { withFileTypes: true })) {
    const path = resolve(folder, e.name),
      url = prefix + "/" + e.name;
    if (e.isDirectory()) load(path, url);
    else
      cache.set(url, {
        bytes: readFileSync(path),
        type:
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          }[extname(path)] ?? "application/octet-stream",
      });
  }
}
load(resolve(dir, "build/web"));
load(resolve(dir, "build/test-wallet"), "/test-wallet");
const html = cache.get("/index.html");
html.bytes = Buffer.from(
  html.bytes
    .toString()
    .replace(
      "<body>",
      '<body><aside><strong>Disposable local trial</strong> · <button id="test-mine">Advance two local blocks</button> · <span id="test-state">Opening test wallet…</span></aside><script type="module" src="/test-wallet/wallet.js"></script>',
    ),
);
for (const path of [
  "/",
  "/shielded",
  "/shielded/create",
  "/shielded/claim",
  "/shielded/recovery",
])
  cache.set(path, html);
for (const name of ["create", "spend"])
  for (const [kind, file] of [
    ["wasm", `${name}_js/${name}.wasm`],
    ["key", `${name}-groth16.zkey`],
    ["verificationKey", `${name}-groth16.vkey.json`],
  ])
    cache.set(`/shielded-assets/${name}-${kind}`, {
      bytes: readFileSync(resolve(lab, "build", file)),
      type: kind === "wasm" ? "application/wasm" : "application/octet-stream",
    });
cache.set("/shielded-assets/snarkjs.min.js", {
  bytes: readFileSync(
    resolve(lab, "node_modules/snarkjs/build/snarkjs.min.js"),
  ),
  type: "text/javascript",
});
const evm = await startAnvil();
let server, host;
try {
  const f = await deployFixture(evm),
    config = canonical(configuration(evm, f.pins));
  writeFileSync(join(temp, "config.json"), config, { mode: 0o600 });
  writeFileSync(
    join(temp, "picture.png"),
    encode({
      width: 2,
      height: 2,
      channels: 4,
      depth: 8,
      data: new Uint8Array([
        15, 100, 90, 255, 100, 220, 170, 255, 60, 60, 120, 255, 230, 180, 50,
        255,
      ]),
    }),
    { mode: 0o600 },
  );
  cache.set("/test/config.json", {
    bytes: Buffer.from(config),
    type: "application/json",
  });
  server = createServer(async (req, res) => {
    const reject = () => {
      res.writeHead(400, { "cache-control": "no-store" });
      res.end("Local request rejected");
    };
    try {
      if (req.headers.host !== host) return reject();
      if (req.method === "POST") {
        if (
          req.headers.origin !== `http://${host}` ||
          !["/test/fund", "/test/mine"].includes(req.url)
        )
          return reject();
        const parts = [];
        let size = 0;
        for await (const part of req) {
          size += part.length;
          if (size > 256) {
            req.destroy();
            return;
          }
          parts.push(part);
        }
        if (req.url === "/test/fund") {
          if (req.headers["content-type"] !== "application/json")
            return reject();
          const input = JSON.parse(Buffer.concat(parts));
          if (
            Object.keys(input).join(",") !== "address" ||
            !/^0x[0-9a-f]{40}$/.test(input.address) ||
            /^0x0{40}$/.test(input.address)
          )
            return reject();
          await evm.client.request({
            method: "anvil_setBalance",
            params: [input.address, "0x56bc75e2d63100000"],
          });
        } else {
          if (size) return reject();
          await evm.mine(2);
        }
        res.writeHead(204, { "cache-control": "no-store" });
        res.end();
        return;
      }
      if (!["GET", "HEAD"].includes(req.method) || !cache.has(req.url))
        return reject();
      const file = cache.get(req.url);
      res.writeHead(200, {
        "content-type": file.type,
        "content-length": file.bytes.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "require-corp",
        "content-security-policy": `default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ${evm.url}; style-src 'self'; font-src 'self'; img-src 'self' blob: data:; base-uri 'none'; frame-ancestors 'none'`,
      });
      res.end(req.method === "HEAD" ? undefined : file.bytes);
    } catch {
      if (!res.headersSent) reject();
      else res.destroy();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  host = `127.0.0.1:${server.address().port}`;
  console.log(
    JSON.stringify({
      url: `http://${host}/shielded`,
      fixtures: temp,
      scope:
        "Disposable test keys in browser only; test server funds public addresses and mines local blocks",
    }),
  );
  const stop = async () => {
    server.close();
    server.closeAllConnections();
    await evm.stop();
    rmSync(temp, { recursive: true, force: true });
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () =>
      stop().catch(() => {
        process.exitCode = 1;
      }),
    );
} catch (e) {
  server?.close();
  await evm.stop();
  rmSync(temp, { recursive: true, force: true });
  throw e;
}
