import { openDB, type IDBPDatabase } from "idb";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import {
  canonical,
  hashSchema,
  metadataSchema,
  operationSchema,
  addressSchema,
  uintSchema,
  type Deployment,
  type Metadata,
  type Operation,
} from "../protocol";
import type { Hex } from "viem";

const VERSION = 1,
  ITERATIONS = 600_000;
const enc = new TextEncoder(),
  dec = new TextDecoder("utf-8", { fatal: true });
export function base64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function unbase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const buffer = (b: Uint8Array) => b as BufferSource;
type Sealed = { iv: string; ciphertext: string };
type Header = {
  version: 1;
  salt: string;
  root: Sealed;
  revision: number;
  backedUpRevision: number;
};
const sealedSchema = z
  .object({ iv: z.string().max(32), ciphertext: z.string().max(20_000_000) })
  .strict();
const recordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile"), privateKey: hashSchema }).strict(),
  z
    .object({
      kind: z.literal("item"),
      tokenId: z.string().regex(/^\d{1,78}$/),
      privateKey: hashSchema,
      previousKeys: z.array(hashSchema).max(1000),
      image: z.string().max(14_000_000),
      metadata: metadataSchema,
      nonce: z.string().regex(/^\d{1,78}$/),
      status: z.enum([
        "draft",
        "pending",
        "owned",
        "exported",
        "stale",
        "wallet",
      ]),
      walletTransfer: z
        .object({
          direction: z.enum(["into-file", "to-wallet"]),
          wallet: addressSchema,
          sourceNonce: uintSchema,
        })
        .strict()
        .optional(),
      operation: operationSchema.optional(),
      operationId: hashSchema.optional(),
      txHash: hashSchema.optional(),
    })
    .strict(),
]);
export type ItemRecord = Extract<
  z.infer<typeof recordSchema>,
  { kind: "item" }
