import { afterEach, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { signedRequest } from "../apps/web/src/api";
import { key } from "./fixtures";
import { hexToString, verifyMessage, type Hex } from "viem";
import { walletIdentity } from "../apps/web/src/identity";
import { network, type WalletSession } from "../apps/web/src/wallet";
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
it.each(["unchanged", "account", "network", "disconnect"])(
  "checks the wallet profile session after signing: %s",
  async (change) => {
    const s = setup();
    let address = s.account.address,
      chain = network.chainId,
      connected = true;
    const request = vi.fn(async ({ method, params }) => {
      if (method === "eth_accounts") return [address];
      if (method === "eth_chainId") return chain;
      if (method === "personal_sign") {
        expect(params[1]).toBe(s.account.address);
        const signature = await s.account.signMessage({
          message: hexToString(params[0] as Hex),
        });
        if (change === "account")
          address = "0x1111111111111111111111111111111111111111";
        if (change === "network") chain = "0x1";
        if (change === "disconnect") connected = false;
        return signature;
      }
      throw new Error(`Unexpected method ${method}`);
    });
    const session: WalletSession = {
      account: s.account.address,
      chainId: network.chainId,
      isCurrent: () => connected,
      provider: { request },
    };
    const result = signedRequest(
      "/api/profile",
      { name: "Wallet profile", bio: "", featured: null, revision: 0 },
      walletIdentity(session),
    );
    if (change === "unchanged") {
      await expect(result).resolves.toEqual({ ok: true });
      expect(s.fetch).toHaveBeenCalledTimes(2);
      expect(s.fetch.mock.calls[1][0]).toBe("/api/profile");
    } else {
      await expect(result).rejects.toThrow();
      expect(s.fetch).toHaveBeenCalledOnce();
    }
    expect(JSON.parse(String(s.fetch.mock.calls[0][1]!.body)).address).toBe(
      s.account.address,
    );
  },
);
