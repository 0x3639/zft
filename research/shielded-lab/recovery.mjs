import {
  check,
  exact,
  canonical,
  parseCanonical,
  utf8ToBytes,
  digest,
  uint,
} from "./core.mjs";
import { validatePins, pinDeployment } from "./chain.mjs";
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_PLAINTEXT = 15 * 1024 * 1024,
  MAX_CIPHERTEXT = 21 * 1024 * 1024;
export function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export function unbase64(text, max) {
  check(
    typeof text === "string" &&
      text.length <= Math.ceil((max * 4) / 3) &&
      /^[A-Za-z0-9_-]*$/.test(text) &&
      text.length % 4 !== 1,
    "Invalid byte encoding",
  );
  let s;
  try {
    s = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    throw Error("Invalid byte encoding");
  }
  const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
  check(
    bytes.length <= max && base64(bytes) === text,
    "Noncanonical byte encoding",
  );
  return bytes;
}
export function operation(
  profile,
  { image, source = null, destination, pins, creation = null },
) {
  const checkedPins = validatePins(pins);
  profile.validate(destination, pinDeployment(checkedPins));
  check(digest(image) === destination.imageHash, "Recovery image mismatch");
  if (source) {
    profile.validate(source, destination.deployment);
    check(
      source.assetId === destination.assetId &&
        source.commitment !== destination.commitment,
      "Invalid successor",
    );
    check(creation === null);
  } else {
    exact(creation, ["authorization", "salt", "signature"]);
    const a = creation.authorization;
    exact(a, [
      "imageHash",
      "metadataHash",
      "commitment",
      "creator",
      "nonce",
      "deadline",
    ]);
    check(
      a.imageHash === destination.imageHash &&
        a.metadataHash === destination.metadataHash &&
        a.commitment === destination.commitment &&
        a.creator === destination.metadata.creator,
      "Creation binding mismatch",
    );
    uint(a.nonce, 1n << 256n);
    uint(a.deadline, 1n << 256n);
    check(
      /^0x[0-9a-f]{64}$/.test(creation.salt) &&
        /^0x[0-9a-f]{130}$/.test(creation.signature),
      "Creation encoding",
    );
  }
  const intent = {
    format: "zft-shielded-operation-v1",
    kind: source ? "spend" : "create",
    source,
    destination,
    pins,
    creation,
    image: base64(image),
  };
  return { ...intent, id: digest(utf8ToBytes(canonical(intent))) };
}
export function validateOperation(profile, record, deployment) {
  exact(record, [
    "format",
    "kind",
    "source",
    "destination",
    "pins",
    "creation",
    "image",
    "id",
  ]);
  check(record.format === "zft-shielded-operation-v1");
  profile.validate(record.destination, deployment);
  const image = unbase64(record.image, 10 * 1024 * 1024);
  const expected = operation(profile, {
    image,
    source: record.source,
    destination: record.destination,
    pins: record.pins,
    creation: record.creation,
  });
  check(canonical(expected) === canonical(record), "Recovery binding mismatch");
  return { record: expected, image };
}
function passwordBytes(password) {
  check(
    typeof password === "string" &&
      password.length >= 12 &&
      password.length <= 1024,
    "Password must contain 12–1024 characters",
  );
  canonical(password);
  return encoder.encode(password);
}
async function key(password, salt, usage) {
  const material = await crypto.subtle.importKey(
    "raw",
    passwordBytes(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}
export async function sealRecovery(record, password) {
  const plaintext = utf8ToBytes(canonical(record));
  check(plaintext.length <= MAX_PLAINTEXT, "Recovery too large");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: "zft-shielded-recovery-aes256gcm-v1",
    kdf: "PBKDF2-SHA256",
    iterations: 310000,
    salt: base64(salt),
    iv: base64(iv),
  };
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: utf8ToBytes(canonical(header)),
        tagLength: 128,
      },
      await key(password, salt, "encrypt"),
      plaintext,
    ),
  );
  return canonical({ ...header, ciphertext: base64(ciphertext) });
}
export async function openRecovery(text, password, profile, deployment) {
  try {
    const wrapped = parseCanonical(text, MAX_CIPHERTEXT);
    exact(wrapped, ["format", "kdf", "iterations", "salt", "iv", "ciphertext"]);
    check(
      wrapped.format === "zft-shielded-recovery-aes256gcm-v1" &&
        wrapped.kdf === "PBKDF2-SHA256" &&
        wrapped.iterations === 310000,
    );
    const { ciphertext, ...header } = wrapped,
      salt = unbase64(wrapped.salt, 16),
      iv = unbase64(wrapped.iv, 12);
    check(salt.length === 16 && iv.length === 12);
    const encrypted = unbase64(ciphertext, MAX_PLAINTEXT + 16);
    check(encrypted.length >= 16);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: utf8ToBytes(canonical(header)),
        tagLength: 128,
      },
      await key(password, salt, "decrypt"),
      encrypted,
    );
    return validateOperation(
      profile,
      parseCanonical(decoder.decode(plaintext), MAX_PLAINTEXT),
      deployment,
    );
  } catch {
    throw Error("Recovery could not be authenticated for this deployment");
  }
}
// An RPC response is an observation. The caller separately applies a qualified finality policy.
export function classifySpend(
  profile,
  record,
  { nullifierPresent, successor, commitmentPresent, destinationSpent = false },
) {
  check(record.kind === "spend");
  profile.validate(record.source, record.destination.deployment);
  profile.validate(record.destination, record.destination.deployment);
  check(
    typeof nullifierPresent === "boolean" &&
      typeof commitmentPresent === "boolean" &&
      typeof destinationSpent === "boolean",
  );
  if (!nullifierPresent) {
    check(String(successor) === "0");
    return {
      state: "unobserved",
      nullifier: String(profile.nullifier(record.source)),
      destination: record.destination.commitment,
    };
  }
  if (String(successor) !== record.destination.commitment)
    return { state: "conflicted" };
  check(commitmentPresent, "Inconsistent chain observation");
  return {
    state: destinationSpent ? "historical" : "observed",
    destination: record.destination.commitment,
  };
}

export function classifyCreation(
  record,
  { assetId, commitmentPresent, destinationSpent = false },
) {
  check(
    record.kind === "create" &&
      /^0x[0-9a-f]{64}$/.test(assetId) &&
      typeof commitmentPresent === "boolean" &&
      typeof destinationSpent === "boolean",
  );
  if (/^0x0{64}$/.test(assetId)) {
    check(!commitmentPresent);
    return { state: "unobserved" };
  }
  if (assetId !== record.destination.assetId || !commitmentPresent)
    return { state: "conflicted" };
  return {
    state: destinationSpent ? "historical" : "observed",
    destination: record.destination.commitment,
  };
}
