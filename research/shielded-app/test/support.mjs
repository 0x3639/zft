import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { canonical, digest } from "../../shielded-lab/core.mjs";
import { lab } from "../../shielded-lab/evm-test.mjs";
import { prove } from "../../shielded-lab/prover.mjs";
export const origin = "http://127.0.0.1:5173";
export const password = "disposable integration recovery password";
export function configuration(evm, pins) {
  const artifacts = {};
  for (const name of ["create", "spend"])
    for (const [kind, file] of [
      ["wasm", `${name}_js/${name}.wasm`],
      ["key", `${name}-groth16.zkey`],
      ["verificationKey", `${name}-groth16.vkey.json`],
    ]) {
      const path = resolve(lab, "build", file);
      artifacts[`${name}-${kind}`] = {
        url: `/shielded-assets/${name}-${kind}`,
        bytes: statSync(path).size,
        sha256: digest(readFileSync(path)),
      };
    }
  const file = resolve(lab, "node_modules/snarkjs/build/snarkjs.min.js");
  artifacts.library = {
    url: "/shielded-assets/snarkjs.min.js",
    bytes: statSync(file).size,
    sha256: digest(readFileSync(file)),
  };
  return {
    format: "zft-shielded-app-config-v1",
    pins,
    rpc: evm.url + "/",
    artifacts,
  };
}
export const configText = (evm, pins) => canonical(configuration(evm, pins));
export const prover = {
  prove: (name, input, config) => prove(name, input, "groth16", config.pins),
  cancel() {},
};
export function providerFor(evm) {
  const calls = [],
    listeners = new Map();
  let chain = "0x7a69",
    address = evm.account.address,
    afterSend;
  return {
    calls,
    listeners,
    setChain(v) {
      chain = v;
    },
    setAccount(v) {
      address = v;
    },
    afterSend(fn) {
      afterSend = fn;
    },
    on(name, fn) {
      listeners.set(name, fn);
    },
    removeListener(name, fn) {
      if (listeners.get(name) === fn) listeners.delete(name);
    },
    async request(request) {
      calls.push(structuredClone(request));
      if (request.method === "eth_chainId") return chain;
      if (["eth_requestAccounts", "eth_accounts"].includes(request.method))
        return [address];
      if (request.method === "eth_signTypedData_v4") {
        const { domain, types, primaryType, message } = JSON.parse(
          request.params[1],
        );
        delete types.EIP712Domain;
        return evm.account.signTypedData({
          domain,
          types,
          primaryType,
          message,
        });
      }
      if (request.method === "eth_sendTransaction") {
        const tx = request.params[0];
        const hash = await evm.wallet.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value),
        });
        await afterSend?.(hash);
        return hash;
      }
      if (
        [
          "eth_getBlockByNumber",
          "eth_getCode",
          "eth_call",
          "eth_blockNumber",
        ].includes(request.method)
      )
        return evm.client.request(request);
      throw Error("Unsupported disposable provider request");
    },
  };
}
