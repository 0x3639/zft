// Public test wrapping key and disposable configuration only.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { secrets, realm } from "./test-support.mjs";
import * as p from "./profile.mjs";
import { KEY_RESPONSE } from "./key-envelope.mjs";
export { secrets };
export const config = Object.freeze({
  manifest: p.manifest(realm, secrets),
  configurationId: "75".repeat(32),
  keyId: "public-test/key-file-v1",
});
export function transport(request) {
  const key = Buffer.alloc(32, 9),
    context = Buffer.from(request.context);
  let material;
  if (request.operation === "wrap") {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(context);
    material = Buffer.concat([
      iv,
      cipher.update(request.material),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  } else {
    const bytes = Buffer.from(request.material),
      cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAAD(context);
    cipher.setAuthTag(bytes.subarray(-16));
    material = Buffer.concat([
      cipher.update(bytes.subarray(12, -16)),
      cipher.final(),
    ]);
  }
  return {
    format: KEY_RESPONSE,
    operation: request.operation,
    key_id: request.key_id,
    material,
  };
}
