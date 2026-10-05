import { mkdir, readFile, writeFile } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { spawnSync } from "node:child_process";
import type { Hex } from "viem";
await mkdir(".local", { recursive: true, mode: 0o700 });
let key: Hex;
try {
  key = JSON.parse(
    await readFile(".local/hosted-sponsor.json", "utf8"),
  ).privateKey;
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  key = generatePrivateKey();
  await writeFile(
    ".local/hosted-sponsor.json",
    JSON.stringify({ privateKey: key }),
    { flag: "wx", mode: 0o600 },
  );
}
const address = privateKeyToAccount(key).address;
console.log("Hosted devnet sponsor:", address);
if (process.argv.includes("--fund")) {
  const r = await fetch("https://devnet.zenon.foo/zvm/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  console.log("Free devnet faucet HTTP", r.status);
  if (!r.ok) throw new Error("Faucet request failed");
}
if (process.argv.includes("--install-secret")) {
  // Pass only through stdin. Neither the key nor a signed transaction is logged.
  const r = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "secret",
      "put",
      "SPONSOR_PRIVATE_KEY",
      "--config",
      "wrangler.devnet.jsonc",
      "--env=",
    ],
    { input: key + "\n", stdio: ["pipe", "inherit", "inherit"] },
  );
  if (r.status !== 0) throw new Error("Cloudflare secret installation failed");
}
