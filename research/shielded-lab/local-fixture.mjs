// Test harness only: fresh contracts and random disposable fee account on local Anvil.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256 } from "viem";
import { poseidonContract } from "circomlibjs";
import { artifacts, lab } from "./evm-test.mjs";
import { digest } from "./core.mjs";
import { validatePins } from "./chain.mjs";
export async function deployFixture(evm) {
  const compiled = artifacts(),
    addresses = {};
  addresses.hasher = await evm.deploy({
    abi: poseidonContract.generateABI(2),
    bytecode: poseidonContract.createCode(2),
  });
  for (const kind of ["creation", "spend"]) {
    addresses[kind + "Verifier"] = await evm.deploy(
      compiled[(kind === "creation" ? "Create" : "Spend") + "Groth16Verifier"],
    );
    addresses[kind + "Adapter"] = await evm.deploy(compiled.VerifierAdapter, [
      addresses[kind + "Verifier"],
      false,
    ]);
  }
  addresses.registry = await evm.deploy(compiled.ShieldedRegistry, [
    addresses.hasher,
    addresses.creationAdapter,
    addresses.spendAdapter,
  ]);
  const contracts = {};
  for (const [name, address] of Object.entries(addresses))
    contracts[name] = {
      address,
      codeHash: keccak256(await evm.client.getCode({ address })),
    };
  const files = {
    createWasm: "create_js/create.wasm",
    spendWasm: "spend_js/spend.wasm",
    createKey: "create-groth16.zkey",
    spendKey: "spend-groth16.zkey",
    createVerificationKey: "create-groth16.vkey.json",
    spendVerificationKey: "spend-groth16.vkey.json",
  };
  const pins = validatePins({
    format: "zft-shielded-local-deployment-v1",
    chainId: "31337",
    genesisHash: (await evm.client.getBlock({ blockNumber: 0n })).hash,
    deploymentBlock: String(await evm.client.getBlockNumber({ cacheTime: 0 })),
    system: "groth16",
    contracts,
    artifacts: Object.fromEntries(
      Object.entries(files).map(([n, f]) => [
        n,
        digest(readFileSync(resolve(lab, "build", f))),
      ]),
    ),
  });
  return {
    pins,
    address: addresses.registry,
    abi: compiled.ShieldedRegistry.abi,
  };
}
export const createTypes = {
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
export async function authorizeCreation(evm, d, note, nonce = "0") {
  const authorization = {
    imageHash: note.imageHash,
    metadataHash: note.metadataHash,
    commitment: note.commitment,
    creator: note.metadata.creator,
    nonce,
    deadline: String((await evm.client.getBlock()).timestamp + 3600n),
  };
  const signature = await evm.account.signTypedData({
    domain: {
      name: "ZFT Shielded Registry",
      version: "1",
      chainId: Number(d.chainId),
      verifyingContract: d.registry,
    },
    types: createTypes,
    primaryType: "Create",
    message: authorizationArgs(authorization),
  });
  const salt =
    "0x" +
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  return { authorization, salt, signature };
}
