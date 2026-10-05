import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, it, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { Vault, base64, type ItemRecord } from "../packages/vault";
import { contract, envelope, source, key } from "./fixtures";
const pass = "correct horse battery staple",
  deployment = { chainId: 7340469, contract };
const record = (): ItemRecord => ({
  kind: "item",
  tokenId: envelope(source()).tokenId,
  privateKey: key,
  previousKeys: [],
  image: base64(source()),
  metadata: envelope(source()).metadata,
  nonce: "0",
  status: "pending",
});
describe("encrypted local vault and recovery", () => {
  it("keeps a passwordless session out of IndexedDB and restores its keys from the existing recovery format", async () => {
    const before = await indexedDB.databases();
    const session = await Vault.session(deployment);
    expect(session.persistent).toBe(false);
    await session.saveItem(record());
    await expect(session.requireItemBackup(record())).rejects.toThrow(
      "recovery file",
    );
    const snapshot = await session.backup();
    await session.acknowledgeBackup(snapshot.revision);
    await session.requireItemBackup(record());
    expect(await indexedDB.databases()).toEqual(before);
    const identity = (await session.profile()).address;
    session.close();
    expect(session.unlocked).toBe(false);
    await expect(session.items()).resolves.toEqual([]);
    const restored = await Vault.session(deployment, snapshot.text);
    expect((await restored.profile()).address).toBe(identity);
    expect(await restored.items()).toEqual([record()]);
    await restored.requireItemBackup(record());
    restored.close();
  });
  it("requires a backup containing newly generated keys but allows status updates with the same backed-up keys", async () => {
    const session = await Vault.session(deployment);
    const early = await session.backup();
    await session.acknowledgeBackup(early.revision);
    await session.saveItem(record());
    await expect(session.requireItemBackup(record())).rejects.toThrow(
      "recovery file",
    );
    const latest = await session.backup();
    await session.acknowledgeBackup(latest.revision);
    await session.saveItem({ ...record(), status: "owned" });
    await session.requireItemBackup(record());
    const rotated = {
      ...record(),
      privateKey: generatePrivateKey(),
      previousKeys: [key],
    };
    await session.saveItem(rotated);
    await expect(session.requireItemBackup(rotated)).rejects.toThrow(
      "recovery file",
    );
    session.close();
  });
  it("upgrades a recovered session into password protection while preserving identities and existing encrypted vaults", async () => {
    const session = await Vault.session(deployment);
    await session.saveItem(record());
    const snapshot = await session.backup();
    const profile = (await session.profile()).address;
    const name = crypto.randomUUID(),
      protectedVault = await Vault.open(deployment, name);
    await protectedVault.restore(snapshot.text, pass);
    protectedVault.close();
    session.close();
    const reopened = await Vault.open(deployment, name);
    await expect(reopened.unlock("wrong password")).rejects.toThrow(
      "Unable to unlock",
    );
    await reopened.unlock(pass);
    expect((await reopened.profile()).address).toBe(profile);
    expect(await reopened.items()).toEqual([record()]);
    await reopened.requireItemBackup(record());
    await expect(reopened.restore(snapshot.text, pass)).rejects.toThrow(
      "fresh browser",
    );
    reopened.close();
  });
  it("does not finish saving a session key after manual lock", async () => {
    const session = await Vault.session(deployment);
    const saving = session.saveItem(record());
    session.lock();
    await expect(saving).rejects.toThrow();
    expect(session.unlocked).toBe(false);
    expect(await session.items()).toEqual([]);
  });
  it("rejects a competing tab instead of overwriting a newly persisted ownership key", async () => {
    const name = crypto.randomUUID(),
      a = await Vault.open(deployment, name);
    await a.create(pass);
    await a.saveItem(record());
    const b = await Vault.open(deployment, name);
    await b.unlock(pass);
    const first = {
        ...record(),
        privateKey: generatePrivateKey(),
        previousKeys: [key],
      },
      second = {
        ...record(),
        privateKey: generatePrivateKey(),
        previousKeys: [key],
      };
    const results = await Promise.allSettled([
      a.saveItem(first),
      b.saveItem(second),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const saved = (await a.items())[0];
    expect([first.privateKey, second.privateKey]).toContain(saved.privateKey);
    expect(saved.previousKeys).toEqual([key]);
    a.close();
    b.close();
  });
  it("persists a pending key through close/reopen, requires backup, rejects wrong passphrase", async () => {
    const name = crypto.randomUUID(),
      a = await Vault.open(deployment, name);
    await a.create(pass);
    await expect(a.requireBackup()).rejects.toThrow("recovery");
    await a.saveItem(record());
    const backup = await a.backup();
    await a.acknowledgeBackup(backup.revision);
    a.close();
    const b = await Vault.open(deployment, name);
    await expect(b.unlock("incorrect passphrase")).rejects.toThrow(
      "Unable to unlock",
    );
    await b.unlock(pass);
    expect(await b.items()).toEqual([record()]);
    await b.requireBackup();
    b.close();
  });
  it("restores only snapshot keys and refuses to overwrite a current vault", async () => {
    const a = await Vault.open(deployment, crypto.randomUUID());
    await a.create(pass);
    const early = await a.backup();
    await a.saveItem(record());
    const latest = await a.backup();
    const b = await Vault.open(deployment, crypto.randomUUID());
    await b.restore(early.text, pass);
    expect(await b.items()).toEqual([]);
    await expect(b.restore(latest.text, pass)).rejects.toThrow("fresh browser");
    const c = await Vault.open(deployment, crypto.randomUUID());
    await c.restore(latest.text, pass);
    expect(await c.items()).toEqual([record()]);
    expect((await c.profile()).address).toBe((await a.profile()).address);
    a.close();
    b.close();
    c.close();
  });
  it("binds ciphertext to deployment and record ID; rejects tampered recovery atomically", async () => {
    const name = crypto.randomUUID(),
      a = await Vault.open(deployment, name);
    await a.create(pass);
    await a.saveItem(record());
    const raw = await openDB(`${name}:7340469:${contract.toLowerCase()}`),
      cipher = await raw.get("records", `item:${record().tokenId}`);
    expect(JSON.stringify(cipher)).not.toContain(key.slice(2));
    await raw.put("records", cipher, "item:999");
    await expect(a.get("item:999")).rejects.toThrow();
    await raw.delete("records", "item:999");
    const backup = JSON.parse((await a.backup()).text);
    backup.records.profile.ciphertext = "AAAA";
    const b = await Vault.open(deployment, crypto.randomUUID());
    await expect(b.restore(JSON.stringify(backup), pass)).rejects.toThrow();
    expect(await b.exists()).toBe(false);
    const other = await Vault.open(
      {
        chainId: 7340469,
        contract: "0x0000000000000000000000000000000000009999",
      },
      crypto.randomUUID(),
    );
    await expect(
      other.restore((await a.backup()).text, pass),
    ).rejects.toThrow();
    raw.close();
    a.close();
    b.close();
    other.close();
  });
  it("retains both sides of a rotation and detects stale backup acknowledgements", async () => {
    const a = await Vault.open(deployment, crypto.randomUUID());
    await a.create(pass);
    await a.saveItem(record());
    const backup = await a.backup();
    const pending = {
      ...record(),
      privateKey: generatePrivateKey(),
      previousKeys: [key],
    };
    await a.saveItem(pending);
    await expect(a.acknowledgeBackup(backup.revision)).rejects.toThrow(
      "changed",
    );
    expect((await a.items())[0]).toEqual(pending);
    a.close();
  });
});
