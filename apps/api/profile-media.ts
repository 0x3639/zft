import { sha256 } from "viem";
import { validatePublicImage, pngChunks } from "../../packages/file-codec";
import {
  PROFILE_MEDIA,
  type MediaKind,
} from "../../packages/protocol/profile-media";
import { unbase64 } from "../../packages/vault";
import { HttpError } from "./http";
import type { Env } from "./types";
import { decode } from "fast-png";

/** Validate size and dimensions before inflating; only canonical pixel chunks
 * are admitted, never transferable envelopes or optional PNG metadata. */
export async function admittedProfileImage(kind: MediaKind, encoded: string) {
  const limits = PROFILE_MEDIA[kind];
  if (
    encoded.length > 4 * Math.ceil(limits.maxBytes / 3) ||
    encoded.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new HttpError(400, "Invalid image encoding.");
  let bytes: Uint8Array;
  try {
    bytes = unbase64(encoded);
    if (bytes.length > limits.maxBytes) throw new Error("Image is too large.");
    const header = pngChunks(bytes)[0].data;
    const view = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength,
    );
    if (
      view.getUint32(0) !== limits.width ||
      view.getUint32(4) !== limits.height
    )
      throw new Error(`Expected ${limits.width} × ${limits.height} pixels.`);
    await validatePublicImage(bytes);
    decode(bytes, { checkCrc: true });
  } catch {
    throw new HttpError(
      400,
      `Choose a valid cropped ${kind} image in the profile editor.`,
    );
  }
  return { bytes, hash: sha256(bytes) };
}

export async function profileMediaResponse(
  env: Env,
  address: string,
  hash: string,
) {
  const object = await env.MEDIA.get(`profile-media/${address}/${hash}.png`);
  if (!object) throw new HttpError(404, "Profile image not found.");
  return new Response(object.body, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
