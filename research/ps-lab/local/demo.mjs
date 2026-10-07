// Ephemeral public-test-key walkthrough. Logs outcomes only, never bearer material.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Issuer } from "./issuer.mjs";
import { Client } from "./client.mjs";
import { utf8, hash, parse, assetValue } from "./profile.mjs";
const f = JSON.parse(
  readFileSync(new URL("../vectors.json", import.meta.url), "utf8"),
);
const secrets = Object.fromEntries(
  ["x", "yh", "ys"].map((k) => [k, f.test_secrets[k]]),
);
const dir = mkdtempSync(join(tmpdir(), "zft-ps-demo-")),
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
  const ack = (c, d) => c.acknowledge(d, hash(c.backup(d))),
    asset = utf8("PUBLIC LOCAL LAB ASSET");
  const mint = alice.prepareIssue(issuer.session("issue"), asset);
  ack(alice, mint);
  const first = alice.submit(mint, issuer);
  const file = alice.export(first),
    claim = bob.prepareClaim(issuer.session("swap"), file);
  ack(bob, claim);
  // Commit at the issuer, then deliberately discard the response.
  const pending = parse(bob.backup(claim), 300000);
  issuer.submit(pending.wire, pending.capability);
  restored.restore(bob.backup(claim));
  const second = restored.recover(claim, issuer);
  const stale = alice.prepareClaim(issuer.session("swap"), file);
  ack(alice, stale);
  assert.throws(() => alice.submit(stale, issuer), /already spent/);
  const cancel = restored.prepareCancel(issuer.session("swap"), second);
  ack(restored, cancel);
  const third = restored.submit(cancel, issuer);
  const wallet = "42".repeat(20),
    nonce = "31".repeat(32);
  const state = issuer.checkShowing(
    restored.show(third, wallet, nonce),
    wallet,
    nonce,
    assetValue(asset, issuer.pinned),
  );
  assert.equal(state.state, "unspent");
  console.log(
    JSON.stringify(
      {
        scope:
          "local research; public test issuer keys; no network or wallet authentication",
        issue: true,
        export: true,
        claimRecoveryInThirdStore: true,
        staleCopyRejected: true,
        cancel: true,
        showing: state.state,
        walletAuthenticated: state.walletAuthenticated,
        operations: issuer.counts().operations,
      },
      null,
      2,
    ),
  );
} finally {
  for (const item of opened) item.close();
  rmSync(dir, { recursive: true, force: true });
}
