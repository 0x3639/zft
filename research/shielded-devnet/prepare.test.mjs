import test from "node:test";
import assert from "node:assert/strict";
import {
  readonlyRpc,
  identity,
  feePolicy,
  RPC,
  CHAIN_ID,
  GENESIS,
} from "./prepare.mjs";

test("devnet reader cannot broadcast, fund, or redirect requests to another network", async () => {
  const seen = [],
    rpc = readonlyRpc(async (url, options) => {
      seen.push({ url, options });
      const body = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: CHAIN_ID }),
      );
    });
  for (const method of [
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "anvil_setBalance",
    "wallet_addEthereumChain",
  ])
    await assert.rejects(rpc(method, []), /Read-only method required/);
  assert.equal(seen.length, 0);
  assert.equal(await rpc("eth_chainId"), CHAIN_ID);
  assert.equal(seen[0].url, RPC);
  assert.equal(seen[0].options.redirect, "error");
});

test("wrong chain or same-chain wrong genesis stops before head qualification", async () => {
  for (const [chain, genesis] of [
    ["0x1", GENESIS],
    [CHAIN_ID, "0x" + "00".repeat(32)],
  ]) {
    const calls = [];
    await assert.rejects(
      identity(async (method, params) => {
        calls.push({ method, params });
        return method === "eth_chainId" ? chain : { hash: genesis };
      }),
      /identity mismatch/,
    );
    assert.equal(calls.filter((c) => c.params?.[0] === "latest").length, 0);
  }
});

test("RPC rejects unrelated envelopes, provider errors, oversized bodies and HTTP failure", async () => {
  const cases = [
    () => new Response('{"jsonrpc":"2.0","id":999,"result":"0x1"}'),
    () =>
      new Response(
        '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"provider detail"}}',
      ),
    () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
    () => new Response("provider detail", { status: 503 }),
  ];
  for (const make of cases) {
    const rpc = readonlyRpc(async () => make());
    await assert.rejects(
      rpc("eth_chainId"),
      (e) => e instanceof Error && !e.message.includes("provider detail"),
    );
  }
});

test("fee plan uses integer ceiling and rejects out-of-policy gas or price", () => {
  assert.deepEqual(feePolicy("101", "1"), {
    gas: "122",
    gasPrice: "50000000002",
    maxFeeWei: "6100000000244",
  });
  for (const [gas, price] of [
    [0, 1],
    [1, -1],
    [5000000, 1],
    [1, 100000000000],
    [-1, 1],
  ])
    assert.throws(() => feePolicy(gas, price), /cap/);
});
