import { it, expect, vi } from "vitest";
import { database } from "./d1";
import { scan } from "../apps/api/index-store";
import { checkDeployment } from "../packages/protocol/client";
vi.mock("../packages/protocol/client", () => ({
  publicClient: {},
  checkDeployment: vi.fn(async () => {}),
}));
const start = 94013,
  alice = "0x1111111111111111111111111111111111111111",
  bob = "0x2222222222222222222222222222222222222222";
function chain() {
  let fork = false,
    head = start + 206,
    fail = false;
  const hash = (n: number) =>
    `${fork && n >= start + 100 ? "fork" : "main"}-${n}`;
  const logs = () =>
    [
      {
        blockNumber: BigInt(start),
        logIndex: 0,
        eventName: "Minted",
        args: {
          tokenId: 1n,
          creator: alice,
          metadataHash: "0x" + "1".repeat(64),
        },
      },
      {
        blockNumber: BigInt(start),
        logIndex: 1,
        eventName: "Transfer",
        args: { tokenId: 1n, from: "0x" + "0".repeat(40), to: alice },
      },
      {
        blockNumber: BigInt(start + 110),
        logIndex: 0,
        eventName: "Transfer",
        args: { tokenId: 1n, from: alice, to: fork ? alice : bob },
      },
    ].map((l) => ({
      ...l,
      removed: false,
      blockHash: hash(Number(l.blockNumber)),
      transactionHash: "tx" + l.blockNumber,
    }));
  const client = {
    getBlockNumber: async () => BigInt(head),
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      hash: hash(Number(blockNumber)),
    }),
    getLogs: async ({
      fromBlock,
      toBlock,
    }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) => {
      if (fail) throw new Error("RPC unavailable");
      return logs().filter(
        (l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
      );
    },
  };
  return {
    client: client as unknown as Parameters<typeof scan>[1],
    fork: () => {
      fork = true;
    },
    fail: () => {
      fail = true;
    },
  };
}
it("discovers external transfers and atomically replaces forked ownership and event history", async () => {
  const { db, sql } = database(),
    c = chain();
  expect(await scan(db, c.client)).toBe(true);
  expect(await scan(db, c.client)).toBe(true);
  expect(await scan(db, c.client)).toBe(false);
  expect(
    sql.prepare("SELECT owner,nonce FROM indexed_items").get(),
  ).toMatchObject({ owner: bob, nonce: 1 });
  c.fork();
  await scan(db, c.client);
  await scan(db, c.client);
  expect(
    sql.prepare("SELECT owner,nonce FROM indexed_items").get(),
  ).toMatchObject({ owner: alice, nonce: 1 });
  expect(
    sql
      .prepare("SELECT COUNT(*) n FROM chain_events WHERE to_address=?")
      .get(bob),
  ).toMatchObject({ n: 0 });
  expect(
    sql.prepare("SELECT COUNT(*) n FROM chain_events").get(),
  ).toMatchObject({ n: 3 });
});
it("retains the last checkpoint on RPC failure and stops ingestion on a deployment reset", async () => {
  const { db, sql } = database(),
    c = chain();
  await scan(db, c.client);
  c.fail();
  await expect(scan(db, c.client)).rejects.toThrow("RPC unavailable");
  expect(
    sql.prepare("SELECT MAX(block_number) n FROM checkpoints").get(),
  ).toMatchObject({ n: start + 99 });
  vi.mocked(checkDeployment).mockRejectedValueOnce(
    new Error("Deployment changed"),
  );
  await expect(scan(db, c.client)).rejects.toThrow("Deployment changed");
  expect(
    sql.prepare("SELECT COUNT(*) n FROM chain_events").get(),
  ).toMatchObject({ n: 2 });
});
