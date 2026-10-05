import { afterEach, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { signedRequest } from "../apps/web/src/api";
import { key } from "./fixtures";
import { verifyMessage } from "viem";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const origin = "https://devnet.zft.foo";
function setup(change: Record<string, unknown> = {}) {
  vi.stubGlobal("location", { origin });
  const account = privateKeyToAccount(key),
    sign = vi.fn(account.signMessage);
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/challenges")
      return Response.json({
        ...JSON.parse(String(init!.body)),
        id: crypto.randomUUID(),
        origin,
        expires: Math.floor(Date.now() / 1000) + 300,
        ...change,
      });
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);
  return { account, sign, fetch };
}
it("binds profile authentication to the exact request and uses the selected signer", async () => {
  const s = setup(),
    current = vi.fn(async () => {});
  await signedRequest(
    "/api/profile",
    { name: "Wallet collector" },
    { address: s.account.address, signMessage: s.sign, assertCurrent: current },
  );
  const challengeCall = s.fetch.mock.calls[0],
    posted = s.fetch.mock.calls[1];
  expect(JSON.parse(String(challengeCall[1]!.body))).toMatchObject({
    address: s.account.address,
    method: "POST",
    path: "/api/profile",
  });
  expect(posted[0]).toBe("/api/profile");
  expect(
    await verifyMessage({
      address: s.account.address,
      message: s.sign.mock.calls[0][0].message!,
      signature: new Headers(posted[1]!.headers).get(
        "x-zft-signature",
      ) as `0x${string}`,
    }),
  ).toBe(true);
  expect(current).toHaveBeenCalledTimes(2);
});
it.each([
  { method: "PUT" },
  { origin: "https://other.example" },
  { path: "/api/uploads" },
  { bodyHash: `0x${"1".repeat(64)}` },
  { expires: 1 },
  { address: "0x1111111111111111111111111111111111111111" },
])(
  "rejects a mismatched challenge before any signature: %j",
  async (change) => {
    const s = setup(change);
    await expect(
      signedRequest(
        "/api/profile",
        { name: "Collector" },
        { address: s.account.address, signMessage: s.sign },
      ),
    ).rejects.toThrow("Unexpected request challenge");
    expect(s.sign).not.toHaveBeenCalled();
    expect(s.fetch).toHaveBeenCalledOnce();
  },
);
it("does not send a signed request after the active identity changes", async () => {
  const s = setup();
  let active = true;
  await expect(
    signedRequest(
      "/api/social",
      { kind: "like", target: s.account.address, active: true },
      {
        address: s.account.address,
        async assertCurrent() {
          if (!active) throw new Error("Selected identity changed");
        },
        async signMessage(input) {
          active = false;
          return s.account.signMessage(input);
        },
      },
    ),
  ).rejects.toThrow("Selected identity changed");
  expect(s.fetch).toHaveBeenCalledOnce();
});
