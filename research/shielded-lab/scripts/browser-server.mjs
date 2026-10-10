import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const lab = fileURLToPath(new URL("../", import.meta.url));
const files = new Map();
for (const name of ["index.html", "style.css", "main.js", "prover-worker.js"])
  files.set(name === "index.html" ? "/" : "/" + name, {
    path: resolve(lab, "browser", name),
    type: name.endsWith(".js")
      ? "text/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : "text/html",
  });
files.set("/fixture.json", {
  path: resolve(lab, "build/browser-fixture.json"),
  type: "application/json",
});
files.set("/vendor/snarkjs.min.js", {
  path: resolve(lab, "node_modules/snarkjs/build/snarkjs.min.js"),
  type: "text/javascript",
});
for (const name of ["create", "spend"])
  for (const [kind, file] of [
    ["wasm", `${name}_js/${name}.wasm`],
    ["key", `${name}-groth16.zkey`],
    ["verificationKey", `${name}-groth16.vkey.json`],
  ])
    files.set(`/artifacts/${name}-${kind}`, {
      path: resolve(lab, "build", file),
      type: kind === "wasm" ? "application/wasm" : "application/octet-stream",
    });
const cached = new Map(
  [...files].map(([url, entry]) => [
    url,
    { ...entry, bytes: readFileSync(entry.path) },
  ]),
);
let host;
const server = createServer((req, res) => {
  if (
    req.headers.host !== host ||
    !["GET", "HEAD"].includes(req.method) ||
    !cached.has(req.url)
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  const file = cached.get(req.url);
  res.writeHead(200, {
    "content-type": file.type,
    "content-length": file.bytes.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
    "content-security-policy":
      "default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; style-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(req.method === "HEAD" ? undefined : file.bytes);
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(0, "127.0.0.1", () => {
  host = `127.0.0.1:${server.address().port}`;
  console.log(`http://${host}`);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
