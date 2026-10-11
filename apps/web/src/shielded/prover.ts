import type {
  Prover,
  Configuration,
} from "../../../../packages/shielded/client.mjs";
export function browserProver(): Prover {
  let cancel: (() => void) | undefined;
  return {
    cancel() {
      cancel?.();
    },
    prove(name, input, config: Configuration) {
      if (cancel) return Promise.reject(Error("Proof already running"));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const worker = new Worker(
          new URL(
            "../../../../research/shielded-lab/browser/prover-worker.js",
            import.meta.url,
          ),
        );
        let settled = false;
        const finish = (result?: {
          publicSignals: string[];
          proof: unknown;
        }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          worker.terminate();
          cancel = undefined;
          result
            ? resolve(result)
            : reject(Error("Local proof did not complete"));
        };
        const timer = setTimeout(() => finish(), 60000);
        cancel = () => finish();
        worker.onerror = () => finish();
        worker.onmessageerror = () => finish();
        worker.onmessage = ({ data }) => {
          if (data?.id !== id) return;
          if (
            data.status === "complete" &&
            Array.isArray(data.publicSignals) &&
            data.publicSignals.length === 4
          )
            finish(data);
          else if (data.status === "failed") finish();
        };
        const artifacts = {
          library: config.artifacts.library,
          wasm: config.artifacts[name + "-wasm"],
          key: config.artifacts[name + "-key"],
          verificationKey: config.artifacts[name + "-verificationKey"],
        };
        worker.postMessage({ id, name, input, artifacts });
      });
    },
  };
}
