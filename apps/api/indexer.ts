import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";
import { projectDiscovery } from "./discovery";
import { scan, indexStatus } from "./index-store";

export class Indexer extends DurableObject<Env> {
  private tail: Promise<unknown> = Promise.resolve();
  private run(wake = false) {
    const task = this.tail.then(async () => {
      if (wake) {
        const last = (await this.ctx.storage.get<number>("lastWake")) ?? 0;
        if (Date.now() - last < 30_000) return;
        await this.ctx.storage.put("lastWake", Date.now());
      }
      try {
        const more = await scan(this.env.DB);
        const discoveryMore = await projectDiscovery(this.env);
        if (more || discoveryMore)
          await this.ctx.storage.setAlarm(Date.now() + 1_000);
      } catch {
        // Do not publish RPC response bodies or silently advance a failed range.
        await this.env.DB.prepare(
          "INSERT INTO index_status VALUES(1,0,0,'Chain index unavailable; last checkpoint retained') ON CONFLICT(id) DO UPDATE SET error=excluded.error",
        ).run();
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async fetch() {
    await this.run(true);
    return Response.json(await indexStatus(this.env.DB));
  }
  alarm() {
    return this.run();
  }
}
