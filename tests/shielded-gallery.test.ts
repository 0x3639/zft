import { describe, it, expect, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseAbi,
  sha256,
  type Hex,
} from "viem";
import { galleryError, shieldedGallery } from "../apps/api/shielded-gallery";
import { HttpError } from "../apps/api/http";
import {
  publicAssetId,
  publicationSchema,
  type Publication,
} from "../packages/shielded/public";
import { digest } from "../packages/protocol";
import configuration from "../research/shielded-devnet/evidence/app-config.json";
import { source } from "./fixtures";
import { encode } from "fast-png";
import { chunk } from "../packages/file-codec";

const blockHash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const eventAbi = parseAbi([
  "event Created(bytes32 indexed assetId, bytes32 indexed imageHash, bytes32 metadataHash, address indexed creator, uint256 commitment)",
]);
function fixture() {
  const selected = structuredClone(configuration);
  for (const entry of Object.values(selected.pins.contracts))
    entry.codeHash = keccak256("0x6000");
  const receipts = new Map<string, any>(),
    assets = new Map<string, string>(),
    objects = new Map<string, Uint8Array>();
  let failIndex = false;
  const bucket = {
    put: vi.fn(async (key: string, value: string | Uint8Array) => {
      if (failIndex && key.includes("/newest/"))
        throw Error("Simulated interrupted publication");
      objects.set(
        key,
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : new Uint8Array(value),
      );
    }),
    get: vi.fn(async (key: string) => {
      const value = objects.get(key);
      return value
        ? {
            json: async () => JSON.parse(new TextDecoder().decode(value)),
            arrayBuffer: async () => value.slice().buffer,
          }
        : null;
    }),
    list: vi.fn(
      async ({
        prefix,
        limit,
        cursor,
      }: {
        prefix: string;
        limit: number;
        cursor?: string;
      }) => {
        const keys = [...objects.keys()]
            .filter((k) => k.startsWith(prefix))
            .sort(),
          start = Number(cursor ?? 0),
          end = start + limit;
        return {
          objects: keys.slice(start, end).map((key) => ({ key })),
          truncated: end < keys.length,
          cursor: String(end),
        };
      },
    ),
  };
  const rpc = {
    getChainId: vi.fn(async () => Number(selected.pins.chainId)),
    getBlock: vi.fn(async (options?: { blockNumber?: bigint }) => {
      const number = options?.blockNumber ?? 200000n;
      return {
        number,
        hash: number === 0n ? selected.pins.genesisHash : blockHash(number),
      };
    }),
    getCode: vi.fn(async () => "0x6000"),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => {
      if (!receipts.has(hash))
        throw Object.assign(Error("Not observed"), {
          name: "TransactionReceiptNotFoundError",
        });
      return receipts.get(hash);
    }),
    readContract: vi.fn(
      async ({ args }: { args: string[] }) =>
        assets.get(args[0]) ?? blockHash(0n),
    ),
  };
  function publication(n = 1): Publication {
    const image =
      n === 1
        ? source()
        : encode({
            width: 2,
            height: 2,
            channels: 4,
            depth: 8,
            data: new Uint8Array(16).fill(n),
          });
    const metadata = {
      format: "zft-shielded-metadata-v1" as const,
      name: `Public picture ${n}`,
      description: "Public description",
      imageHash: sha256(image),
      canonicalizer: "zft-png/1" as const,
      mediaType: "image/png" as const,
      width: 2,
      height: 2,
      creator: "0x1111111111111111111111111111111111111111",
      createdAt: "2026-10-12T00:00:00.000Z",
    };
    if (n > 1) metadata.name += " fixture";
    const assetId = publicAssetId(
        metadata,
        selected.pins.chainId,
        selected.pins.contracts.registry.address as Hex,
      ),
      transactionHash = blockHash(BigInt(n));
    const receipt = {
      status: "success",
      transactionHash,
      blockNumber: 137404n + BigInt(n),
      blockHash: blockHash(137404n + BigInt(n)),
      logs: [
        {
          address: selected.pins.contracts.registry.address,
          topics: encodeEventTopics({
            abi: eventAbi,
            eventName: "Created",
            args: {
              assetId,
              imageHash: metadata.imageHash,
              creator: metadata.creator as Hex,
            },
          }),
          data: encodeAbiParameters(
            [{ type: "bytes32" }, { type: "uint256" }],
            [digest(metadata), 123n],
          ),
        },
      ],
    };
    receipts.set(transactionHash, receipt);
    assets.set(metadata.imageHash, assetId);
    return {
      format: "zft-shielded-publication-v1",
      assetId,
      transactionHash,
      metadata,
      image: Buffer.from(image).toString("base64"),
    };
  }
  const gallery = shieldedGallery(
    bucket as unknown as R2Bucket,
    rpc as unknown as Parameters<typeof shieldedGallery>[1],
    selected,
  );
  return {
    gallery,
    rpc,
    bucket,
    objects,
    receipts,
    assets,
    publication,
    selected,
    failIndex: (value: boolean) => {
      failIndex = value;
    },
  };
}

