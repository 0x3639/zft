import {
  stringToHex,
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import {
  domain,
  mintTypes,
  rotationTypes,
  mintMessage,
  rotationMessage,
  type Deployment,
  type Mint,
  type Rotation,
} from "../../../packages/protocol";
import { assertWallet, type WalletSession } from "./wallet";

export type Identity = {
  address: Address;
  signMessage: (input: { message: string }) => Promise<Hex>;
  assertCurrent?: () => Promise<void>;
};

export function walletIdentity(session: WalletSession): Identity {
  return {
    address: session.account,
    assertCurrent: () => assertWallet(session),
    async signMessage({ message }) {
      await assertWallet(session);
      const signature = await session.provider.request({
        method: "personal_sign",
        params: [stringToHex(message), session.account],
      });
      await assertWallet(session);
      if (
        typeof signature !== "string" ||
        !/^0x[\da-fA-F]{130}$/.test(signature) ||
        !(await verifyMessage({
          address: session.account,
          message,
          signature: signature as Hex,
        }))
      )
        throw new Error(
          "The wallet returned a signature for a different request.",
        );
      return signature as Hex;
    },
  };
}

export async function signWalletOperation(
  session: WalletSession,
  d: Deployment,
  kind: "mint" | "rotate",
  authorization: Mint | Rotation,
): Promise<Hex> {
  await assertWallet(session);
  const types = kind === "mint" ? mintTypes : rotationTypes;
  const primaryType = kind === "mint" ? "Mint" : "RotateOwnership";
  const signature = await session.provider.request({
    method: "eth_signTypedData_v4",
    params: [
      session.account,
      JSON.stringify({
        domain: domain(d.contract),
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...types,
        },
        primaryType,
        message: authorization,
      }),
    ],
  });
  await assertWallet(session);
  if (
    typeof signature !== "string" ||
    !/^0x[\da-fA-F]{130}$/.test(signature) ||
    !(await (kind === "mint"
      ? verifyTypedData({
          address: session.account,
          domain: domain(d.contract),
          types: mintTypes,
          primaryType: "Mint",
          message: mintMessage(authorization as Mint),
          signature: signature as Hex,
        })
      : verifyTypedData({
          address: session.account,
          domain: domain(d.contract),
          types: rotationTypes,
          primaryType: "RotateOwnership",
          message: rotationMessage(authorization as Rotation),
          signature: signature as Hex,
        })))
  )
    throw new Error(
      "The wallet returned a signature for a different authorization.",
    );
  return signature as Hex;
}
