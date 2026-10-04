import { normalizeImage } from "../../../packages/file-codec";
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const result = await normalizeImage(new Uint8Array(event.data));
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Could not read this image.",
    });
  }
};
