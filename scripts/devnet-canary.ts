import "fake-indexeddb/auto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { encode } from "fast-png";
import { privateKeyToAccount } from "viem/accounts";
import { sha256 } from "viem";
import { Vault, base64, unbase64, type ItemRecord } from "../packages/vault";
import {
  CANONICALIZER,
  digest,
  sameAddress,
  type Deployment,
} from "../packages/protocol";
import { ownership } from "../packages/protocol/client";
import { exportFile } from "../packages/file-codec";
import * as flows from "../apps/web/src/flows";
import { signedRequest, ApiError } from "../apps/web/src/api";
import manifest from "../packages/protocol/deployment.json";

if (!manifest.contract) throw new Error("Deploy the devnet contract first.");
const d = manifest as unknown as Deployment,
  origin = process.env.ZFT_TEST_ORIGIN ?? "http://localhost:5173";
const runLabel = process.env.ZFT_CANARY_LABEL ?? "";
if (runLabel && !/^[a-z0-9-]{1,24}$/.test(runLabel))
  throw new Error("Invalid canary label");
const prefix = runLabel ? `${runLabel}-canary` : "canary";
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  nativeFetch(
    typeof input === "string" && input.startsWith("/") ? origin + input : input,
    {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        Origin: origin,
      },
    },
  );
