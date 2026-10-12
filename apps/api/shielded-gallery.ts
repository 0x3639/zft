import {
  createPublicClient,
  decodeEventLog,
  http,
  keccak256,
  parseAbi,
  sha256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { z } from "zod";
import configuration from "../../research/shielded-devnet/evidence/app-config.json";
import { canonical, digest } from "../../packages/protocol";
import { validatePublicImage } from "../../packages/file-codec";
import {
  hash,
  publicAssetId,
  publicMetadata,
  publicationSchema,
  type GalleryItem,
  type GalleryPage,
} from "../../packages/shielded/public";
import { HttpError } from "./http";

const abi = parseAbi([
  "event Created(bytes32 indexed assetId, bytes32 indexed imageHash, bytes32 metadataHash, address indexed creator, uint256 commitment)",
  "function imageAssets(bytes32) view returns (bytes32)",
]);
const recordSchema = z
  .object({
    assetId: hash,
    metadata: publicMetadata,
    transactionHash: hash,
    creationBlock: z.string().regex(/^(0|[1-9][0-9]{0,77})$/),
    creationBlockHash: hash,
  })
  .strict();
type Record = z.infer<typeof recordSchema>;
type Reader = Pick<
  PublicClient,
  | "getChainId"
  | "getBlock"
  | "getCode"
  | "getTransactionReceipt"
  | "readContract"
>;
const reader = createPublicClient({
  transport: http(configuration.rpc, { retryCount: 0, timeout: 15000 }),
});
function requireMatch(value: unknown) {
  if (!value)
    throw new HttpError(
      409,
      "The shielded creation does not match the current chain. Check its status before publishing.",
    );
}

// Only public chain reads. A creation observation never asserts current ownership or finality.
export function shieldedGallery(
  bucket: R2Bucket,
  rpc: Reader = reader,
  selected = configuration,
) {
  const pins = selected.pins;
  const address = pins.contracts.registry.address as Address;
  const prefix = `shielded-public/v1/${pins.chainId}/${address}/`;
  const recordKey = (id: string) => `${prefix}records/${id}.json`;
  const imageKey = (id: string) => `${prefix}images/${id}.png`;
  const indexKey = (r: Record) =>
    `${prefix}newest/${((1n << 256n) - 1n - BigInt(r.creationBlock)).toString(16).padStart(64, "0")}/${r.assetId}/${r.creationBlockHash}`;

  async function chain() {
    const [id, genesis, head] = await Promise.all([
      rpc.getChainId(),
      rpc.getBlock({ blockNumber: 0n }),
      rpc.getBlock(),
    ]);
    requireMatch(
      String(id) === pins.chainId &&
        genesis.hash === pins.genesisHash &&
        head.number !== null &&
        head.number >= BigInt(pins.deploymentBlock),
    );
    for (const pin of Object.values(pins.contracts)) {
      const code = await rpc.getCode({
        address: pin.address as Address,
        blockNumber: head.number!,
      });
      requireMatch(code && code !== "0x" && keccak256(code) === pin.codeHash);
    }
    return head;
  }
  async function stable(head: Awaited<ReturnType<typeof chain>>) {
    requireMatch(
      (await rpc.getBlock({ blockNumber: head.number! })).hash === head.hash,
    );
  }
  async function creation(
    input: Pick<Record, "assetId" | "metadata" | "transactionHash">,
    head: Awaited<ReturnType<typeof chain>>,
  ) {
    const { metadata: m, assetId } = input;
    requireMatch(publicAssetId(m, pins.chainId, address) === assetId);
    let receipt;
    try {
      receipt = await rpc.getTransactionReceipt({
        hash: input.transactionHash as Hex,
      });
    } catch (error) {
      if ((error as Error).name === "TransactionReceiptNotFoundError")
        throw new HttpError(409, "Creation is not currently observed.");
      throw error;
    }
    requireMatch(
      receipt.status === "success" &&
        receipt.transactionHash.toLowerCase() === input.transactionHash &&
        receipt.blockNumber >= BigInt(pins.deploymentBlock) &&
        receipt.blockNumber <= head.number!,
    );
    const events = receipt.logs
      .filter((log) => log.address.toLowerCase() === address)
      .flatMap((log) => {
        try {
          const event = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          return event.eventName === "Created" ? [event.args] : [];
        } catch {
          return [];
        }
      });
    requireMatch(events.length === 1);
    const event = events[0];
    requireMatch(
      event.assetId === assetId &&
        event.imageHash === m.imageHash &&
        event.metadataHash === digest(m) &&
        event.creator.toLowerCase() === m.creator,
    );
    const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
    requireMatch(block.hash === receipt.blockHash);
    requireMatch(
      (await rpc.readContract({
        address,
        abi,
        functionName: "imageAssets",
        args: [m.imageHash as Hex],
        blockNumber: head.number!,
      })) === assetId,
    );
    return {
      ...input,
      creationBlock: String(receipt.blockNumber),
      creationBlockHash: receipt.blockHash,
    };
  }
  const present = (r: Record, observedBlock: string): GalleryItem => ({
    ...r,
    observedBlock,
    image: `/api/shielded/gallery/${r.assetId}/image`,
  });
  async function stored(id: string) {
    const object = await bucket.get(recordKey(hash.parse(id)));
    if (!object)
      throw new HttpError(
        404,
        "This ZFT has not been published in the gallery.",
      );
    const record = recordSchema.parse(await object.json());
    requireMatch(record.assetId === id);
    return record;
  }
  async function checked(r: Record, head: Awaited<ReturnType<typeof chain>>) {
    const current = await creation(r, head);
    requireMatch(
      current.creationBlock === r.creationBlock &&
        current.creationBlockHash === r.creationBlockHash,
    );
    return present(r, String(head.number));
  }
  return {
    async publish(value: unknown) {
      const input = publicationSchema.parse(value);
      let image: Uint8Array;
      try {
        image = Uint8Array.from(atob(input.image), (c) => c.charCodeAt(0));
      } catch {
        throw new HttpError(400, "Invalid public image encoding.");
      }
      let dimensions;
      try {
        dimensions = await validatePublicImage(image);
      } catch {
        throw new HttpError(
          400,
          "Only a sanitized public PNG can be published.",
        );
      }
      requireMatch(
        sha256(image) === input.metadata.imageHash &&
          dimensions.width === input.metadata.width &&
          dimensions.height === input.metadata.height,
      );
      const head = await chain();
      // Explicit allowlist: never persist the request body, recovery data or note fields.
      const record = await creation(
        {
          assetId: input.assetId,
          metadata: input.metadata,
          transactionHash: input.transactionHash,
        },
        head,
      );
      await stable(head);
      await bucket.put(imageKey(input.metadata.imageHash), image, {
        httpMetadata: { contentType: "image/png" },
      });
      await bucket.put(recordKey(input.assetId), canonical(record), {
        httpMetadata: { contentType: "application/json" },
      });
      // Deterministic keys make a failed publication safely retryable without a new transaction.
      await bucket.put(
        indexKey(record),
        canonical({
          assetId: record.assetId,
          creationBlockHash: record.creationBlockHash,
        }),
      );
      return present(record, String(head.number));
    },
    async list(cursor: string | null): Promise<GalleryPage> {
      if (
        cursor !== null &&
        (cursor.length > 2048 || /[^\x20-\x7e]/.test(cursor))
      )
        throw new HttpError(400, "Invalid gallery cursor.");
      const page = await bucket.list({
        prefix: `${prefix}newest/`,
        limit: 6,
        ...(cursor ? { cursor } : {}),
      });
      const items: GalleryItem[] = [];
      if (page.objects.length) {
        const head = await chain();
        for (const object of page.objects) {
          const id = object.key.split("/").at(-2)!;
          try {
            const record = await stored(id);
            if (object.key !== indexKey(record)) continue;
            items.push(await checked(record, head));
          } catch (error) {
            if (error instanceof HttpError && [404, 409].includes(error.status))
              continue;
            throw error;
          }
        }
        await stable(head);
      }
      return { items, cursor: page.truncated ? page.cursor : null };
    },
    async item(id: string) {
      const record = await stored(id),
        head = await chain(),
        result = await checked(record, head);
      await stable(head);
      return result;
    },
    async image(id: string) {
      const record = await stored(id),
        head = await chain();
      await checked(record, head);
      const object = await bucket.get(imageKey(record.metadata.imageHash));
      if (!object) throw new HttpError(404, "Public picture is unavailable.");
      const bytes = new Uint8Array(await object.arrayBuffer());
      requireMatch(sha256(bytes) === record.metadata.imageHash);
      await stable(head);
      return bytes;
    },
  };
}
