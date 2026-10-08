// The browser-owned client uses only this bounded issuer surface.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as p from "./profile.mjs";
const fixtures = JSON.parse(
  readFileSync(new URL("./image-fixtures.json", import.meta.url)),
).images;
export const MAX_CLIENT_BODY = 16384;
export class BrowserIssuer {
  constructor(issuer) {
    this.issuer = issuer;
    this.clients = Object.fromEntries(
      ["alice", "bob", "restored"].map((k) => [k, p.randomHex(16)]),
    );
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
      return {
        manifest: this.issuer.pinned.manifest,
        clients: this.clients,
        fixtures: fixtures.map((f) => ({
          asset: f.pngHex,
          width: f.width,
          height: f.height,
        })),
      };
    if (input.action === "recover")
      return { response: this.issuer.recover(input.digest, input.capability) };
    // A fixed disposable-lab bound, not hosted admission or resource qualification.
    if (input.action === "submit") {
      assert(
        typeof input.wire === "string" &&
          Buffer.byteLength(input.wire) <= 12288,
        "request bound",
      );
      p.bytes(input.capability, 32);
      if (this.issuer.counts().operations >= 24) {
        const response = this.issuer.recover(
          p.hash(input.wire),
          input.capability,
        );
        assert(response !== null, "lab operation cap");
        return { response };
      }
      return { response: this.issuer.submit(input.wire, input.capability) };
    }
    assert(this.issuer.counts().operations < 24, "lab operation cap");
    assert(["issue", "swap"].includes(input.kind));
    return { session: this.issuer.session(input.kind) };
  }
}
