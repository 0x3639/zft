import type { ActivityPage } from "../../../packages/protocol/activity";
import { api, ApiError } from "./api";
export type ActivityResults = ActivityPage & {
  busy: boolean;
  error: string;
  stale: boolean;
};
export class ActivityLoader {
  private generation = 0;
  private endpoint = "";
  private controller?: AbortController;
  state: ActivityResults = {
    events: [],
    nextCursor: null,
    state: "ready",
    busy: false,
    error: "",
    stale: false,
  };
  constructor(
    private changed: (state: ActivityResults) => void,
    private fetchPage = (path: string, signal: AbortSignal) =>
      api<ActivityPage>(path, { signal }),
  ) {}
  private emit(patch: Partial<ActivityResults>) {
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
      events: [],
      nextCursor: null,
      state: "ready",
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
      this.emit({
        ...data,
        events: [
          ...new Map(
            [...(more ? this.state.events : []), ...data.events].map((e) => [
              e.id,
              e,
            ]),
          ).values(),
        ],
      });
    } catch (error) {
      if (generation === this.generation) {
        const stale = error instanceof ApiError && error.status === 409;
        // A visibility change may be an unpublish/reorg: clear loaded sensitive
        // associations instead of displaying an obsolete feed while asking to refresh.
        this.emit({
          error: (error as Error).message,
          stale,
          ...(stale ? { events: [], nextCursor: null } : {}),
        });
      }
    } finally {
      if (generation === this.generation) this.emit({ busy: false });
    }
  }
}
export function relativeActivityTime(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < 3600)
    return formatter.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400)
    return formatter.format(-Math.floor(seconds / 3600), "hour");
  return formatter.format(-Math.floor(seconds / 86400), "day");
}
