// Provider-neutral PS execution boundary. Internal consistency evidence is never a credential field.
import assert from "node:assert/strict";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import * as p from "../local/profile.mjs";
import { AsyncBoundary, failure } from "./boundary.mjs";
export const EXECUTE_REQUEST = "zft-ps-execute-request-v1",
  EXECUTE_RESPONSE = "zft-ps-execute-response-v1";
const fail = (c) => failure("EXECUTOR", c);
function pairing(pairs) {
  const nonzero = pairs
    .filter(([g1, g2]) => !g1.is0() && !g2.is0())
    .map(([g1, g2]) => ({ g1, g2 }));
  assert(
    bls.fields.Fp12.eql(bls.pairingBatch(nonzero), bls.fields.Fp12.ONE),
    "execution equation",
  );
}
/** Verify bounded remote execution results against the existing request and public parameters. */
export class PsExecutor {
  #pinned;
  #configuration;
  #transport;
  #gate;
  constructor(config) {
    try {
      const { manifest, configurationId, transport, timeoutMs = 5000 } = config;
      this.#pinned = p.trust(manifest);
      p.bytes(configurationId, 32);
      if (typeof transport !== "function") throw fail("CONFIG");
      this.#configuration = configurationId;
      this.#transport = transport;
      this.#gate = new AsyncBoundary("EXECUTOR", timeoutMs);
    } catch {
      throw fail("CONFIG");
    }
  }
  #run(operation, input, accept, signal) {
    const request = Object.freeze({
      format: EXECUTE_REQUEST,
      operation,
      configuration_id: this.#configuration,
      manifest_hash: p.hash(p.canonical(this.#pinned.manifest)),
      input: p.canonical(input),
    });
    return this.#gate.run(
      (s) => this.#transport(request, Object.freeze({ signal: s })),
      (wire) => {
        const v = p.parse(wire, 32768);
        p.fields(v, "format operation configuration_id manifest_hash result");
        for (const k of ["operation", "configuration_id", "manifest_hash"])
          assert.equal(v[k], request[k]);
        assert.equal(v.format, EXECUTE_RESPONSE);
        return accept(v.result);
      },
      signal,
    );
  }
  async session(header, { signal } = {}) {
    this.#gate.check(signal);
    let expected;
    try {
      expected = p.parse(p.canonical(header), 1024);
      p.fields(expected, "protocol realm keyset_id kind session expires");
      p.scope(expected, this.#pinned);
      p.bytes(expected.session, 16);
      if (
        !["issue", "swap"].includes(expected.kind) ||
        !Number.isSafeInteger(expected.expires) ||
        expected.expires <= 0
      )
        throw fail("INPUT");
    } catch {
      throw fail("INPUT");
    }
    return this.#run(
      "session",
      expected,
      (result) => {
        p.fields(result, "wire protected");
        const s = p.parse(result.wire, 2048);
        p.session(s, this.#pinned);
        for (const k of Object.keys(expected)) assert.equal(s[k], expected[k]);
        const record = p.parse(result.protected, 17408);
        p.fields(record, "scope wrapped_key iv ciphertext tag");
        assert.equal(record.scope.purpose, "session");
        assert.equal(record.scope.record_id, p.hash(result.wire));
        assert.equal(record.scope.configuration_id, this.#configuration);
        assert.equal(
          p.canonical(record.scope.manifest),
          p.canonical(this.#pinned.manifest),
        );
        return Object.freeze({
          wire: result.wire,
          protected: result.protected,
        });
      },
      signal,
    );
  }
  async respond(wire, session, { signal } = {}) {
    this.#gate.check(signal);
    let r, s;
    try {
      r = p.request(wire, this.#pinned).r;
      s = p.parse(p.canonical(session), 20000);
      p.fields(s, "wire protected");
      const header = p.parse(s.wire, 2048);
      p.session(header, this.#pinned);
      for (const k of Object.keys(header)) assert.equal(header[k], r[k]);
      p.parse(s.protected, 17408);
    } catch {
      throw fail("INPUT");
    }
    const digest = p.hash(wire);
    return this.#run(
      "respond",
      { wire, session: s },
      (result) => {
        p.fields(result, "response k2 ys_k2");
        const v = p.parse(result.response, 2048);
        p.fields(v, "protocol realm keyset_id digest u v");
        p.scope(v, this.#pinned);
        assert.equal(v.digest, digest);
        assert.equal(v.u, r.u);
        const U = p.point(r.u),
          K2 = p.point(result.k2, 2),
          YsK2 = p.point(result.ys_k2, 2);
        // K2=kG2 and YsK2=kYs2 must have the same k as the original U=kG1.
        pairing([
          [U, p.G2],
          [p.G1.negate(), K2],
        ]);
        pairing([
          [U, this.#pinned.pk.Ys2],
          [p.G1.negate(), YsK2],
        ]);
        // Direct rearrangement of the unchanged issueResponse formulas, before durable spend.
        pairing([
          [p.point(v.v), p.G2],
          [U.negate(), this.#pinned.pk.X2],
          [
            p.point(r.b, 1, true).negate(),
            r.kind === "issue" ? K2 : this.#pinned.pk.Yh2,
          ],
          [p.point(r.s).negate(), YsK2],
        ]);
        return result.response;
      },
      signal,
    );
  }
  close() {
    this.#gate.close();
  }
}
