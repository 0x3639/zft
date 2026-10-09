import {
  getAddress,
  stringToHex,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import type { WalletProvider } from "../wallet";
export type PsWallet = {
  provider: WalletProvider;
  account: Address;
  chainId: number;
  valid: () => boolean;
  disconnect: () => void;
};
function chain(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))
    throw new Error("Wallet chain ID is unavailable.");
  const n = BigInt(value);
  if (n < 1n || n > 0xffffffffn)
    throw new Error("Unsupported wallet chain ID.");
  return Number(n);
}
function account(value: unknown) {
  if (!Array.isArray(value) || typeof value[0] !== "string")
    throw new Error("Choose a wallet account.");
  return getAddress(value[0]);
}
export async function connectPsWallet(
  provider: WalletProvider,
): Promise<PsWallet> {
  let valid = true;
  const invalidate = () => {
    valid = false;
  };
  const disconnect = () => {
    invalidate();
    for (const name of ["accountsChanged", "chainChanged", "disconnect"])
      provider.removeListener?.(name, invalidate);
  };
  try {
    const selected = account(
      await provider.request({ method: "eth_requestAccounts" }),
    );
    for (const name of ["accountsChanged", "chainChanged", "disconnect"])
      provider.on?.(name, invalidate);
    const chainId = chain(await provider.request({ method: "eth_chainId" }));
    const session = {
      provider,
      account: selected,
      chainId,
      valid: () => valid,
      disconnect,
    };
    await assertPsWallet(session);
    return session;
  } catch (e) {
    disconnect();
    throw e;
  }
}
export async function assertPsWallet(s: PsWallet) {
  if (!s.valid())
    throw new Error("Wallet selection changed. Reconnect before signing.");
  const current = account(await s.provider.request({ method: "eth_accounts" }));
  const currentChain = chain(
    await s.provider.request({ method: "eth_chainId" }),
  );
  if (!s.valid() || current !== s.account || currentChain !== s.chainId)
    throw new Error("Wallet selection changed. Reconnect before signing.");
}
export async function signPsPresentation(
  s: PsWallet,
  message: string,
): Promise<Hex> {
  if (
    !message.startsWith("ZFT PS public artwork evidence\n") ||
    new TextEncoder().encode(message).length > 4096
  )
    throw new Error("Unexpected PS endorsement message.");
  await assertPsWallet(s);
  const value = await s.provider.request({
    method: "personal_sign",
    params: [stringToHex(message), s.account],
  });
  await assertPsWallet(s);
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]{130}$/i.test(value) ||
    !(await verifyMessage({
      address: s.account,
      message,
      signature: value as Hex,
    }))
  )
    throw new Error("Wallet signed a different presentation.");
  return value.toLowerCase() as Hex;
}
