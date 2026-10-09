// Explicitly unqualified local reference driver. Never a default production provider.
import assert from "node:assert/strict";
import * as p from "../local/profile.mjs";
import { PsKeyFile } from "../local/key-file.mjs";
import { ProtectedRecord } from "./protected-record.mjs";
import { EXECUTE_REQUEST, EXECUTE_RESPONSE } from "./executor.mjs";
import { wipe } from "./boundary.mjs";

/** Load a selected encrypted PS key file; return a trusted driver for disposable/local qualification. */
export async function loadReferenceCustody(directory, digest, config) {
  const file = new PsKeyFile(directory, config);
  let secrets;
  try {
    secrets = await file.open(digest);
  } finally {
    file.close();
  }
  const pinned = p.trust(config.manifest),
    manifestHash = p.hash(p.canonical(pinned.manifest));
  let closed = false;
  const transport = async (request, { signal } = {}) => {
    assert(!closed, "reference custody closed");
    p.fields(request, "format operation configuration_id manifest_hash input");
    assert.equal(request.format, EXECUTE_REQUEST);
    assert.equal(request.configuration_id, config.configurationId);
    assert.equal(request.manifest_hash, manifestHash);
    let result;
    if (request.operation === "session") {
      const header = p.parse(request.input, 1024);
      p.fields(header, "protocol realm keyset_id kind session expires");
      p.scope(header, pinned);
      const k = p.randomScalar(),
        wire = p.canonical({ ...header, u: p.encodedPoint(p.mul(p.G1, k)) });
      p.session(p.parse(wire), pinned);
      const record = new ProtectedRecord({
        ...config,
        purpose: "session",
        recordId: p.hash(wire),
      });
      const bytes = p.bytes(p.scalarHex(k), 32);
      try {
        const protectedWire = await record.seal(bytes, { signal });
        const opened = await record.open(protectedWire, { signal });
        try {
          assert.equal(p.hex(opened), p.hex(bytes));
        } finally {
          wipe(opened);
        }
        result = { wire, protected: protectedWire };
      } finally {
        wipe(bytes);
        record.close();
      }
    } else {
      assert.equal(request.operation, "respond");
      const input = p.parse(request.input, 24576);
      p.fields(input, "wire session");
      p.fields(input.session, "wire protected");
      const r = p.request(input.wire, pinned).r,
        header = p.parse(input.session.wire, 2048);
      p.session(header, pinned);
      for (const key of Object.keys(header)) assert.equal(header[key], r[key]);
      const record = new ProtectedRecord({
        ...config,
        purpose: "session",
        recordId: p.hash(input.session.wire),
      });
      let bytes;
      try {
        bytes = await record.open(input.session.protected, { signal });
        const kHex = p.hex(bytes),
          k = p.scalar(kHex, true);
        assert.equal(p.encodedPoint(p.mul(p.G1, k)), header.u);
        result = {
          response: p.issueResponse(r, p.hash(input.wire), kHex, secrets),
          k2: p.encodedPoint(p.mul(p.G2, k)),
          ys_k2: p.encodedPoint(p.mul(pinned.pk.Ys2, k)),
        };
      } finally {
        wipe(bytes);
        record.close();
      }
    }
    assert(!closed, "reference custody closed");
    return p.canonical({
      format: EXECUTE_RESPONSE,
      operation: request.operation,
      configuration_id: request.configuration_id,
      manifest_hash: request.manifest_hash,
      result,
    });
  };
  return Object.freeze({
    transport,
    close() {
      closed = true;
      secrets = null;
    },
  });
}
