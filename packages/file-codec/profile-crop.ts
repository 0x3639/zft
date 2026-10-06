import { decode, encode } from "fast-png";
import { PROFILE_MEDIA, type MediaKind } from "../protocol/profile-media";
export type Crop = { x: number; y: number; zoom: number };
export function cropRect(
  width: number,
  height: number,
  kind: MediaKind,
  crop: Crop,
) {
  if (
    ![width, height, crop.x, crop.y, crop.zoom].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    crop.x < 0 ||
    crop.x > 100 ||
    crop.y < 0 ||
    crop.y > 100 ||
    crop.zoom < 1 ||
    crop.zoom > 3
  )
    throw new Error("Invalid crop.");
  const target = PROFILE_MEDIA[kind];
  const scale =
    Math.min(width / target.width, height / target.height) / crop.zoom;
  const w = target.width * scale,
    h = target.height * scale;
  return {
    x: ((width - w) * crop.x) / 100,
    y: ((height - h) * crop.y) / 100,
    width: w,
    height: h,
  };
}
/** Crop already-normalized RGBA pixels in the browser worker. */
export function cropProfileImage(
  source: ReturnType<typeof decode>,
  kind: MediaKind,
  crop: Crop,
) {
  const rect = cropRect(source.width, source.height, kind, crop);
  const { width, height, maxBytes } = PROFILE_MEDIA[kind];
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.max(
      0,
      Math.min(
        source.height - 1,
        rect.y + ((y + 0.5) * rect.height) / height - 0.5,
      ),
    );
    const y0 = Math.floor(sy),
      y1 = Math.min(y0 + 1, source.height - 1),
      fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.max(
        0,
        Math.min(
          source.width - 1,
          rect.x + ((x + 0.5) * rect.width) / width - 0.5,
        ),
      );
      const x0 = Math.floor(sx),
        x1 = Math.min(x0 + 1, source.width - 1),
        fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const top =
          source.data[(y0 * source.width + x0) * 4 + c] * (1 - fx) +
          source.data[(y0 * source.width + x1) * 4 + c] * fx;
        const bottom =
          source.data[(y1 * source.width + x0) * 4 + c] * (1 - fx) +
          source.data[(y1 * source.width + x1) * 4 + c] * fx;
        pixels[(y * width + x) * 4 + c] = Math.round(
          top * (1 - fy) + bottom * fy,
        );
      }
    }
  }
  const bytes = encode(
    { width, height, data: pixels, depth: 8, channels: 4 },
    { zlib: { level: 6 } },
  );
  if (bytes.length > maxBytes)
    throw new Error(
      "Image is too large after cropping. Choose a simpler image.",
    );
  return bytes;
}
