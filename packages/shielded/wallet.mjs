import { encodeFunctionData, parseAbi, createPublicClient, custom } from "viem";
import { verifyDeployment } from "../../research/shielded-lab/chain.mjs";
import { check } from "../../research/shielded-lab/core.mjs";
export const creationTypes = {
  Create: [
    { name: "imageHash", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" },
    { name: "commitment", type: "uint256" },
    { name: "creator", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
export const authorizationArgs = (a) => ({
  ...a,
  commitment: BigInt(a.commitment),
  nonce: BigInt(a.nonce),
  deadline: BigInt(a.deadline),
});
export const transactionAbi = parseAbi([
  "function creatorNonces(address) view returns (uint256)",
  "function creationCommits(bytes32) view returns (uint256)",
  "function commitmentDigest((bytes32 imageHash,bytes32 metadataHash,uint256 commitment,address creator,uint256 nonce,uint256 deadline),bytes32) view returns (bytes32)",
  "function commitCreate(bytes32)",
  "function create((bytes32 imageHash,bytes32 metadataHash,uint256 commitment,address creator,uint256 nonce,uint256 deadline),bytes32,bytes,bytes) returns (bytes32)",
  "function spend(uint256,uint256,uint256,bytes)",
  "function nullifiers(uint256) view returns (bool)",
]);
// A wallet signs only public creator authorization and public transaction calldata.
// No note, image, password, recovery record or private witness enters this adapter.
export async function connectWallet(provider, pins) {
  check(
    provider && typeof provider.request === "function",
    "Wallet unavailable",
  );
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  check(
    Array.isArray(accounts) && /^0x[0-9a-fA-F]{40}$/.test(accounts[0]),
    "Wallet account unavailable",
  );
  const address = accounts[0].toLowerCase();
  let closed = false;
  const invalidate = () => {
    closed = true;
  };
  provider.on?.("accountsChanged", invalidate);
  provider.on?.("chainChanged", invalidate);
  provider.on?.("disconnect", invalidate);
  const walletChain = createPublicClient({
    transport: custom(provider, { retryCount: 0 }),
  });
  async function assertCurrent() {
    check(!closed, "Reconnect the selected wallet");
    const [chain, current] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);
    check(
      typeof chain === "string" &&
        /^0x[0-9a-f]+$/i.test(chain) &&
        BigInt(chain) === BigInt(pins.chainId) &&
        Array.isArray(current) &&
        current[0]?.toLowerCase() === address &&
        !closed,
      "Wallet chain or account changed",
    );
    await verifyDeployment(walletChain, pins);
    check(!closed, "Reconnect the selected wallet");
  }
  const close = () => {
    closed = true;
    for (const event of ["accountsChanged", "chainChanged", "disconnect"])
      provider.removeListener?.(event, invalidate);
  };
  try {
    await assertCurrent();
  } catch (e) {
    close();
    throw e;
  }
  return {
    address,
    assertCurrent,
    close,
    async signCreation(a) {
      await assertCurrent();
      check(a.creator === address);
      const message = {
        domain: {
          name: "ZFT Shielded Registry",
          version: "1",
          chainId: Number(pins.chainId),
          verifyingContract: pins.contracts.registry.address,
        },
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...creationTypes,
        },
        primaryType: "Create",
        message: a,
      };
      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [address, JSON.stringify(message)],
      });
      await assertCurrent();
      check(
        typeof signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(signature),
      );
      return signature.toLowerCase();
    },
    async send(functionName, args) {
      check(["commitCreate", "create", "spend"].includes(functionName));
      const data = encodeFunctionData({
        abi: transactionAbi,
        functionName,
        args,
      });
      await assertCurrent();
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: pins.contracts.registry.address,
            data,
            value: "0x0",
            chainId: "0x" + BigInt(pins.chainId).toString(16),
          },
        ],
      });
      check(typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash));
      return hash.toLowerCase();
    },
  };
}
