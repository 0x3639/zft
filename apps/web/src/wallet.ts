import { getAddress, type Address } from "viem";
import { CHAIN_ID, RPC_URL } from "../../../packages/protocol";
export type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
  isMetaMask?: boolean;
};
export type WalletChoice = {
  info: { uuid: string; name: string; rdns: string };
  provider: WalletProvider;
};
export type WalletSession = {
  provider: WalletProvider;
  account: Address;
  chainId: string;
  isCurrent?: () => boolean;
};
export async function assertWallet(session: WalletSession) {
  if (session.isCurrent && !session.isCurrent())
    throw new Error(
      "Wallet session changed. Review the selected wallet before continuing.",
    );
  const chainId = await session.provider.request({ method: "eth_chainId" });
  const account = walletAccount(
    await session.provider.request({ method: "eth_accounts" }),
  );
  if (!isZVMChain(chainId))
    throw new Error("Switch your wallet to ZVM Devnet before continuing.");
  if (!account || account.toLowerCase() !== session.account.toLowerCase())
    throw new Error(
      "The wallet account changed. Review the selected account and try again.",
    );
  if (session.isCurrent && !session.isCurrent())
    throw new Error(
      "Wallet session changed. Review the selected wallet before continuing.",
    );
}
export const network = {
  chainId: `0x${CHAIN_ID.toString(16)}`,
  chainName: "ZVM Devnet",
  nativeCurrency: { name: "Devnet ZNN", symbol: "ZNN", decimals: 18 },
  rpcUrls: [RPC_URL],
  blockExplorerUrls: ["https://devnet.zenon.foo/explorer/"],
};
export async function ensureNetwork(provider: WalletProvider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.chainId }],
    });
  } catch (e) {
    const error = e as {
      code?: number;
      data?: { originalError?: { code?: number } };
    };
    if (error.code !== 4902 && error.data?.originalError?.code !== 4902)
      throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [network],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.chainId }],
    });
  }
  if (
    BigInt(String(await provider.request({ method: "eth_chainId" }))) !==
    BigInt(CHAIN_ID)
  )
    throw new Error("Switch MetaMask to ZVM Devnet before continuing.");
}
export function walletAccount(value: unknown): Address | undefined {
  return Array.isArray(value) && typeof value[0] === "string"
    ? getAddress(value[0])
    : undefined;
}
export function isZVMChain(value: unknown) {
  try {
    return (
      typeof value === "string" &&
      /^0x[\da-f]+$/i.test(value) &&
      BigInt(value) === BigInt(CHAIN_ID)
    );
  } catch {
    return false;
  }
}
