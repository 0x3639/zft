import { it, expect, vi } from "vitest";
import { ensureNetwork, network, isZVMChain } from "../apps/web/src/wallet";
import { profileLocation } from "../apps/web/src/site-controls";
it("adds only the pinned devnet after unknown-chain response and verifies the resulting chain", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce({ code: 4902 })
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(network.chainId);
  await ensureNetwork({ request });
  expect(request.mock.calls.map((c) => c[0].method)).toEqual([
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
  expect(request.mock.calls[1][0].params).toEqual([network]);
});
it("does not add a chain after rejection and refuses a provider still on the wrong network", async () => {
  const rejected = vi.fn().mockRejectedValue({ code: 4001 });
  await expect(ensureNetwork({ request: rejected })).rejects.toMatchObject({
    code: 4001,
  });
  expect(rejected).toHaveBeenCalledTimes(1);
  await expect(
    ensureNetwork({
      request: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("0x1"),
    }),
  ).rejects.toThrow("Switch MetaMask");
  expect(isZVMChain("nonsense")).toBe(false);
  expect(isZVMChain(network.chainId)).toBe(true);
});
it("accepts only ZFT profile addresses or recognized profile links", () => {
  const a = "0x1111111111111111111111111111111111111111";
  expect(profileLocation(` ${a} `, "http://localhost:5173")).toBe(`/p/${a}`);
  expect(
    profileLocation(
      `https://devnet.zft.foo/p/${a}?nft=1`,
      "http://localhost:5173",
    ),
  ).toBe(`/p/${a}`);
  expect(() =>
    profileLocation(`https://evil.example/p/${a}`, "http://localhost:5173"),
  ).toThrow();
  expect(() => profileLocation("not-a-key", "http://localhost:5173")).toThrow();
});
