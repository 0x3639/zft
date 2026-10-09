import { expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { hexToString, type Hex } from "viem";
import { connectPsWallet, signPsPresentation } from "../apps/web/src/ps/wallet";
// @ts-expect-error The isolated research verifier is untyped JavaScript.
import { verifyEndorsement } from "../research/ps-lab/local/presentation.mjs";
const signer = privateKeyToAccount(("0x" + "11".repeat(32)) as Hex);
const message = "ZFT PS public artwork evidence\nPUBLIC test fixture ü";
function provider(change?: string) {
  let selected = signer.address,
    chain = "0x1";
  const listeners = new Map<string, (value: unknown) => void>();
  const request = vi.fn(
    async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [selected];
      if (method === "eth_chainId") return chain;
      if (method === "personal_sign") {
        expect(params![1]).toBe(signer.address);
        const signature = await signer.signMessage({
          message:
            change === "wrong" ? "different" : hexToString(params![0] as Hex),
        });
        if (change === "account")
          selected = "0x2222222222222222222222222222222222222222";
        if (change === "chain") chain = "0x2";
        if (change === "disconnect") listeners.get("disconnect")?.(undefined);
        return signature;
      }
      throw new Error("Unexpected RPC: " + method);
    },
  );
  return {
    request,
    on: (e: string, f: (value: unknown) => void) => {
      listeners.set(e, f);
    },
    removeListener: (e: string) => {
      listeners.delete(e);
    },
    listeners,
  };
}
it("PS signing uses account requests and personal_sign without an RPC code lookup", async () => {
  const p = provider(),
    s = await connectPsWallet(p),
    signature = await signPsPresentation(s, message);
  expect(
    verifyEndorsement(message, signature, s.account.slice(2).toLowerCase()),
  ).toBe(true);
  expect(p.request.mock.calls.map((c) => c[0].method)).not.toContain(
    "eth_getCode",
  );
  s.disconnect();
  expect(p.listeners.size).toBe(0);
});
it.each(["account", "chain", "disconnect", "wrong"])(
  "PS signing rejects %s changes before publication",
  async (change) => {
    const p = provider(change),
      s = await connectPsWallet(p);
    await expect(signPsPresentation(s, message)).rejects.toThrow();
    s.disconnect();
  },
);
it("PS signing rejects unscoped requests before prompting the wallet", async () => {
  const p = provider(),
    s = await connectPsWallet(p);
  p.request.mockClear();
  await expect(signPsPresentation(s, "transfer everything")).rejects.toThrow(
    "Unexpected",
  );
  expect(p.request).not.toHaveBeenCalled();
  s.disconnect();
});
