export type PresentationReport = {
  credentialValid: boolean;
  walletSigningKeyValid?: boolean;
  contractWalletChecked: boolean;
  issuerReported: "spent" | "unspent";
  observedAt: number;
  expiresAt: number;
  withinObservationInterval: boolean;
  sequence: number;
  imageSha256: string;
  width: number;
  height: number;
};
export type Operation = {
  digest: string;
  acknowledged: boolean;
  complete: boolean;
  backupId: string | null;
};
export type State = {
  clientId: string;
  revision: number;
  operations: Operation[];
  credentials: { id: string; locallySpent: boolean }[];
};
export type Artwork = {
  bytes: Uint8Array;
  width: number;
  height: number;
  digest: string;
};
export type Result = {
  state?: State;
  digest?: string;
  wire?: string;
  id?: string;
  artwork?: Artwork;
  lost?: boolean;
  presentation?: {
    report: PresentationReport;
    message?: string;
    id?: string;
    wire?: string;
  };
};
export type Bootstrap = {
  mode?: {
    kind: "persistent-local";
    operationLimit: number;
    sessionLimit: number;
  };
  manifest: { realm: string; [key: string]: unknown };
  clients: Record<string, string>;
  fixtures: { asset: string; width: number; height: number }[];
};
export const FAILURE =
  "Action could not finish. Keep your recovery files. Reopen after a storage conflict, or retry the saved operation after an issuer outage.";
export function localLaunch(url: URL) {
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    !/^#[0-9a-f]{64}$/.test(url.hash)
  )
    throw new Error(
      "Open the product launch link printed by pnpm ps:local. Hosted PS access is not enabled.",
    );
  return url.hash.slice(1);
}
export function route(path: string) {
  if (path === "/ps" || path === "/ps/") return { page: "collection" } as const;
  if (["/ps/create", "/ps/receive", "/ps/recover"].includes(path))
    return { page: path.slice(4) } as {
      page: "create" | "receive" | "recover";
    };
  const m = /^\/ps\/item\/([0-9a-f]{64})\/([0-9a-f]{96})$/.exec(path);
  return m
    ? ({ page: "item", realm: m[1], id: m[2] } as const)
    : ({ page: "missing" } as const);
}
export function itemPath(realm: string, id: string) {
  const path = `/ps/item/${realm}/${id}`;
  if (route(path).page !== "item")
    throw new Error("Invalid scoped credential.");
  return path;
}
export async function readEncrypted(file: File) {
  if (!file.size || file.size > 2_101_248)
    throw new Error(
      "Choose an encrypted PS file no larger than 2,101,248 bytes.",
    );
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    await file.arrayBuffer(),
  );
}
// This bridge keeps replies from terminated workers out of the active UI.
export class PsBridge {
  private worker?: Worker;
  private seq = 0;
  private waiter?: {
    id: number;
    resolve: (r: Result) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(
    private makeWorker = () =>
      new Worker("/web/client-worker.mjs", { type: "module" }),
    private timeout = 90_000,
  ) {}
  get available() {
    return !!this.worker;
  }
  start() {
    this.lock();
    const worker = this.makeWorker();
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker || data.id !== this.waiter?.id) return;
      const w = this.waiter;
      if (!w) return;
      this.waiter = undefined;
      clearTimeout(w.timer);
      data.ok ? w.resolve(data.result) : w.reject(new Error(FAILURE));
    };
    worker.onerror = () => {
      if (this.worker === worker) this.lock();
    };
  }
  call(action: string, data: Record<string, unknown> = {}): Promise<Result> {
    if (!this.worker)
      return Promise.reject(new Error("Unlock your browser copy first."));
    if (this.waiter)
      return Promise.reject(
        new Error("Wait for the current action to finish."),
      );
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.waiter = {
        id,
        resolve,
        reject,
        timer: setTimeout(() => this.lock(), this.timeout),
      };
      try {
        worker.postMessage({ ...data, id, action });
      } catch {
        this.lock();
      }
    });
  }
  lock() {
    this.worker?.terminate();
    this.worker = undefined;
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter.reject(
        new Error(
          "Locked or timed out. Keep recovery files and reopen the saved browser copy.",
        ),
      );
      this.waiter = undefined;
    }
  }
}
export async function bootstrap(
  token: string,
  signal: AbortSignal,
): Promise<Bootstrap> {
  const r = await fetch("/issuer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: '{"action":"bootstrap"}',
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!r.ok)
    throw new Error(
      "Local issuer is unavailable. Use the current launch link.",
    );
  const b = (await r.json()) as Bootstrap;
  if (
    !b.manifest ||
    !/^[0-9a-f]{64}$/.test(b.manifest.realm) ||
    !b.clients ||
    !["alice", "bob", "restored"].every((k) =>
      /^[0-9a-f]{32}$/.test(b.clients[k]),
    ) ||
    !Array.isArray(b.fixtures)
  )
    throw new Error("Invalid local issuer configuration.");
  // The credential Worker additionally validates the complete manifest and client pin.
  return b;
}
