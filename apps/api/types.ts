import type { Hex } from "viem";
export interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  SPONSOR: DurableObjectNamespace;
  INDEXER: DurableObjectNamespace;
  DB: D1Database;
  SPONSOR_PRIVATE_KEY?: Hex;
  SPONSOR_ENABLED?: string;
  PUBLIC_ORIGIN: string;
}
