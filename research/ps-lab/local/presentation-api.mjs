// Disposable public presentation service. No credentials or wallet sessions saved.
import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import * as p from "./profile.mjs";
import { durablePublic } from "./persistent-public.mjs";
import { StateIssuer, StateObserver, stateManifest } from "./state.mjs";
import {
  presentationAudience,
  verifyPresentation,
  PRESENTATION_LIMIT,
} from "./presentation.mjs";
export const MAX_PRESENTATION_BODY = PRESENTATION_LIMIT + 16384;
export class PresentationApi {
  constructor(
    issuer,
    path,
    origin,
    {
      now = () => Math.floor(Date.now() / 1000),
      privateKey = generateKeyPairSync("ed25519").privateKey,
      durable = false,
    } = {},
  ) {
    this.ps = issuer.pinned.manifest;
    this.origin = origin;
    this.now = now;
    this.requests = new Map();
    this.records = new Map();
    const raw = createPublicKey(privateKey)
      .export({ type: "spki", format: "der" })
      .subarray(-32)
      .toString("hex");
    this.status = stateManifest(this.ps, raw);
    this.observer = new StateObserver(path, this.ps, this.status, { now });
    try {
      this.signer = new StateIssuer(issuer, this.status, privateKey, { now });
      if (durable) Object.assign(this, durablePublic(this.observer));
    } catch (e) {
      this.observer.close();
      throw e;
    }
  }
  close() {
    this.observer.close();
  }
  async validateRecords() {
    assert(
      this.requests.size <= 64 && this.records.size <= 64,
      "public store cap",
    );
    for (const [id, r] of this.records.entries()) {
      p.bytes(id, 32);
      assert.equal(p.hash(r.wire), id, "stored publication hash");
      assert(
        Number.isSafeInteger(r.publishedAt) && r.publishedAt >= 0,
        "publication time",
      );
      await verifyPresentation(
        r.wire,
        this.ps,
        this.status,
        this.origin,
        this.now(),
      );
      const v = p.parse(r.wire, PRESENTATION_LIMIT),
        known = this.requests.get(v.context.challenge);
      assert(
        known &&
          known.receipt === v.receipt &&
          known.showing === v.showing &&
          known.chain_id === v.chain_id,
        "stored publication observation",
      );
    }
  }

  pins() {
    return {
      psManifest: this.ps,
      statusManifest: this.status,
      origin: this.origin,
    };
  }
  read(id) {
    p.bytes(id, 32);
    return this.records.get(id) ?? null;
  }
  async dispatch(input) {
    const schema = {
      bootstrap: "action",
      prepare: "action wallet h chain_id",
      observe: "action challenge showing",
      publish: "action wire",
    };
    assert(Object.hasOwn(schema, input.action), "presentation action");
    p.fields(input, schema[input.action]);
    if (input.action === "bootstrap") return this.pins();
    if (input.action === "prepare") {
      assert(this.requests.size < 64, "presentation request cap");
      p.bytes(input.wallet, 20);
      assert(
        (input.chain_id === 0) === (input.wallet === "00".repeat(20)),
        "anonymous wallet scope",
      );
      const context = this.observer.prepare(
        input.wallet,
        input.h,
        presentationAudience(this.origin, input.chain_id),
      );
      this.requests.set(context.challenge, {
        context,
        chain_id: input.chain_id,
        showing: null,
        receipt: null,
      });
      return { context };
    }
    if (input.action === "observe") {
      p.bytes(input.challenge, 32);
      const row = this.requests.get(input.challenge);
      assert(row, "unknown public challenge");
      if (row.receipt) {
        assert.equal(input.showing, row.showing, "public replay mismatch");
        return { receipt: row.receipt };
      }
      const wire = this.observer.request(input.challenge, input.showing);
      const receipt = this.signer.observe(wire);
      this.observer.accept(input.challenge, receipt);
      row.showing = input.showing;
      row.receipt = receipt;
      return { receipt };
    }
    const value = p.parse(input.wire, PRESENTATION_LIMIT),
      id = p.hash(input.wire);
    const report = await verifyPresentation(
      input.wire,
      this.ps,
      this.status,
      this.origin,
      this.now(),
      { requireFresh: true },
    );
    const known = this.requests.get(value.context.challenge);
    assert(
      known &&
        known.receipt === value.receipt &&
        known.showing === value.showing &&
        known.chain_id === value.chain_id,
      "issued public context",
    );
    if (!this.records.has(id)) {
      assert(this.records.size < 64, "publication cap");
      this.records.set(
        id,
        Object.freeze({ wire: input.wire, publishedAt: this.now() }),
      );
    }
    return { id, report };
  }
}
