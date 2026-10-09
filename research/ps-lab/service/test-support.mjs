// Disposable state and public wrapping/key fixtures only; never import from a serving entry point.
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config, transport, secrets } from "../local/key-file-test-support.mjs";
import { asset, wallet, nonce } from "../local/test-support.mjs";
import { PsKeyFile } from "../local/key-file.mjs";
import { Client } from "../local/client.mjs";
import { loadReferenceCustody } from "./reference-custody.mjs";
import { initializeServiceStore } from "./store.mjs";
import { ServiceIssuer } from "./issuer.mjs";
import * as p from "../local/profile.mjs";
export { config, transport, secrets, asset, wallet, nonce };
export async function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "zft-service-"))),
    keys = join(dir, "keys"),
    path = join(dir, "service.db"),
    opened = [];
  fs.mkdirSync(keys, { mode: 0o700 });
  const file = new PsKeyFile(keys, { ...config, transport });
  const receipt = await file.create(secrets);
  file.close();
  const custody = await loadReferenceCustody(keys, receipt.sha256, {
    ...config,
    transport,
  });
  initializeServiceStore(path, config.manifest, config.configurationId);
  let now = 1000;
  const open = (extra = {}) => {
    const i = new ServiceIssuer(path, {
      ...config,
      transport: custody.transport,
      now: () => now,
      ...extra,
    });
    opened.push(i);
    return i;
  };
  const issuer = open();
  issuer.setEnabled(true);
  const client = (name) => {
    const c = new Client(join(dir, name + ".db"), config.manifest);
    opened.push(c);
    return c;
  };
  t.after(() => {
    for (const s of opened)
      try {
        s.close();
      } catch {}
    custody.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const pending = (c, d) => p.parse(c.backup(d), 300000);
  const acknowledge = (c, d) => c.acknowledge(d, p.hash(c.backup(d)));
  const submit = async (c, d, i = issuer) => {
    acknowledge(c, d);
    const v = pending(c, d);
    return c.accept(d, await i.submit(v.wire, v.capability));
  };
  const a = client("a"),
    b = client("b");
  const mint = async () =>
    submit(a, a.prepareIssue(await issuer.session("issue"), asset));
  return {
    dir,
    keys,
    path,
    receipt,
    custody,
    issuer,
    open,
    client,
    a,
    b,
    pending,
    submit,
    mint,
    setTime: (n) => {
      now = n;
    },
  };
}