describe("shielded public gallery boundary", () => {
  it("publishes only matching, sanitized public artwork and is idempotent", async () => {
    const f = fixture(),
      data = f.publication(),
      result = await f.gallery.publish(data);
    expect(result.assetId).toBe(data.assetId);
    expect(result.creationBlock).toBe("137405");
    expect(await f.gallery.item(data.assetId)).toEqual(result);
    expect(await f.gallery.image(data.assetId)).toEqual(source());
    await f.gallery.publish(data);
    expect(f.objects.size).toBe(3);
    expect((await f.gallery.list(null)).items).toEqual([result]);
    const record = JSON.parse(
      new TextDecoder().decode(
        [...f.objects].find(([key]) => key.includes("/records/"))![1],
      ),
    );
    expect(Object.keys(record).sort()).toEqual([
      "assetId",
      "creationBlock",
      "creationBlockHash",
      "metadata",
      "transactionHash",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /commitment|secret|password|recovery|owner/i,
    );
  });
  it.each(["secret", "destination", "recovery", "password", "commitment"])(
    "rejects extra %s fields before any writes or chain reads",
    async (name) => {
      const f = fixture(),
        data = f.publication();
      await expect(
        f.gallery.publish({ ...data, [name]: "never publish" }),
      ).rejects.toThrow();
      await expect(
        f.gallery.publish({
          ...data,
          metadata: { ...data.metadata, [name]: "never publish" },
        }),
      ).rejects.toThrow();
      expect(f.bucket.put).not.toHaveBeenCalled();
      expect(f.rpc.getChainId).not.toHaveBeenCalled();
    },
  );
  it("rejects bearer PNG chunks, malformed encoding and mismatched picture bytes", async () => {
    const f = fixture(),
      data = f.publication();
    const png = source(),
      bearer = Buffer.concat([
        png.subarray(0, -12),
        chunk("zfTA", new TextEncoder().encode("private spending material")),
        png.subarray(-12),
      ]);
    for (const image of [
      bearer.toString("base64"),
      "!not base64",
      Buffer.from("a private bearer is not a public PNG").toString("base64"),
      data.image.slice(0, -8),
    ])
      await expect(f.gallery.publish({ ...data, image })).rejects.toThrow();
    await expect(
      f.gallery.publish({ ...data, metadata: { ...data.metadata, width: 4 } }),
    ).rejects.toThrow();
    expect(f.bucket.put).not.toHaveBeenCalled();
  });
  it.each([
    "reservation",
    "reverted",
    "foreign registry",
    "changed metadata",
    "wrong creator",
    "wrong asset",
    "orphaned block",
    "missing asset",
  ])("never publishes %s", async (change) => {
    const f = fixture(),
      data = f.publication(),
      receipt = f.receipts.get(data.transactionHash);
    if (change === "reservation") receipt.logs = [];
    if (change === "reverted") receipt.status = "reverted";
    if (change === "foreign registry")
      receipt.logs[0].address = data.metadata.creator;
    if (change === "changed metadata") data.metadata.name = "Substituted title";
    if (change === "wrong creator") receipt.logs[0].topics[3] = blockHash(5n);
    if (change === "wrong asset") receipt.logs[0].topics[1] = blockHash(5n);
    if (change === "orphaned block") receipt.blockHash = blockHash(5n);
    if (change === "missing asset") f.assets.clear();
    await expect(f.gallery.publish(data)).rejects.toMatchObject({
      status: 409,
    });
    expect(f.objects.size).toBe(0);
  });
  it.each(["chain", "genesis", "code", "changing head"])(
    "fails closed on wrong %s",
    async (change) => {
      const f = fixture(),
        data = f.publication();
      if (change === "chain") f.rpc.getChainId.mockResolvedValue(1);
      if (change === "code") f.rpc.getCode.mockResolvedValue("0x6001");
      if (change === "genesis" || change === "changing head") {
        const original = f.rpc.getBlock.getMockImplementation()!;
        f.rpc.getBlock.mockImplementation(async (options) => {
          const result = await original(options);
          return (change === "genesis" && options?.blockNumber === 0n) ||
            (change === "changing head" && options?.blockNumber === 200000n)
            ? { ...result, hash: blockHash(6n) }
            : result;
        });
      }
      await expect(f.gallery.publish(data)).rejects.toMatchObject({
        status: 409,
      });
      expect(f.objects.size).toBe(0);
    },
  );
  it("hides orphaned creation claims while public picture bytes remain available", async () => {
    const f = fixture(),
      data = f.publication();
    await f.gallery.publish(data);
    f.receipts.get(data.transactionHash).blockHash = blockHash(7n);
    expect((await f.gallery.list(null)).items).toEqual([]);
    await expect(f.gallery.item(data.assetId)).rejects.toMatchObject({
      status: 409,
    });
    expect(await f.gallery.image(data.assetId)).toEqual(source());
  });
  it("serves hash-checked public pictures without RPC, including during an outage", async () => {
    const f = fixture(),
      data = f.publication();
    await f.gallery.publish(data);
    for (const call of Object.values(f.rpc)) {
      call.mockClear();
      call.mockRejectedValue(Error("RPC offline"));
    }
    expect(await f.gallery.image(data.assetId)).toEqual(source());
    for (const call of Object.values(f.rpc))
      expect(call).not.toHaveBeenCalled();
    const key = [...f.objects.keys()].find((key) => key.includes("/images/"))!;
    f.objects.set(key, new Uint8Array([1, 2, 3]));
    await expect(f.gallery.image(data.assetId)).rejects.toMatchObject({
      status: 409,
    });
    f.objects.delete(key);
    await expect(f.gallery.image(data.assetId)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("uses the same bounded JSON errors for local and production gallery requests", async () => {
    for (const status of [404, 409]) {
      const response = galleryError(
        new HttpError(status, "Public gallery error"),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "Public gallery error" });
    }
    const invalid = publicationSchema.safeParse({ secret: "must not echo" });
    if (invalid.success) throw Error("Invalid fixture accepted");
    const bad = galleryError(invalid.error),
      unavailable = galleryError(Error("private diagnostic"));
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("secret");
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private diagnostic");
  });
  it("reports an RPC outage instead of silently returning an empty gallery", async () => {
    const f = fixture(),
      data = f.publication();
    await f.gallery.publish(data);
    f.rpc.getTransactionReceipt.mockRejectedValue(Error("RPC offline"));
    await expect(f.gallery.list(null)).rejects.toThrow("RPC offline");
  });
  it("retries an interrupted upload using the same record, with no transaction method", async () => {
    const f = fixture(),
      data = f.publication();
    f.failIndex(true);
    await expect(f.gallery.publish(data)).rejects.toThrow(
      "interrupted publication",
    );
    f.failIndex(false);
    await f.gallery.publish(data);
    expect(f.objects.size).toBe(3);
    expect((await f.gallery.list(null)).items).toHaveLength(1);
  });
  it("never includes old wallet gallery objects", async () => {
    const f = fixture();
    f.objects.set("art/old.png", source());
    f.objects.set(
      "metadata/old.json",
      new TextEncoder().encode('{"name":"old"}'),
    );
    expect(await f.gallery.list(null)).toEqual({ items: [], cursor: null });
    expect(f.rpc.getChainId).not.toHaveBeenCalled();
  });
  it("paginates newest-first with a bounded six-item observation window", async () => {
    const f = fixture(),
      ids: string[] = [];
    for (let n = 1; n <= 8; n++) {
      const data = f.publication(n);
      await f.gallery.publish(data);
      ids.push(data.assetId);
    }
    const first = await f.gallery.list(null);
    expect(first.items.map((item) => item.assetId)).toEqual(
      ids.slice(2).reverse(),
    );
    expect(first.cursor).not.toBeNull();
    const second = await f.gallery.list(first.cursor);
    expect(second.items.map((item) => item.assetId)).toEqual(
      ids.slice(0, 2).reverse(),
    );
    expect(second.cursor).toBeNull();
  });
  it("republication after reinclusion skips the orphaned index entry", async () => {
    const f = fixture(),
      data = f.publication();
    await f.gallery.publish(data);
    const receipt = f.receipts.get(data.transactionHash);
    receipt.blockNumber = 150000n;
    receipt.blockHash = blockHash(150000n);
    const current = await f.gallery.publish(data);
    expect((await f.gallery.list(null)).items).toEqual([current]);
  });
  it("uses the frozen metadata and asset ID formula", async () => {
    const f = fixture(),
      data = f.publication();
    // Public vector generated by the frozen shielded core; no research runtime in the root test job.
    expect(data.assetId).toBe(
      "0x6a00f49fd52d214a4d189dac4793c7d42ce22388615b7778b153b0eab0a13569",
    );
    expect(digest(data.metadata)).toBe(
      "0xa17bf884ea84aeb78225bc2e2648af64aae049b7979f038c1e280764a1c779a1",
    );
    expect(
      publicationSchema.safeParse({
        ...data,
        metadata: { ...data.metadata, name: "a".repeat(257) },
      }).success,
    ).toBe(false);
  });
});
