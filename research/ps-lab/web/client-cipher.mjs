// Separate working-journal format. Existing portable vault files stay unchanged.
import assert from "./runtime.mjs";
import * as p from "./profile.mjs";
import { derive } from "./vault.mjs";
export const FORMAT = "zft-ps-browser-client-state-v1";
export const MAX_CLEAR = 1048576,
  MAX_FILE = MAX_CLEAR * 2 + 4096;
export function header(wire, pinned, id) {
  p.bytes(id, 16);
  const v = p.parse(wire, MAX_FILE);
  p.fields(v, "format kdf cipher client_id manifest salt iv ciphertext tag");
  assert.equal(v.format, FORMAT);
  assert.equal(v.kdf, "scrypt-n32768-r8-p1");
  assert.equal(v.cipher, "aes-256-gcm");
  assert.equal(v.client_id, id, "pinned client");
  assert.equal(
    p.canonical(v.manifest),
    p.canonical(pinned.manifest),
    "pinned manifest",
  );
  p.bytes(v.salt, 16);
  p.bytes(v.iv, 12);
  p.bytes(v.tag, 16);
  assert(
    typeof v.ciphertext === "string" && v.ciphertext.length <= MAX_CLEAR * 2,
  );
  p.bytes(v.ciphertext);
  return v;
}
export async function sealState(state, password) {
  const clear = p.utf8(p.canonical(state));
  assert(clear.length <= MAX_CLEAR, "journal size");
  const h = {
    format: FORMAT,
    kdf: "scrypt-n32768-r8-p1",
    cipher: "aes-256-gcm",
    client_id: state.client_id,
    manifest: state.manifest,
    salt: p.randomHex(16),
    iv: p.randomHex(12),
  };
  let key;
  try {
    key = await derive(password, p.bytes(h.salt, 16));
    const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
      "encrypt",
    ]);
    const out = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: p.bytes(h.iv),
          additionalData: p.utf8(p.canonical(h)),
          tagLength: 128,
        },
        k,
        clear,
      ),
    );
    return p.canonical({
      ...h,
      ciphertext: p.hex(out.subarray(0, -16)),
      tag: p.hex(out.subarray(-16)),
    });
  } finally {
    clear.fill(0);
    key?.fill(0);
  }
}
export async function openState(wire, password, manifest, id) {
  const v = header(wire, p.trust(manifest), id),
    { ciphertext, tag, ...h } = v;
  let key, clear;
  try {
    key = await derive(password, p.bytes(h.salt, 16));
    const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
      "decrypt",
    ]);
    clear = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: p.bytes(h.iv),
          additionalData: p.utf8(p.canonical(h)),
          tagLength: 128,
        },
        k,
        p.bytes(ciphertext + tag),
      ),
    );
    return p.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(clear),
      MAX_CLEAR,
    );
  } finally {
    clear?.fill(0);
    key?.fill(0);
  }
}
