import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../../", import.meta.url));
function js(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    return e.isDirectory()
      ? js(p)
      : e.name.endsWith(".js")
        ? [readFileSync(p, "utf8")]
        : [];
  });
}
for (const enabled of [false, true]) {
  const output = resolve(
    root,
    "research/shielded-app/build",
    enabled ? "web" : "default",
  );
  const env = { ...process.env, ZFT_SHIELDED_CANDIDATE: enabled ? "1" : "0" };
  const result = spawnSync("pnpm", ["build", "--outDir", output], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  assert.equal(result.status, 0, "web build must succeed");
  const source = js(output).join("\n");
  for (const marker of [
    "zft-shielded-app-config-v1",
    "zft-shielded-recovery-aes256gcm-v1",
  ])
    assert.equal(
      source.includes(marker),
      enabled,
      `${marker}: explicit build gate`,
    );
  assert.ok(
    !source.includes("/test/fund"),
    "disposable fee-wallet shim must never enter the product bundle",
  );
  assert.ok(
    !source.includes("/test/mine"),
    "test mining controls must never enter the product bundle",
  );
  console.log(`PASS ${enabled ? "opt-in" : "default"} shielded build boundary`);
}