>;
type VaultRecord = z.infer<typeof recordSchema>;
async function passwordKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    buffer(enc.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: buffer(salt),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function rootKey(root: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    buffer(root),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: buffer(enc.encode("zft-vault/1")),
      info: buffer(enc.encode("record-encryption")),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function seal(
  key: CryptoKey,
  data: Uint8Array,
  aad: string,
): Promise<Sealed> {
  const iv = bytes(12),
    ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: buffer(iv),
        additionalData: buffer(enc.encode(aad)),
      },
      key,
      buffer(data),
    );
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) };
}
async function unseal(key: CryptoKey, data: Sealed, aad: string) {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: buffer(unbase64(data.iv)),
        additionalData: buffer(enc.encode(aad)),
      },
      key,
      buffer(unbase64(data.ciphertext)),
    ),
  );
}
export class Vault {
  private root?: Uint8Array;
  private key?: CryptoKey;
  private constructor(
    private db: IDBPDatabase,
    readonly namespace: string,
  ) {}
  static async open(
    deployment: Pick<Deployment, "chainId" | "contract">,
    dbName = "zft-vault",
  ) {
    const namespace = `${deployment.chainId}:${deployment.contract.toLowerCase()}`;
    const db = await openDB(`${dbName}:${namespace}`, VERSION, {
      upgrade(db) {
        db.createObjectStore("meta");
        db.createObjectStore("records");
      },
    });
    return new Vault(db, namespace);
  }
  async exists() {
    return !!(await this.db.get("meta", "header"));
  }
  async revisions(): Promise<{ current: number; backedUp: number }> {
    const h: Header = await this.db.get("meta", "header");
    return { current: h?.revision ?? 0, backedUp: h?.backedUpRevision ?? -1 };
  }
  get unlocked() {
    return !!this.key;
  }
  private aad(id: string) {
    return `zft-vault/1:${this.namespace}:${id}`;
  }
  async create(passphrase: string) {
    if (passphrase.length < 12)
      throw new Error("Use a passphrase with at least 12 characters.");
    if (await this.exists())
      throw new Error(
        "A vault already exists. Unlock or restore in a separate browser.",
      );
    const root = bytes(32),
      salt = bytes(16);
    const h: Header = {
      version: 1,
      salt: base64(salt),
      root: await seal(
        await passwordKey(passphrase, salt),
        root,
        this.aad("root"),
      ),
      revision: 1,
      backedUpRevision: -1,
    };
    const key = await rootKey(root),
      profile = await seal(
        key,
        enc.encode(
          canonical({ kind: "profile", privateKey: generatePrivateKey() }),
        ),
        this.aad("profile"),
      );
    const tx = this.db.transaction(["meta", "records"], "readwrite");
    if (await tx.objectStore("meta").get("header")) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error("Another tab created this vault.");
    }
    await tx.objectStore("meta").put(h, "header");
    await tx.objectStore("records").put(profile, "profile");
    await tx.done;
    this.root = root;
    this.key = key;
  }
  async unlock(passphrase: string) {
    const h: Header = await this.db.get("meta", "header");
    if (!h || h.version !== 1) throw new Error("No supported vault found.");
    try {
      this.root = await unseal(
        await passwordKey(passphrase, unbase64(h.salt)),
        h.root,
        this.aad("root"),
      );
      this.key = await rootKey(this.root);
      await this.profile();
    } catch {
      this.lock();
      throw new Error("Unable to unlock. Check your passphrase.");
    }
  }
  lock() {
    this.root?.fill(0);
    this.root = undefined;
    this.key = undefined;
  }
  close() {
    this.lock();
    this.db.close();
  }
  private requireKey() {
    if (!this.key) throw new Error("Unlock your collection first.");
    return this.key;
  }
  async put(id: string, record: VaultRecord, expected?: ItemRecord | null) {
    const before = await this.db.get("records", id);
    if (expected !== undefined) {
      const current = before
        ? recordSchema.parse(
            JSON.parse(
              dec.decode(await unseal(this.requireKey(), before, this.aad(id))),
            ),
          )
        : null;
      if (canonical(current) !== canonical(expected))
        throw new Error("This item changed. Refresh before continuing.");
    }
    if (before && record.kind === "item") {
      const current = recordSchema.parse(
        JSON.parse(
          dec.decode(await unseal(this.requireKey(), before, this.aad(id))),
        ),
      );
      if (current.kind !== "item") throw new Error("Record kind changed.");
      if (
        current.privateKey !== record.privateKey &&
        !record.previousKeys.includes(current.privateKey)
      )
        throw new Error(
          "This item changed in another operation. Refresh before continuing.",
        );
      record = {
        ...record,
        previousKeys: [
          ...new Set([...record.previousKeys, ...current.previousKeys]),
        ].filter((k) => k !== record.privateKey),
      };
    }
    const checked = recordSchema.parse(record);
    const sealed = await seal(
      this.requireKey(),
      enc.encode(canonical(checked)),
      this.aad(id),
    );
    const tx = this.db.transaction(["meta", "records"], "readwrite");
    if (
      JSON.stringify(await tx.objectStore("records").get(id)) !==
      JSON.stringify(before)
    ) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error(
        "Another tab changed this item. Refresh before continuing.",
      );
    }
    const h: Header = await tx.objectStore("meta").get("header");
    await tx.objectStore("records").put(sealed, id);
    await tx
      .objectStore("meta")
      .put({ ...h, revision: h.revision + 1 }, "header");
    await tx.done;
  }
  async get(id: string): Promise<VaultRecord | undefined> {
    const key = this.requireKey(),
      data: Sealed | undefined = await this.db.get("records", id);
    return data
      ? recordSchema.parse(
          JSON.parse(dec.decode(await unseal(key, data, this.aad(id)))),
        )
      : undefined;
  }
  async profile() {
    const record = await this.get("profile");
    if (!record || record.kind !== "profile")
      throw new Error("Profile missing from vault.");
    return privateKeyToAccount(record.privateKey);
  }
  async items() {
    const keys = await this.db.getAllKeys("records");
    const items: ItemRecord[] = [];
    for (const key of keys) {
      const r = await this.get(String(key));
      if (r?.kind === "item") items.push(r);
    }
    return items;
  }
  async saveItem(record: ItemRecord, expected?: ItemRecord | null) {
    await this.put(`item:${record.tokenId}`, record, expected);
  }
  async backup() {
    this.requireKey();
    const tx = this.db.transaction(["meta", "records"]);
    const h: Header = await tx.objectStore("meta").get("header");
    const keys = await tx.objectStore("records").getAllKeys(),
      values = await tx.objectStore("records").getAll();
    await tx.done;
    const records = Object.fromEntries(
      keys.map((key, i) => [String(key), values[i]]),
    );
    return {
      revision: h.revision,
      text: canonical({
        format: "zft-recovery",
        version: 1,
        namespace: this.namespace,
        root: base64(this.root!),
        revision: h.revision,
        records,
      }),
    };
  }
  async acknowledgeBackup(revision: number) {
    const tx = this.db.transaction("meta", "readwrite"),
      h: Header = await tx.store.get("header");
    if (h.revision !== revision) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error("Your collection changed. Save a new recovery file.");
    }
    await tx.store.put({ ...h, backedUpRevision: revision }, "header");
    await tx.done;
  }
  async requireBackup() {
    if ((await this.revisions()).backedUp < 0)
      throw new Error("Save and confirm your recovery file first.");
  }
  async restore(text: string, passphrase: string) {
    if (await this.exists())
      throw new Error(
        "Restore into a fresh browser profile to preserve this vault.",
      );
    if (text.length > 100_000_000 || passphrase.length < 12)
      throw new Error("Invalid recovery file or short passphrase.");
    const bundle = z
      .object({
        format: z.literal("zft-recovery"),
        version: z.literal(1),
        namespace: z.literal(this.namespace),
        root: z.string().max(64),
        revision: z.number().int().nonnegative(),
        records: z.record(sealedSchema),
      })
      .strict()
      .parse(JSON.parse(text));
    const root = unbase64(bundle.root);
    if (
      root.length !== 32 ||
      !bundle.records.profile ||
      Object.keys(bundle.records).length > 1000
    )
      throw new Error("Invalid recovery snapshot.");
    const key = await rootKey(root);
    for (const [id, sealed] of Object.entries(bundle.records)) {
      const r = recordSchema.parse(
        JSON.parse(dec.decode(await unseal(key, sealed, this.aad(id)))),
      );
      if (id !== (r.kind === "profile" ? "profile" : `item:${r.tokenId}`))
        throw new Error("Recovery record identity mismatch.");
      privateKeyToAccount(r.privateKey);
    }
    const salt = bytes(16),
      header: Header = {
        version: 1,
        salt: base64(salt),
        root: await seal(
          await passwordKey(passphrase, salt),
          root,
          this.aad("root"),
        ),
        revision: bundle.revision,
        backedUpRevision: bundle.revision,
      };
    const tx = this.db.transaction(["meta", "records"], "readwrite");
    if (await tx.objectStore("meta").get("header")) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error("Another tab created this vault.");
    }
    await tx.objectStore("meta").put(header, "header");
    for (const [id, sealed] of Object.entries(bundle.records))
      await tx.objectStore("records").put(sealed, id);
    await tx.done;
    this.root = root;
    this.key = key;
  }
}
