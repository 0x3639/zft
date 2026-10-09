import { MAX_IMAGE } from "../../../../packages/file-codec";
export type Normalized = {
  bytes: Uint8Array;
  width: number;
  height: number;
  imageHash: string;
};
export async function normalizeArtwork(
  file: File,
  signal: AbortSignal,
): Promise<Normalized> {
  if (!file.size || file.size > MAX_IMAGE)
    throw new Error("Choose a JPG or PNG up to 10 MiB.");
  if (signal.aborted) throw new Error("Locked.");
  const bytes = await file.arrayBuffer();
  if (signal.aborted) throw new Error("Locked.");
  const worker = new Worker(new URL("../image.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      stop();
      reject(new Error("Image preparation stopped."));
    };
    const timer = setTimeout(abort, 30_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      stop();
      reject(new Error("Image decoding failed."));
    };
    worker.onmessage = ({ data }) => {
      stop();
      if (data.error) return reject(new Error(data.error));
      const r = data.result as Normalized;
      if (
        !r ||
        !(r.bytes instanceof Uint8Array) ||
        !Number.isSafeInteger(r.width) ||
        !Number.isSafeInteger(r.height) ||
        r.width < 1 ||
        r.height < 1 ||
        r.width * r.height > 262144 ||
        r.bytes.length > 65536
      )
        return reject(
          new Error(
            "This local PS profile supports normalized artwork up to 65,536 bytes and 262,144 pixels. Choose a smaller image.",
          ),
        );
      resolve(r);
    };
    worker.postMessage(bytes, [bytes]);
  });
}
