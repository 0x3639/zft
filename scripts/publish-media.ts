import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { sha256 } from "viem";
import { digest, metadataSchema } from "../packages/protocol";
import { validatePublicImage } from "../packages/file-codec";

// Copy only verified, already minted public objects. Never read recovery or transfer files.
const source = "http://localhost:8787";
const response = await fetch(source + "/api/gallery");
if (!response.ok) throw new Error("Local catalog unavailable");
const catalog = (await response.json()) as {
  items: { tokenId: string; metadata: unknown; metadataHash: string }[];
};
await mkdir(".local/public-media", { recursive: true, mode: 0o700 });
for (const item of catalog.items) {
  const metadata = metadataSchema.parse(item.metadata);
  if (
    digest(metadata) !== item.metadataHash ||
    BigInt(metadata.imageHash).toString() !== item.tokenId
  )
    throw new Error("Catalog hash mismatch");
  const imageResponse = await fetch(
    `${source}/art/${metadata.imageHash.slice(2)}.png`,
  );
  if (!imageResponse.ok) throw new Error("Minted public art unavailable");
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if (sha256(bytes) !== metadata.imageHash)
    throw new Error("Public art hash mismatch");
  await validatePublicImage(bytes);
  for (const [key, data, type] of [
    [`art/${metadata.imageHash.slice(2)}.png`, bytes, "image/png"],
    [
      `metadata/${item.metadataHash.slice(2)}.json`,
      JSON.stringify(metadata),
      "application/json",
    ],
  ] as const) {
    const file = `.local/public-media/${key.split("/")[1]}`;
    await writeFile(file, data);
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "r2",
        "object",
        "put",
        `zft-devnet-public/${key}`,
        "--file",
        file,
        "--content-type",
        type,
        "--remote",
        "--config",
        "wrangler.devnet.jsonc",
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) throw new Error("Public media upload failed");
  }
}
console.log(
  `Copied ${catalog.items.length} confirmed public artwork/metadata pairs.`,
);
