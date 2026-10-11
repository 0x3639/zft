import test from "node:test";
import assert from "node:assert/strict";
import { startAnvil } from "../evm-test.mjs";
import { deployStateFixture } from "./registry-state-support.mjs";
import { authorizeCreation, authorizationArgs } from "../local-fixture.mjs";
const hash = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");

test("registry state-only reduced-depth fixture retains closed roots and global spent/commitment state", async () => {
  const evm = await startAnvil();
  try {
    const { address, abi } = await deployStateFixture(evm),
      read = (name, args = []) =>
        evm.client.readContract({ address, abi, functionName: name, args });
    const initial = await read("root");
    let first, closed;
    for (let i = 0; i < 72; i++) {
      await evm.write(address, abi, "spend", [
        await read("root"),
        BigInt(1000 + i),
        BigInt(i + 1),
        "0x",
      ]);
      if (i === 0) first = await read("root");
      if (i === 7) closed = await read("root");
    }
    assert.equal(
      await read("retainedRoots", [first]),
      0n,
      "Recent-root window expires old nonfinal roots",
    );
    assert.equal(
      await read("retainedRoots", [closed]),
      0n,
      "Final-root acceptance must survive recent-root eviction",
    );
    assert.equal(
      await read("closedRoots", [closed]),
      true,
      "Full tree retains its final root",
    );
    await assert.doesNotReject(
      evm.write(address, abi, "spend", [closed, 9000n, 500n, "0x"]),
      "Closed-root spend must succeed",
    );
    assert.equal(
      await read("successor", [9000n]),
      500n,
      "Old closed-tree root remains spendable",
    );
    await assert.rejects(
      evm.write(address, abi, "spend", [closed, 1000n, 501n, "0x"]),
      "Global nullifier cannot reset on rollover",
    );
    await assert.rejects(
      evm.write(address, abi, "spend", [closed, 9001n, 1n, "0x"]),
      "Global commitment cannot be reused after rollover",
    );
    assert.equal(
      await read("nullifiers", [9001n]),
      false,
      "Failed append rolls back nullifier write",
    );
    await assert.rejects(
      evm.write(address, abi, "spend", [first, 9002n, 502n, "0x"]),
    );
    await assert.rejects(
      evm.write(address, abi, "spend", [123n, 9003n, 503n, "0x"]),
    );
    assert.equal(await read("nextIndex"), 73n);
  } finally {
    await evm.stop();
  }
});
test("registry state-only fixture enforces creator authorization, image uniqueness and commit windows", async () => {
  const evm = await startAnvil();
  try {
    const { address, abi } = await deployStateFixture(evm),
      d = { chainId: "31337", registry: address },
      creator = evm.account.address.toLowerCase();
    const read = (name, args = []) =>
      evm.client.readContract({ address, abi, functionName: name, args });
    const note = {
      imageHash: hash(1),
      metadataHash: hash(2),
      commitment: "1",
      metadata: { creator },
    };
    const authorization = await authorizeCreation(evm, d, note),
      a = authorizationArgs(authorization.authorization);
    const commit = await read("commitmentDigest", [a, authorization.salt]);
    await evm.write(address, abi, "commitCreate", [commit]);
    await assert.rejects(
      evm.write(address, abi, "create", [
        a,
        authorization.salt,
        authorization.signature,
        "0x",
      ]),
      "Reveal delay enforced",
    );
    await evm.mine(2);
    await evm.write(address, abi, "create", [
      a,
      authorization.salt,
      authorization.signature,
      "0x",
    ]);
    const duplicate = await authorizeCreation(
        evm,
        d,
        { ...note, metadataHash: hash(3), commitment: "2" },
        "1",
      ),
      da = authorizationArgs(duplicate.authorization);
    await evm.write(address, abi, "commitCreate", [
      await read("commitmentDigest", [da, duplicate.salt]),
    ]);
    await evm.mine(2);
    await assert.rejects(
      evm.write(address, abi, "create", [
        da,
        duplicate.salt,
        duplicate.signature,
        "0x",
      ]),
      "Same image cannot be issued with changed metadata",
    );
    const different = await authorizeCreation(
        evm,
        d,
        { ...note, imageHash: hash(4), commitment: "3" },
        "1",
      ),
      changed = authorizationArgs(different.authorization);
    await evm.write(address, abi, "commitCreate", [
      await read("commitmentDigest", [changed, different.salt]),
    ]);
    await evm.mine(2);
    await assert.rejects(
      evm.write(address, abi, "create", [
        changed,
        different.salt,
        authorization.signature,
        "0x",
      ]),
      "Creator signature binds exact declared asset/output",
    );
    await evm.mine(257);
    await assert.rejects(
      evm.write(address, abi, "create", [
        changed,
        different.salt,
        different.signature,
        "0x",
      ]),
      "Commit maximum age enforced",
    );
    assert.equal(await read("nextIndex"), 1n);
    assert.equal(await read("creatorNonces", [creator]), 1n);
  } finally {
    await evm.stop();
  }
});
