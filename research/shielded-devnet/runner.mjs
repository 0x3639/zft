// Bounded experiment runner, authorized only for the selected ZVM devnet.
import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  linkSync,
  unlinkSync,
  readdirSync,
  lstatSync,
} from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  custom,
  defineChain,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RPC, CHAIN_ID, GENESIS, feePolicy } from "./prepare.mjs";
export const CAP = 10n ** 18n;
export const REGISTRY = "0x94bd9f5181a28120f2a02cb5cbc276b641ad6da0";
const selectors = new Set([
  toFunctionSelector("commitCreate(bytes32)"),
  toFunctionSelector(
    "create((bytes32,bytes32,uint256,address,uint256,uint256),bytes32,bytes,bytes)",
  ),
  toFunctionSelector("spend(uint256,uint256,uint256,bytes)"),
]);
const reads = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionCount",
  "eth_getBalance",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_blockNumber",
  "eth_getLogs",
]);
export function check(ok, message = "Devnet experiment check failed") {
  if (!ok) throw Error(message);
}
export function json(value) {
  return (
    JSON.stringify(
      value,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ) + "\n"
  );
}
export function saveNew(directory, name, value) {
  check(/^[a-z0-9.-]+$/.test(name), "Invalid journal name");
  const target = resolve(directory, name),
    temp = resolve(directory, ".pending-" + randomUUID());
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, typeof value === "string" ? value : json(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temp, target);
    const dir = openSync(directory, "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } finally {
    unlinkSync(temp);
  }
}
export function maybe(directory, name) {
  try {
    return JSON.parse(readFileSync(resolve(directory, name), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw Error("Invalid retained journal");
  }
}
export function validateBudget(entries, next) {
  const total = [...entries, next].reduce(
    (sum, e) => sum + BigInt(e.gas) * BigInt(e.gasPrice),
    0n,
  );
  check(total <= CAP, "Approved total fee cap exceeded");
  return total;
}
export async function validateSigned(entry, address) {
  const tx = parseTransaction(entry.raw);
  check(
    keccak256(entry.raw) === entry.hash &&
      (
        await recoverTransactionAddress({ serializedTransaction: entry.raw })
      ).toLowerCase() === address.toLowerCase(),
    "Signed journal mismatch",
  );
  check(
    tx.chainId === Number(BigInt(CHAIN_ID)) &&
      tx.type === "legacy" &&
      (tx.value ?? 0n) === 0n &&
      tx.data === entry.data &&
      (tx.to?.toLowerCase() ?? null) === (entry.to ?? null) &&
      tx.nonce === entry.nonce &&
      tx.gas === BigInt(entry.gas) &&
      tx.gasPrice === BigInt(entry.gasPrice),
    "Transaction policy mismatch",
  );
  check(
    tx.gas > 0n &&
      tx.gas <= 5_000_000n &&
      tx.gasPrice > 0n &&
      tx.gasPrice <= 100_000_000_000n,
    "Transaction fee policy mismatch",
  );
}
export async function withRunner(directory, plan, work) {
  const stat = lstatSync(directory);
  check(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid(),
    "Private test directory required",
  );
  const lock = openSync(resolve(directory, "run.lock"), "wx", 0o600);
  writeFileSync(lock, String(process.pid));
  fsyncSync(lock);
  try {
    const keyStat = lstatSync(resolve(directory, "fee-key.json"));
    check(
      keyStat.isFile() &&
        !keyStat.isSymbolicLink() &&
        (keyStat.mode & 0o077) === 0 &&
        keyStat.uid === process.getuid(),
      "Private disposable fee key required",
    );
    const key = maybe(directory, "fee-key.json"),
      account = privateKeyToAccount(key.privateKey);
    check(
      account.address.toLowerCase() === plan.feeAccount.toLowerCase(),
      "Fee account differs from approved plan",
    );
    let id = 0;
    async function rpc(method, params = [], write = false) {
      check(
        reads.has(method) || (write && method === "eth_sendRawTransaction"),
        "RPC method outside experiment",
      );
      const requestId = ++id,
        response = await fetch(RPC, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            method,
            params,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
      check(response.ok, "Devnet RPC unavailable");
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          check(size <= 2 * 1024 * 1024, "RPC response exceeds limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const r = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      check(r.jsonrpc === "2.0" && r.id === requestId, "RPC response mismatch");
      if (r.error) {
        const e = Error("Devnet RPC rejected request");
        e.rpcCode = r.error.code;
        throw e;
      }
      check(Object.hasOwn(r, "result"), "RPC result absent");
      return r.result;
    }
    const chain = defineChain({
      id: Number(BigInt(CHAIN_ID)),
      name: "ZVM Devnet",
      nativeCurrency: { name: "Devnet ZNN", symbol: "ZNN", decimals: 18 },
      rpcUrls: { default: { http: [RPC] } },
    });
    const client = createPublicClient({
      chain,
      transport: custom(
        { request: ({ method, params }) => rpc(method, params ?? []) },
        { retryCount: 0 },
      ),
      pollingInterval: 2000,
    });
    async function identity() {
      check(
        (await rpc("eth_chainId")) === CHAIN_ID &&
          (await rpc("eth_getBlockByNumber", ["0x0", false])).hash === GENESIS,
        "Selected devnet identity mismatch",
      );
    }
    await identity();
    const entries = readdirSync(directory)
      .filter((n) => /^tx-[0-9]{3}\.json$/.test(n))
      .sort()
      .map((n) => maybe(directory, n));
    for (let i = 0; i < entries.length; i++) {
      check(entries[i].nonce === i, "Nonconsecutive retained transactions");
      await validateSigned(entries[i], account.address);
    }
    validateBudget(entries, { gas: "0", gasPrice: "0" });
    function policy(to, data, nonce) {
      if (nonce < 6) {
        const c = plan.contracts[nonce];
        check(
          !to &&
            c &&
            c.nonce === nonce &&
            keccak256(data) === c.initCodeKeccak256,
          "Deployment data differs from approved plan",
        );
      } else
        check(
          to === REGISTRY && selectors.has(data.slice(0, 10)),
          "Target outside isolated registry",
        );
    }
    for (const e of entries) policy(e.to, e.data, e.nonce);
    async function receipt(entry) {
      const until = Date.now() + 240000;
      while (Date.now() < until) {
        const r = await rpc("eth_getTransactionReceipt", [entry.hash]);
        if (r) {
          check(
            r.transactionHash === entry.hash && r.status === "0x1",
            "Devnet transaction reverted",
          );
          const block = await rpc("eth_getBlockByNumber", [
            r.blockNumber,
            false,
          ]);
          check(block.hash === r.blockHash, "Receipt block changed");
          const head = BigInt(await rpc("eth_blockNumber"));
          if (head >= BigInt(r.blockNumber) + 2n) {
            await identity();
            const again = await rpc("eth_getTransactionReceipt", [entry.hash]);
            check(
              again?.blockHash === r.blockHash && again.status === "0x1",
              "Receipt changed during observation",
            );
            if (
              !maybe(
                directory,
                `receipt-${String(entry.nonce).padStart(3, "0")}.json`,
              )
            )
              saveNew(
                directory,
                `receipt-${String(entry.nonce).padStart(3, "0")}.json`,
                r,
              );
            return r;
          }
        }
        await delay(2000);
      }
      throw Error("Transaction remains uncertain; retain exact signed journal");
    }
    async function send(label, to, data) {
      check(/^[a-z0-9-]+$/.test(label), "Invalid operation label");
      await identity();
      let e = entries.find((e) => e.label === label);
      if (e) {
        check(
          e.to === (to ?? null) && e.data === data,
          "Retained operation changed",
        );
        await validateSigned(e, account.address);
      } else {
        const nonce = entries.length;
        policy(to ?? null, data, nonce);
        check(
          Number(
            BigInt(
              await rpc("eth_getTransactionCount", [
                account.address,
                "pending",
              ]),
            ),
          ) === nonce &&
            Number(
              BigInt(
                await rpc("eth_getTransactionCount", [
                  account.address,
                  "latest",
                ]),
              ),
            ) === nonce,
          "Nonce not ready; reconcile prior operation",
        );
        const tx = {
          from: account.address,
          ...(to ? { to } : {}),
          data,
          value: "0x0",
          gas: "0x4c4b40",
        };
        await rpc("eth_call", [tx, "latest"]);
        const fees = feePolicy(
          await rpc("eth_estimateGas", [tx]),
          await rpc("eth_gasPrice"),
        );
        validateBudget(entries, fees);
        check(
          BigInt(await rpc("eth_getBalance", [account.address, "latest"])) >=
            BigInt(fees.maxFeeWei),
          "Disposable faucet balance insufficient",
        );
        const raw = await account.signTransaction({
          chainId: chain.id,
          type: "legacy",
          nonce,
          ...(to ? { to } : {}),
          data,
          value: 0n,
          gas: BigInt(fees.gas),
          gasPrice: BigInt(fees.gasPrice),
        });
        e = {
          label,
          nonce,
          to: to ?? null,
          data,
          ...fees,
          hash: keccak256(raw),
          raw,
        };
        await validateSigned(e, account.address);
        saveNew(directory, `tx-${String(nonce).padStart(3, "0")}.json`, e);
        entries.push(e);
      }
      policy(e.to, e.data, e.nonce);
      const known = await rpc("eth_getTransactionByHash", [e.hash]);
      if (!known) {
        check(
          Number(
            BigInt(
              await rpc("eth_getTransactionCount", [
                account.address,
                "pending",
              ]),
            ),
          ) === e.nonce,
          "Unrecognized consumed nonce; stop",
        );
        try {
          check(
            (await rpc("eth_sendRawTransaction", [e.raw], true)) === e.hash,
            "Unexpected broadcast hash",
          );
        } catch {
          if (!(await rpc("eth_getTransactionByHash", [e.hash])))
            throw Error("Broadcast uncertain; retain exact signed journal");
        }
      }
      console.log(
        JSON.stringify({
          stage: label,
          transaction: e.hash,
          nonce: e.nonce,
          status: "awaiting-observed-blocks",
        }),
      );
      const r = await receipt(e);
      console.log(
        JSON.stringify({
          stage: label,
          transaction: e.hash,
          block: r.blockNumber,
          status: "observed-success",
        }),
      );
      return r;
    }
    return await work({ account, client, rpc, identity, send, entries });
  } finally {
    closeSync(lock);
    unlinkSync(resolve(directory, "run.lock"));
  }
}
