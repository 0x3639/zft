import { abi, type Deployment } from "../../packages/protocol";
import manifest from "../../packages/protocol/deployment.json";
import { checkDeployment, publicClient } from "../../packages/protocol/client";

export type Checkpoint = { block_number: number; block_hash: string };
export async function indexStatus(db: D1Database) {
  const checkpoint = await db
    .prepare("SELECT * FROM checkpoints ORDER BY block_number DESC LIMIT 1")
    .first<Checkpoint>();
  const status = await db
    .prepare("SELECT head,synced_at,error FROM index_status WHERE id=1")
    .first<{ head: number; synced_at: number; error: string | null }>();
  return {
    block: checkpoint?.block_number ?? null,
    head: status?.head ?? null,
    syncedAt: status?.synced_at ?? null,
    error: status?.error ?? null,
    lag:
      status && checkpoint
        ? Math.max(0, status.head - checkpoint.block_number)
        : null,
    confirmations: 6,
  };
}

// D1 batches atomically advance both the event journal and its checkpoint. Views
// derive ownership from this journal, so deleting a fork also rolls back ownership.
export async function scan(db: D1Database, client = publicClient) {
  await checkDeployment(manifest as unknown as Deployment, client);
  const head = Number(await client.getBlockNumber({ cacheTime: 0 }));
  const target = head - 6;
  let last = await db
    .prepare("SELECT * FROM checkpoints ORDER BY block_number DESC LIMIT 1")
    .first<Checkpoint>();
  if (
    last &&
    (last.block_number > target ||
      (await client.getBlock({ blockNumber: BigInt(last.block_number) }))
        .hash !== last.block_hash)
  ) {
    // Check backwards in bounded pages. The next alarm continues a deep rollback.
    const points = await db
      .prepare("SELECT * FROM checkpoints ORDER BY block_number DESC LIMIT 12")
      .all<Checkpoint>();
    let ancestor: Checkpoint | undefined;
    for (const p of points.results) {
      if (
        p.block_number <= target &&
        (await client.getBlock({ blockNumber: BigInt(p.block_number) }))
          .hash === p.block_hash
      ) {
        ancestor = p;
        break;
      }
    }
    if (!ancestor && points.results.length === 12) {
      const oldest = points.results.at(-1)!;
      await db.batch([
        db
          .prepare("DELETE FROM chain_events WHERE block_number >= ?")
          .bind(oldest.block_number),
        db
          .prepare("DELETE FROM checkpoints WHERE block_number >= ?")
          .bind(oldest.block_number),
        db
          .prepare("INSERT OR REPLACE INTO index_status VALUES(1,?,?,?)")
          .bind(head, Date.now(), "Rewinding a chain fork"),
      ]);
      return true;
    }
    const n = ancestor?.block_number ?? Number(manifest.deploymentBlock) - 1;
    await db.batch([
      db.prepare("DELETE FROM chain_events WHERE block_number > ?").bind(n),
      db.prepare("DELETE FROM checkpoints WHERE block_number > ?").bind(n),
    ]);
    last = ancestor ?? null;
  }
  const from = (last?.block_number ?? Number(manifest.deploymentBlock) - 1) + 1;
  if (from > target) {
    await db
      .prepare("INSERT OR REPLACE INTO index_status VALUES(1,?,?,NULL)")
      .bind(head, Date.now())
      .run();
    return false;
  }
  const end = Math.min(target, from + 99);
  const before = await client.getBlock({ blockNumber: BigInt(end) });
  const logs = await client.getLogs({
    address: manifest.contract as `0x${string}`,
    events: abi.filter(
      (x) =>
        x.type === "event" && (x.name === "Transfer" || x.name === "Minted"),
    ),
    fromBlock: BigInt(from),
    toBlock: BigInt(end),
    strict: true,
  });
  const after = await client.getBlock({ blockNumber: BigInt(end) });
  if (
    before.hash !== after.hash ||
    (last &&
      (await client.getBlock({ blockNumber: BigInt(last.block_number) }))
        .hash !== last.block_hash)
  )
    throw new Error("Chain changed during index scan");
  const statements: D1PreparedStatement[] = [];
  for (const log of logs) {
    if (log.removed) throw new Error("Removed event in canonical range");
    const a = log.args as {
      tokenId: bigint;
      from?: string;
      to?: string;
      creator?: string;
      metadataHash?: string;
    };
    statements.push(
      db
        .prepare("INSERT INTO chain_events VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(
          Number(log.blockNumber),
          log.logIndex,
          log.blockHash,
          log.transactionHash,
          log.eventName,
          a.tokenId.toString(),
          a.from?.toLowerCase() ?? null,
          a.to?.toLowerCase() ?? null,
          a.creator?.toLowerCase() ?? null,
          a.metadataHash ?? null,
        ),
    );
  }
  statements.push(
    db.prepare("INSERT INTO checkpoints VALUES(?,?)").bind(end, after.hash),
    db
      .prepare("INSERT OR REPLACE INTO index_status VALUES(1,?,?,NULL)")
      .bind(head, Date.now()),
  );
  await db.batch(statements);
  return end < target;
}
