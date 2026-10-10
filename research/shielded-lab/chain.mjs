import { keccak256, parseAbiItem } from "viem";
import { check, exact, uint, canonical, domain } from "./core.mjs";
const HASH = /^0x[0-9a-f]{64}$/,
  ADDRESS = /^0x[0-9a-f]{40}$/;
const names = [
  "registry",
  "hasher",
  "creationAdapter",
  "spendAdapter",
  "creationVerifier",
  "spendVerifier",
];
export const registryAbi = [
  {
    type: "function",
    name: "domain",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  ...["root", "nextIndex"].map((name) => ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  })),
  ...["hasher", "creationVerifier", "spendVerifier"].map((name) => ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  })),
  ...["commitments", "nullifiers"].map((name) => ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "bool" }],
  })),
  {
    type: "function",
    name: "successor",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
];
const adapterAbi = [
  {
    type: "function",
    name: "verifier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "plonk",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
];
export function validatePins(pins) {
  exact(pins, [
    "format",
    "chainId",
    "genesisHash",
    "deploymentBlock",
    "system",
    "contracts",
    "artifacts",
  ]);
  check(
    pins.format === "zft-shielded-local-deployment-v1" &&
      pins.system === "groth16",
    "Unsupported deployment profile",
  );
  check(uint(pins.chainId, 1n << 256n) > 0n);
  uint(pins.deploymentBlock, 1n << 256n);
  check(HASH.test(pins.genesisHash));
  exact(pins.contracts, names);
  for (const entry of Object.values(pins.contracts)) {
    exact(entry, ["address", "codeHash"]);
    check(
      ADDRESS.test(entry.address) &&
        !/^0x0{40}$/.test(entry.address) &&
        HASH.test(entry.codeHash),
    );
  }
  exact(pins.artifacts, [
    "createWasm",
    "spendWasm",
    "createKey",
    "spendKey",
    "createVerificationKey",
    "spendVerificationKey",
  ]);
  for (const h of Object.values(pins.artifacts)) check(HASH.test(h));
  check(
    new Set(Object.values(pins.contracts).map((e) => e.address)).size ===
      names.length,
    "Deployment roles must be distinct",
  );
  return structuredClone(pins);
}
export const pinDeployment = (p) => ({
  chainId: p.chainId,
  registry: p.contracts.registry.address,
});
export async function verifyDeployment(client, pins) {
  validatePins(pins);
  const [id, genesis, head] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockNumber: 0n }),
    client.getBlock(),
  ]);
  check(
    String(id) === pins.chainId && genesis.hash === pins.genesisHash,
    "Wrong chain/genesis",
  );
  check(head.number >= BigInt(pins.deploymentBlock));
  for (const c of Object.values(pins.contracts)) {
    const code = await client.getCode({
      address: c.address,
      blockNumber: head.number,
    });
    check(
      code && code !== "0x" && keccak256(code) === c.codeHash,
      "Deployment code mismatch",
    );
  }
  check(
    (await client.readContract({
      address: pins.contracts.registry.address,
      abi: registryAbi,
      functionName: "domain",
      blockNumber: head.number,
    })) === domain(pinDeployment(pins)),
    "Registry domain mismatch",
  );
  const read = (address, abi, functionName) =>
    client.readContract({
      address,
      abi,
      functionName,
      blockNumber: head.number,
    });
  for (const [getter, target] of [
    ["hasher", "hasher"],
    ["creationVerifier", "creationAdapter"],
    ["spendVerifier", "spendAdapter"],
  ])
    check(
      (
        await read(pins.contracts.registry.address, registryAbi, getter)
      ).toLowerCase() === pins.contracts[target].address,
      "Registry role mismatch",
    );
  for (const kind of ["creation", "spend"]) {
    check(
      (
        await read(
          pins.contracts[kind + "Adapter"].address,
          adapterAbi,
          "verifier",
        )
      ).toLowerCase() === pins.contracts[kind + "Verifier"].address,
    );
    check(
      (await read(
        pins.contracts[kind + "Adapter"].address,
        adapterAbi,
        "plonk",
      )) === false,
    );
  }
  check(
    (await client.getBlock({ blockNumber: head.number })).hash === head.hash,
    "Chain changed during pin checks",
  );
  return head;
}
export async function rebuildTree(client, pins, profile) {
  const block = await verifyDeployment(client, pins),
    address = pins.contracts.registry.address,
    tree = new profile.Forest();
  const event = parseAbiItem(
    "event Appended(uint256 indexed index, uint256 indexed treeId, uint256 commitment, uint256 root)",
  );
  // Requests are bounded by block range; count/root checks detect incomplete index responses.
  for (
    let from = BigInt(pins.deploymentBlock);
    from <= block.number;
    from += 1000n
  ) {
    const to = from + 999n < block.number ? from + 999n : block.number;
    const logs = await client.getLogs({
      address,
      event,
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    check(logs.length <= 65536, "Too many append events");
    for (const log of logs) {
      check(!log.removed && log.blockNumber >= from && log.blockNumber <= to);
      check(
        log.args.index === BigInt(tree.leaves.length),
        "Missing/reordered tree events",
      );
      check(log.args.treeId === log.args.index / 65536n, "Wrong tree epoch");
      tree.append(log.args.commitment);
      check(tree.root === log.args.root, "Event root mismatch");
    }
  }
  const [root, count, again] = await Promise.all([
    client.readContract({
      address,
      abi: registryAbi,
      functionName: "root",
      blockNumber: block.number,
    }),
    client.readContract({
      address,
      abi: registryAbi,
      functionName: "nextIndex",
      blockNumber: block.number,
    }),
    client.getBlock({ blockNumber: block.number }),
  ]);
  check(
    root === tree.root && count === BigInt(tree.leaves.length),
    "Incomplete chain reconstruction",
  );
  check(again.hash === block.hash, "Chain changed during replay");
  return { tree, block: { number: String(block.number), hash: block.hash } };
}
export async function observeSpend(client, pins, profile, record) {
  check(
    canonical(validatePins(record.pins)) === canonical(validatePins(pins)),
    "Recovery uses different trusted pins",
  );
  const block = await verifyDeployment(client, pins),
    address = pins.contracts.registry.address,
    n = profile.nullifier(record.source, pinDeployment(pins));
  const read = (functionName, args) =>
    client.readContract({
      address,
      abi: registryAbi,
      functionName,
      args,
      blockNumber: block.number,
    });
  const [nullifierPresent, successor, commitmentPresent, destinationSpent] =
    await Promise.all([
      read("nullifiers", [n]),
      read("successor", [n]),
      read("commitments", [BigInt(record.destination.commitment)]),
      read("nullifiers", [profile.nullifier(record.destination)]),
    ]);
  check(
    (await client.getBlock({ blockNumber: block.number })).hash === block.hash,
    "Chain changed during observation",
  );
  return {
    nullifierPresent,
    destinationSpent,
    successor,
    commitmentPresent,
    block: { number: String(block.number), hash: block.hash },
  };
}
export async function verifyAsset(client, pins, profile, note) {
  profile.validate(note, pinDeployment(pins));
  const block = await verifyDeployment(client, pins),
    address = pins.contracts.registry.address;
  const event = parseAbiItem(
    "event Created(bytes32 indexed assetId, bytes32 indexed imageHash, bytes32 metadataHash, address indexed creator, uint256 commitment)",
  );
  let matches = [];
  for (
    let from = BigInt(pins.deploymentBlock);
    from <= block.number;
    from += 1000n
  ) {
    const to = from + 999n < block.number ? from + 999n : block.number;
    const logs = await client.getLogs({
      address,
      event,
      args: { assetId: note.assetId, imageHash: note.imageHash },
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    matches.push(...logs);
    check(matches.length <= 1, "Duplicate asset provenance");
  }
  check(
    matches.length === 1 && !matches[0].removed,
    "Asset creation unavailable",
  );
  const created = matches[0].args;
  check(
    created.metadataHash === note.metadataHash &&
      created.creator.toLowerCase() === note.metadata.creator,
    "Creation metadata/creator mismatch",
  );
  check(
    (await client.getBlock({ blockNumber: block.number })).hash === block.hash,
    "Chain changed during provenance check",
  );
  return {
    creator: created.creator.toLowerCase(),
    initialCommitment: String(created.commitment),
    block: { number: String(block.number), hash: block.hash },
  };
}

export async function observeCreation(client, pins, profile, record) {
  check(
    record.kind === "create" &&
      canonical(validatePins(record.pins)) === canonical(validatePins(pins)),
  );
  profile.validate(record.destination, pinDeployment(pins));
  const block = await verifyDeployment(client, pins),
    address = pins.contracts.registry.address;
  const [assetId, commitmentPresent, destinationSpent] = await Promise.all([
    client.readContract({
      address,
      abi: [
        parseAbiItem("function imageAssets(bytes32) view returns (bytes32)"),
      ],
      functionName: "imageAssets",
      args: [record.destination.imageHash],
      blockNumber: block.number,
    }),
    client.readContract({
      address,
      abi: registryAbi,
      functionName: "commitments",
      args: [BigInt(record.destination.commitment)],
      blockNumber: block.number,
    }),
    client.readContract({
      address,
      abi: registryAbi,
      functionName: "nullifiers",
      args: [profile.nullifier(record.destination)],
      blockNumber: block.number,
    }),
  ]);
  check(
    (await client.getBlock({ blockNumber: block.number })).hash === block.hash,
    "Chain changed during creation observation",
  );
  return {
    assetId,
    destinationSpent,
    commitmentPresent,
    block: { number: String(block.number), hash: block.hash },
  };
}
