// Disposable, original image-file walkthrough. Never logs or retains bearer secrets.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Issuer } from "./issuer.mjs";
import { Client } from "./client.mjs";
import * as p from "./profile.mjs";
import {
  exportImage,
  importImage,
  publicImage,
  prepareImageIssue,
  prepareImageClaim,
} from "./image.mjs";
const v = JSON.parse(
  readFileSync(new URL("../vectors.json", import.meta.url), "utf8"),
);
const secrets = Object.fromEntries(
  ["x", "yh", "ys"].map((k) => [k, v.test_secrets[k]]),
);
const pixels = JSON.parse(
  readFileSync(new URL("./image-fixtures.json", import.meta.url), "utf8"),
).images[1];
const image = Buffer.from(pixels.pngHex, "hex"),
  dir = mkdtempSync(join(tmpdir(), "zft PS image ü # ")),
  opened = [];
try {
  const issuer = new Issuer(join(dir, "issuer.db"), "71".repeat(32), secrets);
  opened.push(issuer);
  const client = (name) => {
    const c = new Client(join(dir, name + ".db"), issuer.pinned.manifest);
    opened.push(c);
    return c;
  };
  const alice = client("alice"),
    bob = client("bob"),
    restored = client("restored");
  const save = (name, data) => {
    const path = join(dir, name);
    writeFileSync(path, data, { mode: 0o600, flag: "wx" });
    return readFileSync(path);
  };
  const backup = (c, d, name) => {
    const b = save(name, c.backup(d)).toString("utf8");
    c.acknowledge(d, p.hash(b));
    return b;
  };
  const mint = prepareImageIssue(alice, issuer.session("issue"), image);
  backup(alice, mint, "mint-recovery.json");
  const first = alice.submit(mint, issuer),
    manifest = issuer.pinned.manifest;
  const file = save("bearer.png", exportImage(alice.export(first), manifest));
  assert.deepEqual(importImage(file, manifest).image, image);
  const claim = prepareImageClaim(bob, issuer.session("swap"), file),
    saved = backup(bob, claim, "claim-recovery.json");
  const pending = p.parse(saved, 300000);
  issuer.submit(pending.wire, pending.capability);
  restored.restore(readFileSync(join(dir, "claim-recovery.json"), "utf8"));
  const claimed = restored.recover(claim, issuer);
  const next = save(
    "claimed.png",
    exportImage(restored.export(claimed), manifest),
  );
  const cancel = restored.prepareCancel(issuer.session("swap"), claimed);
  backup(restored, cancel, "cancel-recovery.json");
  const last = restored.submit(cancel, issuer),
    finalFile = exportImage(restored.export(last), manifest);
  for (const stale of [file, next]) {
    const d = prepareImageClaim(bob, issuer.session("swap"), stale);
    bob.acknowledge(d, p.hash(bob.backup(d)));
    assert.throws(() => bob.submit(d, issuer), /already spent/);
  }
  const clean = save("public.png", publicImage(finalFile, manifest));
  assert.deepEqual(clean, image);
  console.log(
    JSON.stringify(
      {
        scope:
          "local research; public test issuer keys; plaintext disposable files; no network or wallet authentication",
        imageFileRoundtrip: true,
        lostResponseRecoveredFromFile: true,
        cancellation: true,
        staleCopiesRejected: true,
        publicImageExact: true,
        imageSha256: p.hash(clean),
        operations: issuer.counts().operations,
      },
      null,
      2,
    ),
  );
} finally {
  for (const c of opened) c.close();
  rmSync(dir, { recursive: true, force: true });
}
