import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "fast-png";
import { pbkdf2Sync, createDecipheriv, createCipheriv } from "node:crypto";
import { createProfile, canonical, parseCanonical, digest } from "../core.mjs";
import {
  normalizeImage,
  exportBearer,
  importBearer,
  publicImage,
} from "../file-adapter.mjs";
import {
  operation,
  sealRecovery,
  openRecovery,
  classifySpend,
} from "../recovery.mjs";
import { deployment as d, metadata as m } from "./fixtures.mjs";
const p = await createProfile();
const normalized = await normalizeImage(
  encode({
    width: 1,
    height: 1,
    channels: 4,
    depth: 8,
    data: new Uint8Array([100, 150, 200, 255]),
  }),
);
const meta = { ...m, imageHash: normalized.imageHash },
  old = p.note(d, meta, 1n, 2n),
  next = p.note(d, meta, 3n, 4n);
const names = [
  "registry",
  "hasher",
  "creationAdapter",
  "spendAdapter",
  "creationVerifier",
  "spendVerifier",
];
const pins = {
  format: "zft-shielded-local-deployment-v1",
  chainId: d.chainId,
  genesisHash: "0x" + "a".repeat(64),
  deploymentBlock: "1",
  system: "groth16",
  contracts: Object.fromEntries(
    names.map((n, i) => [
      n,
      {
        address: i === 0 ? d.registry : "0x" + String(i + 2).repeat(40),
        codeHash: "0x" + "b".repeat(64),
      },
    ]),
  ),
  artifacts: Object.fromEntries(
    [
      "createWasm",
      "spendWasm",
      "createKey",
      "spendKey",
      "createVerificationKey",
      "spendVerificationKey",
    ].map((n) => [n, "0x" + "c".repeat(64)]),
  ),
};
test("shielded bearer import binds pixels and metadata; public copy has no authority", async () => {
  const file = await exportBearer(p, normalized.bytes, old),
    parsed = await importBearer(p, file, d);
  assert.deepEqual(parsed.note, old);
  assert.deepEqual(parsed.image, normalized.bytes);
  assert.deepEqual(await publicImage(p, file, d), normalized.bytes);
  await assert.rejects(importBearer(p, normalized.bytes, d));
  await assert.rejects(importBearer(p, file, { ...d, chainId: "1" }));
  const changed = file.slice();
  changed[changed.length - 30] ^= 1;
  await assert.rejects(importBearer(p, changed, d));
  await assert.rejects(
    exportBearer(p, normalized.bytes, p.note(d, { ...meta, width: 2 }, 1n, 2n)),
  );
  await assert.rejects(
    exportBearer(
      p,
      normalized.bytes,
      p.note(d, { ...meta, imageHash: "0x" + "f".repeat(64) }, 1n, 2n),
    ),
  );
});
test("encrypted recovery is self-contained, bound and rejects password/header/ciphertext changes", async () => {
  const record = operation(p, {
    image: normalized.bytes,
    source: old,
    destination: next,
    pins,
  });
  const sealed = await sealRecovery(record, "fixture password for tests"),
    opened = await openRecovery(sealed, "fixture password for tests", p, d);
  assert.deepEqual(opened.record, record);
  assert.deepEqual(opened.image, normalized.bytes);
  assert.ok(!sealed.includes(old.imageHash));
  await assert.rejects(openRecovery(sealed, "wrong password value", p, d));
  await assert.rejects(
    openRecovery(sealed, "fixture password for tests", p, {
      ...d,
      chainId: "1",
    }),
  );
  const raw = parseCanonical(sealed, 21000000);
  for (const patch of [
    { iterations: 1 },
    { format: "zft-v1" },
    {
      ciphertext:
        (raw.ciphertext[0] === "A" ? "B" : "A") + raw.ciphertext.slice(1),
    },
    { iv: "A".repeat(16) },
    { extra: 1 },
  ])
    await assert.rejects(
      openRecovery(
        canonical({ ...raw, ...patch }),
        "fixture password for tests",
        p,
        d,
      ),
    );
  const corrupted = await sealRecovery(
    { ...record, id: "0x" + "0".repeat(64) },
    "fixture password for tests",
  );
  await assert.rejects(
    openRecovery(corrupted, "fixture password for tests", p, d),
  );
});
test("recovery distinguishes observed destination, competition and unobserved state", () => {
  const record = operation(p, {
    image: normalized.bytes,
    source: old,
    destination: next,
    pins,
  });
  assert.equal(
    classifySpend(p, record, {
      nullifierPresent: false,
      successor: 0n,
      commitmentPresent: false,
    }).state,
    "unobserved",
  );
  assert.equal(
    classifySpend(p, record, {
      nullifierPresent: true,
      successor: BigInt(next.commitment),
      commitmentPresent: true,
    }).state,
    "observed",
  );
  assert.equal(
    classifySpend(p, record, {
      nullifierPresent: true,
      successor: 9n,
      commitmentPresent: false,
    }).state,
    "conflicted",
  );
  assert.throws(() =>
    classifySpend(p, record, {
      nullifierPresent: true,
      successor: BigInt(next.commitment),
      commitmentPresent: false,
    }),
  );
});

test("completed transfer becomes historical when its destination is spent", () => {
  const record = operation(p, {
    image: normalized.bytes,
    source: old,
    destination: next,
    pins,
  });
  assert.equal(
    classifySpend(p, record, {
      nullifierPresent: true,
      successor: BigInt(next.commitment),
      commitmentPresent: true,
      destinationSpent: true,
    }).state,
    "historical",
  );
});

test("recovery uses exactly 600000 iterations and rejects authenticated other-cost records", async () => {
  const password = "disposable hardened recovery fixture";
  const record = operation(p, {
    image: normalized.bytes,
    source: old,
    destination: next,
    pins,
  });
  const sealed = await sealRecovery(record, password);
  const { ciphertext, ...header } = parseCanonical(sealed, 21000000);
  assert.equal(
    header.iterations,
    600000,
    "Recovery export must record the exact hardened work factor",
  );
  const salt = Buffer.from(header.salt, "base64url");
  const iv = Buffer.from(header.iv, "base64url");
  const encrypted = Buffer.from(ciphertext, "base64url");
  // Separate Node crypto API checks the actual derivation, not just the header.
  const key = pbkdf2Sync(password, salt, 600000, 32, "sha256");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(canonical(header)));
  decipher.setAuthTag(encrypted.subarray(-16));
  const plaintext = Buffer.concat([
    decipher.update(encrypted.subarray(0, -16)),
    decipher.final(),
  ]);
  assert.deepEqual(JSON.parse(plaintext.toString("utf8")), record);
  assert.deepEqual((await openRecovery(sealed, password, p, d)).record, record);
  for (const iterations of [310000, 600001]) {
    const other = { ...header, iterations };
    const otherKey = pbkdf2Sync(password, salt, iterations, 32, "sha256");
    const cipher = createCipheriv("aes-256-gcm", otherKey, iv);
    cipher.setAAD(Buffer.from(canonical(other)));
    const bytes = Buffer.concat([
      cipher.update(Buffer.from(canonical(record))),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const authentic = canonical({
      ...other,
      ciphertext: bytes.toString("base64url"),
    });
    await assert.rejects(
      openRecovery(authentic, password, p, d),
      /Recovery could not be authenticated/,
      "Other work factors must reject even with authentic ciphertext",
    );
  }
});
