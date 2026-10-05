import { api, ApiError } from "./api";
import type { DiscoveryPage } from "../../../packages/protocol/discovery";
export type Results<T> = DiscoveryPage<T> & {
  busy: boolean;
  error: string;
  stale: boolean;
};
export class DiscoveryLoader<T> {
  private generation = 0;
  private endpoint = "";
  private controller?: AbortController;
  state: Results<T> = {
    items: [],
    nextCursor: null,
    total: 0,
    pending: 0,
    busy: false,
    error: "",
    stale: false,
  };
  constructor(
    private identify: (item: T) => string,
    private changed: (state: Results<T>) => void,
    private fetchPage = (path: string, signal: AbortSignal) =>
      api<DiscoveryPage<T>>(path, { signal }),
  ) {}
  private emit(patch: Partial<Results<T>>) {
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  stop() {
    this.generation++;
    this.controller?.abort();
  }
  reset(endpoint: string) {
    this.stop();
    this.endpoint = endpoint;
    this.emit({
      items: [],
      nextCursor: null,
      total: 0,
      pending: 0,
      busy: false,
      error: "",
      stale: false,
    });
    return this.load();
  }
  async load(more = false) {
    if (this.state.busy || this.state.stale || (more && !this.state.nextCursor))
      return;
    const generation = this.generation;
    this.controller = new AbortController();
    this.emit({ busy: true, error: "" });
    try {
      const data = await this.fetchPage(
        this.endpoint +
          (more ? `&cursor=${encodeURIComponent(this.state.nextCursor!)}` : ""),
        this.controller.signal,
      );
      if (generation !== this.generation) return;
      const items = [...(more ? this.state.items : []), ...data.items];
      const unique = new Map(items.map((item) => [this.identify(item), item]));
      this.emit({ ...data, items: [...unique.values()] });
    } catch (error) {
      if (generation === this.generation)
        this.emit({
          error: (error as Error).message,
          stale: error instanceof ApiError && error.status === 409,
        });
    } finally {
      if (generation === this.generation) this.emit({ busy: false });
    }
  }
}
