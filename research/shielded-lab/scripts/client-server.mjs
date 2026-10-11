// Disposable local fixture only. No remote chain, user keys, persistence or hosted deployment.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { startAnvil } from "../evm-test.mjs";
import { deployFixture } from "../local-fixture.mjs";
const lab = fileURLToPath(new URL("../", import.meta.url)),
  cached = new Map();
function load(dir, prefix = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name),
      url = prefix + "/" + entry.name;
    if (entry.isDirectory()) load(path, url);
    else
      cached.set(url, {
        bytes: readFileSync(path),
        type:
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
          }[extname(path)] ?? "application/octet-stream",
      });
  }
}
load(resolve(lab, "build/client"));
cached.set("/", cached.get("/index.html"));
cached.set("/prover-worker.js", {
  bytes: readFileSync(resolve(lab, "browser/prover-worker.js")),
  type: "text/javascript",
});
const fixture = JSON.parse(
  readFileSync(resolve(lab, "build/browser-fixture.json"), "utf8"),
);
for (const name of ["create", "spend"])
  for (const [kind, file] of [
    ["wasm", `${name}_js/${name}.wasm`],
    ["key", `${name}-groth16.zkey`],
    ["verificationKey", `${name}-groth16.vkey.json`],
  ])
    cached.set(`/artifacts/${name}-${kind}`, {
      bytes: readFileSync(resolve(lab, "build", file)),
      type: kind === "wasm" ? "application/wasm" : "application/octet-stream",
    });
cached.set("/vendor/snarkjs.min.js", {
  bytes: readFileSync(
    resolve(lab, "node_modules/snarkjs/build/snarkjs.min.js"),
  ),
  type: "text/javascript",
});
const evm = await startAnvil();
let server, host;
try {
  const deployed = await deployFixture(evm);
  cached.set("/config.json", {
    bytes: Buffer.from(
      JSON.stringify({
        pins: deployed.pins,
        abi: deployed.abi,
        rpc: evm.url,
        artifacts: fixture.artifacts,
      }),
    ),
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
          !["/fund", "/mine"].includes(req.url)
        )
          return reject();
        let size = 0,
          parts = [];
        for await (const part of req) {
          size += part.length;
          if (size > 256) {
            req.destroy();
            return;
          }
          parts.push(part);
        }
        if (req.url === "/fund") {
          if (req.headers["content-type"] !== "application/json")
            return reject();
          const input = JSON.parse(Buffer.concat(parts).toString("utf8"));
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
          if (size !== 0) return reject();
          await evm.mine(2);
        }
        res.writeHead(204, { "cache-control": "no-store" });
        res.end();
        return;
      }
      if (!["GET", "HEAD"].includes(req.method) || !cached.has(req.url))
        return reject();
      const file = cached.get(req.url);
      res.writeHead(200, {
        "content-type": file.type,
        "content-length": file.bytes.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "require-corp",
        "content-security-policy": `default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ${evm.url}; style-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'`,
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
  console.log(`http://${host}`);
  const stop = async () => {
    server.close();
    server.closeAllConnections();
    await evm.stop();
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      stop().catch(() => {
        process.exitCode = 1;
      });
    });
} catch (e) {
  server?.close();
  await evm.stop();
  throw e;
}
