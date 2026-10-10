import { digest } from "../core.mjs";
export const deployment = {
  chainId: "31337",
  registry: "0x1111111111111111111111111111111111111111",
};
export const metadata = {
  format: "zft-shielded-metadata-v1",
  name: "Disposable test image",
  description: "Public fixture; no user authority",
  imageHash: digest(new Uint8Array([1, 2, 3])),
  canonicalizer: "zft-png/1",
  mediaType: "image/png",
  width: 1,
  height: 1,
  creator: "0x2222222222222222222222222222222222222222",
  createdAt: "2026-10-10T00:00:00.000Z",
};
