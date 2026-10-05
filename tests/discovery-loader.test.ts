import { expect, it, vi } from "vitest";
import { DiscoveryLoader } from "../apps/web/src/discovery-loader";
import { ApiError } from "../apps/web/src/api";
const page = (ids: string[], nextCursor: string | null = null) => ({
  items: ids.map((id) => ({ id })),
  nextCursor,
  total: ids.length,
  pending: 0,
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it("suppresses stale search responses even when an aborted request finishes later", async () => {
  const old = deferred<ReturnType<typeof page>>(),
    fresh = deferred<ReturnType<typeof page>>();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise);
  const loader = new DiscoveryLoader<{ id: string }>(
    (i) => i.id,
    () => {},
    fetch,
  );
  const first = loader.reset("/api?q=old"),
    second = loader.reset("/api?q=new");
  fresh.resolve(page(["new"]));
  await second;
  old.resolve(page(["old"]));
  await first;
  expect(loader.state.items).toEqual([{ id: "new" }]);
  expect(loader.state.busy).toBe(false);
});
it("locks repeated Load more clicks, deduplicates cards and retains results through a retry", async () => {
  const delayed = deferred<ReturnType<typeof page>>();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(page(["1"], "a"))
    .mockReturnValueOnce(delayed.promise)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(page(["3"]));
  const loader = new DiscoveryLoader<{ id: string }>(
    (i) => i.id,
    () => {},
    fetch,
  );
  await loader.reset("/api?q=");
  const pending = loader.load(true);
  await loader.load(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  delayed.resolve(page(["1", "2"], "b"));
  await pending;
  expect(loader.state.items).toEqual([{ id: "1" }, { id: "2" }]);
  await loader.load(true);
  expect(loader.state.error).toBe("offline");
  expect(loader.state.nextCursor).toBe("b");
  expect(loader.state.items).toHaveLength(2);
  await loader.load(true);
  expect(loader.state.items).toHaveLength(3);
  expect(loader.state.nextCursor).toBeNull();
  await loader.load(true);
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("requires refresh after a changed snapshot and ignores errors after leaving the page", async () => {
  const delayed = deferred<ReturnType<typeof page>>();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(page(["1"], "a"))
    .mockRejectedValueOnce(new ApiError(409, "changed"))
    .mockReturnValueOnce(delayed.promise);
  const changed = vi.fn(),
    loader = new DiscoveryLoader<{ id: string }>((i) => i.id, changed, fetch);
  await loader.reset("/api?q=");
  await loader.load(true);
  expect(loader.state.stale).toBe(true);
  expect(loader.state.items).toHaveLength(1);
  await loader.load(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  const restart = loader.reset("/api?q=");
  loader.stop();
  const calls = changed.mock.calls.length;
  delayed.reject(new Error("late failure"));
  await restart;
  expect(changed).toHaveBeenCalledTimes(calls);
});
