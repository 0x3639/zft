// Disposable browser-only test fee key. This file is never part of the app build.
import { createWalletClient, createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
const config = await (await fetch("/test/config.json")).json();
if (
  location.hostname !== "127.0.0.1" ||
  config.pins.chainId !== "31337" ||
  !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(config.rpc)
)
  throw Error("Local fixture only");
const account = privateKeyToAccount(generatePrivateKey()),
  wallet = createWalletClient({
    chain: foundry,
    transport: http(config.rpc, { retryCount: 0 }),
    account,
  });
window.ethereum = {
  async request({ method, params }) {
    if (["eth_requestAccounts", "eth_accounts"].includes(method)) {
      if (method === "eth_requestAccounts") {
        const response = await fetch("/test/fund", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: account.address.toLowerCase() }),
        });
        if (!response.ok) throw Error("Fixture funding failed");
      }
      return [account.address];
    }
    if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_signTypedData_v4") {
      if (document.getElementById("test-pause-signature").checked) {
        const approve = document.getElementById("test-approve-signature"),
          reject = document.getElementById("test-reject-signature");
        if (approve.onclick || reject.onclick)
          throw new Error("A disposable signature request is already pending");
        await new Promise((yes, no) => {
          const finish = (accepted) => {
            approve.disabled = reject.disabled = true;
            approve.onclick = reject.onclick = null;
            accepted ? yes() : no(new Error("Disposable signature declined"));
          };
          approve.disabled = reject.disabled = false;
          approve.onclick = () => finish(true);
          reject.onclick = () => finish(false);
        });
      }
      const { domain, types, primaryType, message } = JSON.parse(params[1]);
      delete types.EIP712Domain;
      return account.signTypedData({ domain, types, primaryType, message });
    }
    if (method === "eth_sendTransaction") {
      const tx = params[0];
      return wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value),
      });
    }
    if (
      [
        "eth_getBlockByNumber",
        "eth_getCode",
        "eth_call",
        "eth_blockNumber",
      ].includes(method)
    )
      return createPublicClient({
        transport: http(config.rpc, { retryCount: 0 }),
      }).request({ method, params });
    throw Error("Unsupported disposable wallet call");
  },
};
document.getElementById("test-mine").onclick = async () => {
  const response = await fetch("/test/mine", { method: "POST" });
  document.getElementById("test-state").textContent = response.ok
    ? "Advanced two disposable blocks"
    : "Local fixture unavailable";
};
document.getElementById("test-state").textContent =
  "Disposable browser fee wallet ready";