Object.defineProperty(globalThis, "location", {
  value: { origin },
  configurable: true,
});
await mkdir(".local", { recursive: true, mode: 0o700 });
type Evidence = {
  contract: string;
  transactions: { action: string; hash: string; block?: string }[];
  checks: string[];
};
let progress: { phase: number; evidence: Evidence };
try {
  progress = JSON.parse(
    await readFile(`.local/${prefix}-progress.json`, "utf8"),
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  progress = {
    phase: 0,
    evidence: { contract: d.contract, transactions: [], checks: [] },
  };
}
const evidence = progress.evidence;
if (evidence.contract !== d.contract)
  throw new Error("Canary journal belongs to a different deployment.");
async function checkpoint(phase: number) {
  progress.phase = phase;
  await writeFile(`.local/${prefix}-progress.json`, JSON.stringify(progress), {
    mode: 0o600,
  });
}
async function persist(v: Vault, label: string) {
  await writeFile(
    `.local/${prefix}-${label}.zft-recovery`,
    (await v.backup()).text,
    { mode: 0o600 },
  );
}
async function open(label: string) {
  const v = await Vault.open(d, `${prefix}-${label}`);
  const password = crypto.randomUUID() + crypto.randomUUID();
  try {
    await v.restore(
      await readFile(`.local/${prefix}-${label}.zft-recovery`, "utf8"),
      password,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await v.create(password);
    const b = await v.backup();
    await v.acknowledgeBackup(b.revision);
    await persist(v, label);
  }
  const save = v.saveItem.bind(v);
  v.saveItem = async (record) => {
    await save(record);
    await persist(v, label);
  };
  return v;
}
async function confirmed(v: Vault, label: string, action: string) {
  const start = Date.now();
  while (Date.now() - start < 240_000) {
    const item = (await v.items())[0];
    let job: flows.Job | undefined;
    try {
      job = await flows.reconcile(v, d, item);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 503)) throw error;
      // A transient receipt/RPC outage never authorizes replacing a saved operation.
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }
    if (job?.state === "failed") throw new Error(`${action} reverted`);
    if (job?.state === "confirmed") {
      const current = (await v.items())[0],
        onchain = await ownership(d.contract, current.tokenId);
      if (
        !sameAddress(
          onchain.owner,
          privateKeyToAccount(current.privateKey).address,
        )
      )
        throw new Error(
          `${action}: current owner does not match durable new key`,
        );
      evidence.transactions.push({
        action,
        hash: job.txHash,
        block: job.blockNumber,
      });
      console.log(`${action}: confirmed ${job.txHash}`);
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(
    `${action} timed out; recovery journal is saved. Rerun to reconcile.`,
  );
}
async function file(item: ItemRecord) {
  const state = await ownership(d.contract, item.tokenId);
  return exportFile(unbase64(item.image), {
    format: "zft",
    version: 1,
    canonicalizer: CANONICALIZER,
    chainId: "7340469",
    contract: d.contract,
    tokenId: item.tokenId,
    imageHash: item.metadata.imageHash,
    metadataHash: digest(item.metadata),
    metadata: item.metadata,
    authority: {
      scheme: "secp256k1",
      privateKey: item.privateKey,
      ownershipNonce: state.nonce,
    },
  });
}
async function importRecord(bytes: Uint8Array): Promise<ItemRecord> {
  const imported = await flows.readTransfer(
      new File([bytes as BlobPart], "canary.zft.png"),
      d,
    ),
    e = imported.envelope;
  return {
    kind: "item",
    tokenId: e.tokenId,
    privateKey: e.authority.privateKey,
    previousKeys: [],
    image: base64(imported.image),
    metadata: e.metadata,
    nonce: e.authority.ownershipNonce,
    status: "draft",
  };
}
async function stale(bytes: Uint8Array, label: string) {
  try {
    await importRecord(bytes);
  } catch (error) {
    if ((error as Error).message.includes("stale")) {
      evidence.checks.push(label);
      return;
    }
    throw error;
  }
  throw new Error(`${label}: old copy was accepted`);
}
const alice = await open("alice"),
  bob = await open("bob"),
  carol = await open("carol");
if (!(await alice.items()).length) {
  const width = 192,
    height = 192,
    pixels = new Uint8Array(width * height * 4),
    seed = crypto.getRandomValues(new Uint8Array(3));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        green = (x + y + seed[0]) % 80 < 18;
      pixels.set(
        green
          ? [0, 213, 87, 255]
          : [
              15 + (seed[1] % 15),
              25 + Math.floor(y / 3),
              40 + Math.floor(x / 3),
              255,
            ],
        i,
      );
    }
  const bytes = encode(
    { width, height, data: pixels, channels: 4, depth: 8 },
    { zlib: { level: 6 } },
  );
  await writeFile(`.local/${prefix}-art.png`, bytes);
  await flows.mint(
    alice,
    d,
    { bytes, width, height, imageHash: sha256(bytes) },
    runLabel
      ? `Hosted momentum · ${runLabel} canary`
      : "First momentum · devnet canary",
    "A real ZFT integration canary. Test collectible only; ZVM devnet may reset.",
  );
}
if (progress.phase < 1) {
  const pending = (await alice.items())[0];
  if (!pending.txHash) {
    await signedRequest(
      "/api/uploads",
      { image: pending.image, metadata: pending.metadata },
      await alice.profile(),
    );
    await flows.submit(alice, d, pending);
  }
  const a = await confirmed(alice, "alice", "mint");
  const duplicate = await flows.submit(alice, d, a);
  if (duplicate.txHash !== a.txHash)
    throw new Error(
      "Duplicate authorization received a different transaction.",
    );
  evidence.checks.push(
    "Duplicate mint submission recovers the same durable transaction hash",
  );
  await writeFile(`.local/${prefix}-original.zft.png`, await file(a), {
    mode: 0o600,
  });
  await checkpoint(1);
}
const original = new Uint8Array(
  await readFile(`.local/${prefix}-original.zft.png`),
);
if (progress.phase < 2) {
  if (!(await bob.items()).length)
    await flows.rotate(bob, d, await importRecord(original));
  const b = await confirmed(bob, "bob", "claim");
  await stale(original, "Original copy rejected after claim");
  await writeFile(`.local/${prefix}-before-cancel.zft.png`, await file(b), {
    mode: 0o600,
  });
  await checkpoint(2);
}
if (progress.phase < 3) {
  let b = (await bob.items())[0];
  if (BigInt(b.nonce) === 1n) await flows.rotate(bob, d, b);
  b = await confirmed(bob, "bob", "cancel");
  await stale(
    new Uint8Array(await readFile(`.local/${prefix}-before-cancel.zft.png`)),
    "Exported copy rejected after sender cancellation",
  );
  await writeFile(`.local/${prefix}-after-cancel.zft.png`, await file(b), {
    mode: 0o600,
  });
  await checkpoint(3);
}
if (progress.phase < 4) {
  if (!(await carol.items()).length)
    await flows.rotate(
      carol,
      d,
      await importRecord(
        new Uint8Array(await readFile(`.local/${prefix}-after-cancel.zft.png`)),
      ),
    );
  await confirmed(carol, "carol", "re-export and second claim");
  await checkpoint(4);
}
const c = (await carol.items())[0];
const restored = await Vault.open(d, `${prefix}-restored`);
await restored.restore((await carol.backup()).text, crypto.randomUUID());
const restoredItem = (await restored.items())[0];
if (restoredItem.privateKey !== c.privateKey)
  throw new Error("Recovery did not restore current key.");
await importRecord(await file(restoredItem));
evidence.checks.push(
  "Current recovery snapshot restores a valid transferable file",
);
evidence.checks.push(
  "Recipient key and prior key persisted before every submission",
);
await writeFile(
  runLabel
    ? `research/${runLabel}-devnet-canary.json`
    : "research/devnet-canary.json",
  JSON.stringify(
    {
      ...evidence,
      origin,
      completedAt: new Date().toISOString(),
      tokenId: c.tokenId,
      ownershipNonce: c.nonce,
      confirmationPolicy: "6 subsequent EVM blocks",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Canary passed: mint → export → claim → cancel → re-export → claim → recovery.",
);
alice.close();
bob.close();
carol.close();
restored.close();
