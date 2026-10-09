// Fixed publicly known test key only. No provider or production status key.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { stateManifest } from "../local/state.mjs";
import { SIGN_RESPONSE } from "../local/status-signer.mjs";
import { config } from "./test-support.mjs";
import * as p from "../local/profile.mjs";
const key = createPrivateKey({
  key: Buffer.from("302e020100300506032b657004220420" + "05".repeat(32), "hex"),
  type: "pkcs8",
  format: "der",
});
const publicKey = createPublicKey(key)
  .export({ type: "spki", format: "der" })
  .subarray(-32)
  .toString("hex");
export const statusConfig = {
  manifest: stateManifest(config.manifest, publicKey),
  keyId: "public-test/status-v1",
  transport: (request) =>
    p.canonical({
      format: SIGN_RESPONSE,
      key_id: request.key_id,
      algorithm: "Ed25519",
      message_type: "RAW",
      signature: sign(null, request.message, key).toString("hex"),
    }),
};
