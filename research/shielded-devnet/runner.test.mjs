import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  validateBudget,
  validateSigned,
  saveNew,
  maybe,
  CAP,
} from "./runner.mjs";
test("aggregate maximum fee reservation cannot exceed approved one-devnet-ZNN cap", () => {
  const a = { gas: "5000000", gasPrice: "100000000000" };
  assert.equal(validateBudget([a], a), CAP);
  assert.throws(
    () => validateBudget([a, a], { gas: "1", gasPrice: "1" }),
    /cap exceeded/,
  );
});
test("retained raw transaction binds exact chain, recipient, nonce, zero value and signature", async () => {
  const a = privateKeyToAccount(generatePrivateKey()),
    to = "0x" + "12".repeat(20),
    data = "0x12345678";
  const raw = await a.signTransaction({
    chainId: 7340469,
    type: "legacy",
    nonce: 0,
    to,
    data,
    value: 0n,
    gas: 30000n,
    gasPrice: 50000000000n,
  });
  const e = {
    raw,
    hash: keccak256(raw),
    to,
    data,
    nonce: 0,
    gas: "30000",
    gasPrice: "50000000000",
  };
  await validateSigned(e, a.address);
  for (const patch of [
    { to: "0x" + "13".repeat(20) },
    { nonce: 1 },
    { data: "0x" },
    { gas: "30001" },
    { gasPrice: "1" },
    { hash: "0x" + "00".repeat(32) },
  ])
    await assert.rejects(
      validateSigned({ ...e, ...patch }, a.address),
      /mismatch/,
    );
  const wrong = await a.signTransaction({
    chainId: 1,
    type: "legacy",
    nonce: 0,
    to,
    data,
    value: 0n,
    gas: 30000n,
    gasPrice: 50000000000n,
  });
  await assert.rejects(
    validateSigned({ ...e, raw: wrong, hash: keccak256(wrong) }, a.address),
    /policy mismatch/,
  );
});
test("journal publication refuses overwrite and missing records do not fabricate success", () => {
  const d = mkdtempSync(join(tmpdir(), "zft-devnet-journal-"));
  try {
    assert.equal(maybe(d, "tx-000.json"), null);
    saveNew(d, "tx-000.json", { state: "uncertain" });
    const first = readFileSync(join(d, "tx-000.json"));
    assert.throws(() => saveNew(d, "tx-000.json", { state: "success" }));
    assert.deepEqual(readFileSync(join(d, "tx-000.json")), first);
    assert.deepEqual(readdirSync(d), ["tx-000.json"]);
    assert.throws(() => saveNew(d, "../escape", {}), /name/);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test("retained browser configuration stays canonical and selects the approved devnet registry", async () => {
  const { parseConfiguration } = await import(
    "../../packages/shielded/config.mjs"
  );
  const { RPC, GENESIS } = await import("./prepare.mjs");
  const { REGISTRY } = await import("./runner.mjs");
  const text = readFileSync(
    new URL("./evidence/app-config.json", import.meta.url),
    "utf8",
  );
  const config = parseConfiguration(text, "https://devnet.zenon.foo");
  assert.equal(config.rpc, RPC);
  assert.equal(config.pins.chainId, "7340469");
  assert.equal(config.pins.genesisHash, GENESIS);
  assert.equal(config.pins.contracts.registry.address, REGISTRY);
  assert.throws(() =>
    parseConfiguration(text + "\n", "https://devnet.zenon.foo"),
  );
});
