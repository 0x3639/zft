import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBrowserLab } from "./browser-server.mjs";
import { showingChallenge } from "./state.mjs";
import { PRESENTATION, verifyPresentation } from "./presentation.mjs";
import * as p from "./profile.mjs";
const image = p.bytes(
  JSON.parse(readFileSync(new URL("./image-fixtures.json", import.meta.url)))
    .images[0].pngHex,
);
test("product HTTP publishes only verified public bytes with bounded metadata and capability admission", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zft-public-http-"));
  let server;
  try {
    mkdirSync(join(dir, "assets"));
    writeFileSync(
      join(dir, "index.html"),
      "<html><head><title>ZFT</title></head><body></body></html>",
    );
    server = await startBrowserLab({ product: true, productRoot: dir });
    const call = (body, changes = {}) =>
      fetch(server.origin + "/presentation", {
        method: "POST",
        headers: {
          Origin: server.origin,
          Authorization: "Bearer " + server.token,
          "Content-Type": "application/json",
          ...changes,
        },
        body: p.canonical(body),
      });
    assert.equal(
      (await call({ action: "bootstrap" }, { Origin: "https://other.invalid" }))
        .status,
      403,
    );
    assert.equal(
      (
        await call(
          { action: "bootstrap" },
          { Authorization: "Bearer " + "00".repeat(32) },
        )
      ).status,
      403,
    );
    const pins = await (await call({ action: "bootstrap" })).json();
    assert.deepEqual(
      await (await fetch(server.origin + "/ps/trust.json")).json(),
      pins,
    );
    assert.equal(
      (
        await call({
          action: "prepare",
          wallet: "00".repeat(20),
          chain_id: 0,
          h: "00".repeat(32),
          password: "never",
        })
      ).status,
      400,
    );
    const a = server.lab.client("alice"),
      issuer = server.lab.issuer,
      d = a.prepareIssue(issuer.session("issue"), image);
    a.acknowledge(d, p.hash(a.backup(d)));
    const id = a.submit(d, issuer);
    const { context } = await (
      await call({
        action: "prepare",
        wallet: "00".repeat(20),
        chain_id: 0,
        h: p.assetValue(image, a.pinned),
      })
    ).json();
    const showing = a.show(id, context.wallet, showingChallenge(context));
    const { receipt } = await (
      await call({ action: "observe", challenge: context.challenge, showing })
    ).json();
    const wire = p.canonical({
      format: PRESENTATION,
      origin: server.origin,
      chain_id: 0,
      context,
      showing,
      receipt,
      image: p.hex(image),
      image_sha256: p.hash(image),
      wallet_signature: null,
    });
    const pub = await call({ action: "publish", wire });
    assert.equal(pub.status, 200);
    const result = await pub.json();
    const response = await fetch(server.origin + "/ps/evidence/" + result.id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const saved = await response.json();
    assert.equal(saved.wire, wire);
    assert.deepEqual(Object.keys(saved).sort(), ["publishedAt", "wire"]);
    assert.equal(
      (
        await verifyPresentation(
          saved.wire,
          pins.psManifest,
          pins.statusManifest,
          server.origin,
          Math.floor(Date.now() / 1000),
        )
      ).walletSigningKeyValid,
      false,
    );
    const art = await fetch(server.origin + "/ps/art/" + result.id + ".png");
    assert.deepEqual(Buffer.from(await art.arrayBuffer()), Buffer.from(image));
    const page = await (
      await fetch(server.origin + "/ps/proof/" + result.id)
    ).text();
    assert(page.includes("og:image"));
    assert(page.includes("not a spend reservation"));
    assert(!page.includes(server.token));
    assert(!page.includes("secret"));
    assert.equal(
      (await fetch(server.origin + "/ps/evidence/" + result.id + "?other=1"))
        .status,
      404,
    );
    assert.equal(
      (await fetch(server.origin + "/ps/art/" + result.id)).status,
      404,
    );
    assert.equal(
      (await fetch(server.origin + "/ps/proof/" + "00".repeat(32))).status,
      404,
    );
    assert.equal(
      (await call({ action: "publish", wire: "x".repeat(170000) })).status,
      400,
    );
  } finally {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
