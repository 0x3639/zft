import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productAssets, productRoute } from "./product-assets.mjs";
import { startBrowserLab } from "./browser-server.mjs";
test("product loader exposes only fixed build assets and scoped routes", () => {
  const root = mkdtempSync(join(tmpdir(), "zft-product-build-"));
  try {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<p>test product</p>");
    writeFileSync(join(root, "assets", "main.js"), "export {};");
    writeFileSync(join(root, "assets", "private.json"), "hidden");
    const assets = productAssets(root);
    assert(assets.has("/ps/"));
    assert(assets.has("/assets/main.js"));
    assert(!assets.has("/assets/private.json"));
    assert(productRoute("/ps/create"));
    assert(productRoute("/ps/item/" + "a".repeat(64) + "/" + "b".repeat(96)));
    for (const p of [
      "/ps/../issuer",
      "/ps/item/wrong",
      "/api",
      "/client/",
      "/ps-evil",
    ])
      assert(!productRoute(p));
    symlinkSync(join(root, "index.html"), join(root, "assets", "secret.js"));
    assert.throws(() => productAssets(root), /symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("product interface stays absent from ordinary lab mode and does not relax issuer admission", async () => {
  const server = await startBrowserLab();
  try {
    assert.equal((await fetch(server.origin + "/ps/")).status, 404);
    assert.equal(
      (
        await fetch(server.origin + "/issuer", {
          method: "POST",
          body: '{"action":"bootstrap"}',
        })
      ).status,
      403,
    );
  } finally {
    await server.close();
  }
});
