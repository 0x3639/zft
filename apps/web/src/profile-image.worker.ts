import { decode } from "fast-png";
import { normalizeImage } from "../../../packages/file-codec";
import {
  cropProfileImage,
  type Crop,
} from "../../../packages/file-codec/profile-crop";
import type { MediaKind } from "../../../packages/protocol/profile-media";
let source: ReturnType<typeof decode> | undefined;
self.onmessage = async (
  event: MessageEvent<{ bytes?: ArrayBuffer; kind: MediaKind; crop?: Crop }>,
) => {
  try {
    if (event.data.bytes) {
      const normalized = await normalizeImage(new Uint8Array(event.data.bytes));
      source = decode(normalized.bytes);
      self.postMessage({ loaded: normalized });
    } else if (source && event.data.crop) {
      self.postMessage({
        cropped: cropProfileImage(source, event.data.kind, event.data.crop),
      });
    }
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Could not read image.",
    });
  }
};
