// Public verifier: no vault, credentials, launch capability or wallet RPC.
import { verifyPresentation } from "./presentation.mjs";
import * as p from "./profile.mjs";
self.onmessage = async ({ data }) => {
  try {
    const { wire, pins } = data;
    if (pins.origin !== self.location.origin) throw new Error("origin pin");
    const report = await verifyPresentation(
      wire,
      pins.psManifest,
      pins.statusManifest,
      pins.origin,
      Math.floor(Date.now() / 1000),
    );
    const v = p.parse(wire, 150000);
    self.postMessage({
      ok: true,
      report,
      image: p.bytes(v.image),
      wallet: v.context.wallet,
      chainId: v.chain_id,
    });
  } catch {
    self.postMessage({ ok: false });
  }
};
