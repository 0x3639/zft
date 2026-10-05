import { afterEach, expect, it, vi } from "vitest";
import { inactivityLock } from "../apps/web/src/inactivity";
afterEach(() => vi.useRealTimers());
it("locks after user inactivity, defers an in-flight action, and does not treat background work as user activity", () => {
  vi.useFakeTimers();
  const target = new EventTarget(),
    lock = vi.fn();
  let busy = false;
  const cleanup = inactivityLock(target, lock, () => busy, 30000);
  vi.advanceTimersByTime(15000);
  target.dispatchEvent(new Event("keydown"));
  vi.advanceTimersByTime(15000);
  expect(lock).not.toHaveBeenCalled();
  busy = true;
  vi.advanceTimersByTime(30000);
  expect(lock).not.toHaveBeenCalled();
  busy = false;
  vi.advanceTimersByTime(15000);
  expect(lock).toHaveBeenCalledOnce();
  cleanup();
  vi.advanceTimersByTime(30000);
  expect(lock).toHaveBeenCalledOnce();
});
