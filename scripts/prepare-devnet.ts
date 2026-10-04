import { mkdir, readFile, writeFile } from "node:fs/promises";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
await mkdir(".local", { recursive: true, mode: 0o700 });
let keys: { deployer: Hex; sponsor: Hex };
try {
  keys = JSON.parse(await readFile(".local/devnet-keys.json", "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  keys = { deployer: generatePrivateKey(), sponsor: generatePrivateKey() };
  await writeFile(".local/devnet-keys.json", JSON.stringify(keys), {
    flag: "wx",
    mode: 0o600,
  });
}
// Public addresses only. These keys are dedicated to valueless devnet gas.
for (const [role, key] of Object.entries(keys))
  console.log(`${role}: ${privateKeyToAccount(key).address}`);
if (process.argv.includes("--fund")) {
  const role = process.argv.includes("--sponsor") ? "sponsor" : "deployer";
  const response = await fetch("https://devnet.zenon.foo/zvm/api/faucet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: privateKeyToAccount(keys[role]).address }),
  });
  console.log(`Faucet ${role}: HTTP ${response.status}`);
  console.log(await response.text());
}
