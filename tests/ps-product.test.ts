import { afterEach, expect, it, vi } from "vitest";
import {
  PsBridge,
  localLaunch,
  route,
  itemPath,
  readEncrypted,
} from "../apps/web/src/ps/bridge";
class FakeWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  messages: any[] = [];
  terminated = false;
  postMessage(value: unknown) {
    this.messages.push(value);
  }
  terminate() {
    this.terminated = true;
  }
  reply(value: unknown) {
    this.onmessage?.({ data: value });
  }
}
afterEach(() => vi.useRealTimers());
it("PS launch accepts only exact loopback capabilities, never file-selected issuer origins", () => {
  const token = "ab".repeat(32);
  expect(localLaunch(new URL(`http://127.0.0.1:4444/ps/#${token}`))).toBe(
    token,
  );
  for (const url of [
    `https://devnet.zft.foo/ps/#${token}`,
    `http://127.0.0.1.evil.test:4444/ps/#${token}`,
    `http://localhost:4444/ps/#${token}`,
    "http://127.0.0.1:4444/ps/",
    `http://127.0.0.1/ps/#${token}`,
  ])
    expect(() => localLaunch(new URL(url))).toThrow();
});
it("PS item routes include issuer realm and full credential ID with no v1 fallback", () => {
  const realm = "ab".repeat(32),
    id = "cd".repeat(48);
  expect(route(itemPath(realm, id))).toEqual({ page: "item", realm, id });
  for (const url of [
    `/ps/item/${id}`,
    `/ps/item/${realm}/${id}?issuer=evil`,
    "/item/1",
    `/ps/item/${realm}/../1`,
    "/ps-evil",
  ])
    expect(route(url).page).toBe("missing");
});
it("the PS bridge rejects late replies after lock and after a new worker is started", async () => {
  const workers: FakeWorker[] = [];
  const bridge = new PsBridge(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  });
  bridge.start();
  const first = bridge.call("open");
  const rejected = expect(first).rejects.toThrow(/Locked/);
  bridge.lock();
  await rejected;
  expect(workers[0].terminated).toBe(true);
  bridge.start();
  const second = bridge.call("open");
  const id = workers[1].messages[0].id;
  workers[0].reply({ id, ok: true, result: { id: "stale secret" } });
  workers[1].reply({ id, ok: true, result: { id: "fresh result" } });
  await expect(second).resolves.toEqual({ id: "fresh result" });
  bridge.lock();
});
it("the PS bridge serializes requests and reserves its message ID and action fields", async () => {
  const w = new FakeWorker(),
    bridge = new PsBridge(() => w as unknown as Worker);
  bridge.start();
  const r = bridge.call("backup", { id: 9, action: "submit" });
  expect(w.messages[0]).toEqual({ id: 1, action: "backup" });
  await expect(bridge.call("submit")).rejects.toThrow(/Wait/);
  w.reply({ id: 1, ok: false });
  await expect(r).rejects.toThrow(/Keep your recovery/);
  bridge.lock();
});
it("an unresponsive Worker is terminated and rejects the caller without discarding stored recovery", async () => {
  vi.useFakeTimers();
  const w = new FakeWorker(),
    bridge = new PsBridge(() => w as unknown as Worker, 100);
  bridge.start();
  const r = bridge.call("submit");
  const rejected = expect(r).rejects.toThrow(/Keep recovery/);
  vi.advanceTimersByTime(100);
  await rejected;
  expect(w.terminated).toBe(true);
  await expect(bridge.call("recover")).rejects.toThrow(/Unlock/);
});
it("encrypted file reading bounds size before reading and rejects invalid UTF-8", async () => {
  const arrayBuffer = vi.fn();
  await expect(
    readEncrypted({ size: 2_101_249, arrayBuffer } as unknown as File),
  ).rejects.toThrow(/no larger/);
  expect(arrayBuffer).not.toHaveBeenCalled();
  await expect(
    readEncrypted(new File([new Uint8Array([0xff])], "bad.json")),
  ).rejects.toThrow();
  await expect(
    readEncrypted(new File(['{"example":1}'], "good.json")),
  ).resolves.toBe('{"example":1}');
});
