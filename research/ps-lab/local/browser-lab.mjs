// Disposable Node-backed browser console. Public fixture keys; never real assets.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Issuer } from "./issuer.mjs";
import { Client } from "./client.mjs";
import * as p from "./profile.mjs";
import { LocalVault, recordId, MAX_FILE } from "./vault.mjs";
import {
  importImage,
  exportImage,
  prepareImageIssue,
  prepareImageClaim,
} from "./image.mjs";
const fixtures = JSON.parse(
  readFileSync(new URL("./image-fixtures.json", import.meta.url)),
).images;
const vectors = JSON.parse(
  readFileSync(new URL("../vectors.json", import.meta.url)),
);
export const ACTORS = ["alice", "bob", "restored"];
export const MAX_OPERATIONS = 24;
export const MAX_BACKUPS = 4;
export const MAX_BODY = MAX_FILE + 8192;
function download(name, mime, data) {
  return { name, mime, base64: Buffer.from(data).toString("base64") };
}
function png(base64) {
  assert(typeof base64 === "string" && base64.length <= 92860, "PNG size");
  const data = Buffer.from(base64, "base64");
  assert.equal(data.toString("base64"), base64, "PNG encoding");
  return data;
}
export class BrowserLab {
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "zft-browser-lab-"));
    this.clients = new Map();
    this.operations = new Map();
    this.backups = new Map();
    this.closed = false;
    try {
      this.issuer = new Issuer(
        join(this.dir, "issuer.db"),
        p.randomHex(32),
        Object.fromEntries(
          ["x", "yh", "ys"].map((k) => [k, vectors.test_secrets[k]]),
        ),
      );
      this.manifest = this.issuer.pinned.manifest;
      for (const actor of ACTORS)
        this.clients.set(
          actor,
          new Client(join(this.dir, actor + ".db"), this.manifest),
        );
    } catch (error) {
      this.close();
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.clients.values()) c.close();
    this.issuer?.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
  client(actor) {
    assert(this.clients.has(actor), "lab actor");
    return this.clients.get(actor);
  }
  operation(actor, digest) {
    p.bytes(digest, 32);
    const op = this.operations.get(actor + ":" + digest);
    assert(op, "known operation for actor");
    return op;
  }
  remember(actor, digest, kind) {
    this.operations.set(actor + ":" + digest, { actor, digest, kind });
    return {
      focus: { actor, digest },
      message:
        "Prepared. Download encrypted recovery, then reselect that file before submitting.",
    };
  }
  state() {
    return {
      realm: this.manifest.realm,
      operations: [...this.operations.values()].map((op) => {
        const row = this.client(op.actor).pending(op.digest);
        return {
          ...op,
          acknowledged: row.acknowledged === 1,
          complete: row.response !== null,
        };
      }),
      credentials: ACTORS.flatMap((actor) =>
        this.client(actor)
          .db.prepare("SELECT id,spent FROM credentials")
          .all()
          .map((row) => ({ actor, id: row.id, locallySpent: row.spent === 1 })),
      ),
      backups: [...this.backups].map(([id, b]) => ({
        id,
        actor: b.actor,
        digest: b.digest,
        kind: b.kind,
      })),
      fixtures: fixtures.map((f, index) => ({
        index,
        width: f.width,
        height: f.height,
        base64: Buffer.from(f.pngHex, "hex").toString("base64"),
      })),
      counts: this.issuer.counts(),
    };
  }
  dispatch(input) {
    assert(!this.closed, "closed lab");
    const schemas = {
      state: "action",
      mint: "action actor fixture",
      claim: "action actor file",
      cancel: "action actor credential",
      backup: "action actor digest password",
      acknowledge: "action actor digest backup file password",
      submit: "action actor digest loseResponse",
      recover: "action actor digest",
      restore: "action backup file password",
      export: "action actor credential public",
      saveBearer: "action actor credential password",
      claimVault: "action actor backup file password",
    };
    assert(Object.hasOwn(schemas, input.action), "known lab action");
    p.fields(input, schemas[input.action]);
    const a = input.action;
    if (a === "state") return { state: this.state() };
    let result = {};
    if (["mint", "claim", "cancel", "restore", "claimVault"].includes(a))
      assert(
        this.operations.size < MAX_OPERATIONS,
        "lab operation limit; restart for a fresh disposable realm",
      );
    const c = input.actor === undefined ? null : this.client(input.actor);
    if (a === "mint") {
      assert(
        Number.isInteger(input.fixture) && fixtures[input.fixture],
        "test fixture",
      );
      result = this.remember(
        input.actor,
        prepareImageIssue(
          c,
          this.issuer.session("issue"),
          Buffer.from(fixtures[input.fixture].pngHex, "hex"),
        ),
        "mint",
      );
    } else if (a === "claim") {
      const file = png(input.file);
      importImage(file, this.manifest); // Validate before creating a session or pending row.
      result = this.remember(
        input.actor,
        prepareImageClaim(c, this.issuer.session("swap"), file),
        "claim",
      );
    } else if (a === "cancel") {
      c.export(input.credential); // Validate before session creation.
      result = this.remember(
        input.actor,
        c.prepareCancel(this.issuer.session("swap"), input.credential),
        "cancel",
      );
    } else if (a === "backup" || a === "saveBearer") {
      const kind = a === "backup" ? "recovery" : "bearer";
      if (a === "backup") this.operation(input.actor, input.digest);
      const source = a === "backup" ? input.digest : input.credential;
      assert(
        [...this.backups.values()].filter(
          (b) => b.actor === input.actor && b.digest === source,
        ).length < MAX_BACKUPS,
        "backup export limit",
      );
      const vault = new LocalVault(this.manifest);
      try {
        const id = vault.add(
          kind,
          a === "backup" ? c.backup(source) : c.export(source),
        );
        const wire = vault.seal(input.password);
        this.backups.set(vault.id, {
          actor: input.actor,
          digest: source,
          kind,
          record: id,
        });
        result.download = download(
          `ps-${kind}-${vault.id}.json`,
          "application/json",
          wire,
        );
        result.message =
          "Save this encrypted file. A download click does not prove it was saved; reselect it to continue.";
      } finally {
        vault.lock();
      }
    } else if (["acknowledge", "restore", "claimVault"].includes(a)) {
      p.bytes(input.backup, 16);
      const known = this.backups.get(input.backup);
      assert(known, "backup identity pinned in this running lab");
      assert.equal(
        known.kind,
        a === "claimVault" ? "bearer" : "recovery",
        "backup purpose",
      );
      if (a === "acknowledge") {
        this.operation(input.actor, input.digest);
        assert.equal(known.actor, input.actor, "backup actor");
        assert.equal(known.digest, input.digest, "backup operation");
      }
      const opened = LocalVault.open(
        input.file,
        input.password,
        this.manifest,
        input.backup,
      );
      try {
        const record = opened.read(known.record);
        assert.equal(record.kind, known.kind);
        if (a === "acknowledge") {
          assert.equal(
            record.wire,
            c.backup(input.digest),
            "exact reselected recovery",
          );
          c.acknowledge(input.digest, p.hash(record.wire));
          result.message =
            "Reselected encrypted recovery verified. Submission is enabled.";
        } else if (a === "restore") {
          assert.equal(recordId("recovery", record.wire), known.record);
          const digest = this.client("restored").restore(record.wire);
          result = this.remember("restored", digest, "restore");
          result.message =
            "Restored into the third client. Recover the original response; do not create a new request.";
        } else {
          result = this.remember(
            input.actor,
            c.prepareClaim(this.issuer.session("swap"), record.wire),
            "claim",
          );
        }
      } finally {
        opened.lock();
      }
    } else if (a === "submit" || a === "recover") {
      this.operation(input.actor, input.digest);
      if (a === "submit") {
        assert.equal(typeof input.loseResponse, "boolean");
        let lost = false;
        try {
          c.submit(
            input.digest,
            input.loseResponse
              ? {
                  submit: (wire, capability) => {
                    this.issuer.submit(wire, capability);
                    lost = true;
                    throw new Error("simulated lost return");
                  },
                }
              : this.issuer,
          );
        } catch (error) {
          if (!lost) throw error;
        }
        result.message = lost
          ? "Issuer committed; return deliberately lost. Keep recovery and recover the same request."
          : "Verified replacement saved in the local client.";
      } else {
        c.recover(input.digest, this.issuer);
        result.message = "Exact committed response recovered and verified.";
      }
    } else if (a === "export") {
      assert.equal(typeof input.public, "boolean");
      const envelope = c.export(input.credential);
      const data = input.public
        ? p.bytes(p.importBearer(envelope, c.pinned).asset)
        : exportImage(envelope, this.manifest);
      result.download = download(
        input.public ? "ps-public.png" : "ps-private-bearer.png",
        "image/png",
        data,
      );
      result.message = input.public
        ? "Public image contains only the original image bytes."
        : "Private bearer file: anyone with this copy can compete to claim it.";
    }
    return { ...result, state: this.state() };
  }
}
