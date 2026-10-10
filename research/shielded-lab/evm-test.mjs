// Disposable local EVM support only. Never accepts a remote URL or user account.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
export const lab = fileURLToPath(new URL("./", import.meta.url));
export const root = resolve(lab, "../..");
export const artifacts = () =>
  JSON.parse(readFileSync(resolve(lab, "build/contracts.json"), "utf8"))
    .contracts;
export async function startAnvil() {
  const reservation = createServer();
  await new Promise((yes, no) => {
    reservation.once("error", no);
    reservation.listen(0, "127.0.0.1", yes);
  });
  const port = reservation.address().port;
  await new Promise((yes) => reservation.close(yes));
  const child = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/@foundry-rs/anvil/bin.mjs"),
      "--silent",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--hardfork",
      "cancun",
      "--gas-limit",
      "30000000",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let startupError;
  child.once("error", (e) => (startupError = e));
  child.stderr.on("data", () => {});
  const url = `http://127.0.0.1:${port}`,
    transport = http(url, { timeout: 2000, retryCount: 0 });
  const client = createPublicClient({
    chain: foundry,
    transport,
    pollingInterval: 50,
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((yes) => child.once("exit", yes));
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null && child.signalCode === null)
      throw Error("Disposable Anvil did not exit");
  };
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw Error("Disposable Anvil exited");
      try {
        ready = (await client.getChainId()) === 31337;
        if (ready) break;
      } catch {}
      await delay(50);
    }
    if (!ready) throw Error("Disposable Anvil unavailable");
    const account = privateKeyToAccount(generatePrivateKey()),
      wallet = createWalletClient({ chain: foundry, transport, account });
    await client.request({
      method: "anvil_setBalance",
      params: [account.address, "0x3635c9adc5dea00000"],
    });
    async function deploy(artifact, args = []) {
      const hash = await wallet.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress)
        throw Error("Local deployment failed");
      return receipt.contractAddress.toLowerCase();
    }
    async function write(address, abi, functionName, args = []) {
      const hash = await wallet.writeContract({
        address,
        abi,
        functionName,
        args,
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw Error("Local transaction reverted");
      return receipt;
    }
    return {
      url,
      client,
      wallet,
      account,
      deploy,
      write,
      stop,
      mine: async (n = 1) =>
        client.request({
          method: "anvil_mine",
          params: ["0x" + n.toString(16)],
        }),
    };
  } catch (e) {
    await stop();
    throw e;
  }
}
