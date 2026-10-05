import { expect, it, vi } from "vitest";
import {
  ActivityLoader,
  relativeActivityTime,
} from "../apps/web/src/activity-loader";
import { ApiError } from "../apps/web/src/api";
import type { ActivityPage } from "../packages/protocol/activity";
const page = (
  ids: string[],
  nextCursor: string | null = null,
): ActivityPage => ({
  events: ids.map((id) => ({
    id,
    kind: "profile_created",
    occurredAt: 1791190000000,
    source: "public",
    actor: { address: id, name: id },
    target: null,
    item: null,
    chain: null,
  })),
  nextCursor,
  state: "ready",
});
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
it("drops late results across view/account changes and errors after unmount", async () => {
  const old = deferred<ActivityPage>(),
    fresh = deferred<ActivityPage>(),
    late = deferred<ActivityPage>();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise)
    .mockReturnValueOnce(late.promise);
  const changed = vi.fn(),
    loader = new ActivityLoader(changed, fetch);
  const first = loader.reset("/api/activity?viewer=old"),
    second = loader.reset("/api/activity?viewer=new");
  expect(fetch.mock.calls[0][1].aborted).toBe(true);
  fresh.resolve(page(["new"]));
  await second;
  old.resolve(page(["old"]));
  await first;
  expect(loader.state.events.map((e) => e.id)).toEqual(["new"]);
  const last = loader.reset("/api/activity?view=everyone");
  loader.stop();
  const calls = changed.mock.calls.length;
  late.reject(new Error("late"));
  await last;
  expect(changed).toHaveBeenCalledTimes(calls);
});
it("locks duplicate pagination, deduplicates events, and retains the cursor on retryable failure", async () => {
  const delayed = deferred<ActivityPage>();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(page(["1"], "a"))
    .mockReturnValueOnce(delayed.promise)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(page(["3"]));
  const loader = new ActivityLoader(() => {}, fetch);
  await loader.reset("/api/activity?view=everyone");
  const pending = loader.load(true);
  await loader.load(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  delayed.resolve(page(["1", "2"], "b"));
  await pending;
  await loader.load(true);
  expect(loader.state).toMatchObject({ error: "Offline", nextCursor: "b" });
  expect(loader.state.events).toHaveLength(2);
  await loader.load(true);
  expect(loader.state.events.map((e) => e.id)).toEqual(["1", "2", "3"]);
  await loader.load(true);
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("clears obsolete associations on visibility conflicts and recovers only on refresh", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(page(["private-after-unpublish"], "a"))
    .mockRejectedValueOnce(new ApiError(409, "Activity changed"))
    .mockResolvedValueOnce(page(["current"]));
  const loader = new ActivityLoader(() => {}, fetch);
  await loader.reset("/api/activity?view=everyone");
  await loader.load(true);
  expect(loader.state).toMatchObject({
    events: [],
    nextCursor: null,
    stale: true,
    error: "Activity changed",
  });
  await loader.load(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  await loader.reset("/api/activity?view=everyone");
  expect(loader.state.stale).toBe(false);
  expect(loader.state.events[0].id).toBe("current");
});
it("formats future, minute, hour and day times without claiming unknown timestamps", () => {
  const now = 1791190000000;
  expect(relativeActivityTime(now + 1000, now)).toBe("Just now");
  expect(relativeActivityTime(now - 120000, now)).toBe("2 minutes ago");
  expect(relativeActivityTime(now - 7200000, now)).toBe("2 hours ago");
  expect(relativeActivityTime(now - 86400000, now)).toBe("yesterday");
});
