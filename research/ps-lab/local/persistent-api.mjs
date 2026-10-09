import assert from "node:assert/strict";
import { BrowserIssuer } from "./browser-client-api.mjs";
import { LIMITS } from "./persistent.mjs";
import * as p from "./profile.mjs";
// The exclusive process lock makes admission counting and core submit serial.
export class PersistentBrowserIssuer extends BrowserIssuer {
  constructor(lab) {
    super(lab.issuer);
    this.restoreReviewRequired = lab.restoreReviewRequired;
    this.clients = lab.config.clients;
    this.mode = {
      kind: "persistent-local",
      restoreReviewRequired: lab.restoreReviewRequired,
      operationLimit: LIMITS.operations,
      sessionLimit: LIMITS.sessions,
    };
  }
  dispatch(input) {
    const schemas = {
      bootstrap: "action",
      session: "action kind",
      submit: "action wire capability",
      recover: "action digest capability",
    };
    assert(Object.hasOwn(schemas, input.action), "issuer action");
    p.fields(input, schemas[input.action]);
    if (input.action === "bootstrap")
      return { ...super.dispatch(input), mode: this.mode };
    if (input.action === "recover")
      return { response: this.issuer.recover(input.digest, input.capability) };
    if (input.action === "submit") {
      assert(
        typeof input.wire === "string" &&
          Buffer.byteLength(input.wire) <= 12288,
        "request bound",
      );
      p.bytes(input.capability, 32);
      // Exact authorized replay remains available at all admission limits.
      const old = this.issuer.recover(p.hash(input.wire), input.capability);
      if (old !== null) return { response: old };
      assert(!this.restoreReviewRequired, "restore review required");
      assert(
        this.issuer.counts().operations < LIMITS.operations,
        "local operation cap",
      );
      return { response: this.issuer.submit(input.wire, input.capability) };
    }
    assert(!this.restoreReviewRequired, "restore review required");
    assert(
      this.issuer.counts().operations < LIMITS.operations,
      "local operation cap",
    );
    assert(
      this.issuer.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n <
        LIMITS.sessions,
      "local session cap",
    );
    return { session: this.issuer.session(input.kind) };
  }
}
