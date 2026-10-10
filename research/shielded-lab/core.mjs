import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { buildPoseidon } from "circomlibjs";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
export const Q =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEPTH = 16;
export const MAX_SECRET = 1n << 248n;
export const TAG_DOMAIN = keccak256(stringToHex("ZFT_SHIELDED_LOCAL_V1"));
export const TAG_ASSET = keccak256(stringToHex("ZFT_SHIELDED_ASSET_V1"));
const hash32 = /^0x[0-9a-f]{64}$/;
const address = /^0x[0-9a-f]{40}$/;
export function check(ok, message = "Invalid shielded record") {
  if (!ok) throw new Error(message);
}
export function exact(v, keys) {
  check(
    v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) === Object.prototype,
  );
  const found = Object.keys(v).sort(),
    expected = [...keys].sort();
  check(
    found.length === expected.length &&
      found.every((k, i) => k === expected[i]),
  );
}
export function canonical(v, depth = 0) {
  check(depth <= 16, "Record nesting too deep");
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") {
    check(
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        v,
      ),
      "Invalid Unicode",
    );
    return JSON.stringify(v);
  }
  if (typeof v === "number") {
    check(Number.isSafeInteger(v) && !Object.is(v, -0));
    return String(v);
  }
  if (Array.isArray(v))
    return "[" + v.map((x) => canonical(x, depth + 1)).join(",") + "]";
  check(
    v !== null &&
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype,
  );
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => canonical(k, depth + 1) + ":" + canonical(v[k], depth + 1))
      .join(",") +
    "}"
  );
}
export function parseCanonical(text, max = 16384) {
  check(
    typeof text === "string" && utf8ToBytes(text).length <= max,
    "Record too large",
  );
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw Error("Invalid JSON");
  }
  check(canonical(v) === text, "Noncanonical JSON");
  return v;
}
export function digest(bytes) {
  check(bytes instanceof Uint8Array);
  return "0x" + bytesToHex(sha256(bytes));
}
export const jsonDigest = (v) => digest(utf8ToBytes(canonical(v)));
export function uint(v, max = Q) {
  check(
    typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v),
    "Invalid unsigned integer",
  );
  const n = BigInt(v);
  check(n < max, "Integer out of range");
  return n;
}
export function deployment(v) {
  exact(v, ["chainId", "registry"]);
  uint(v.chainId, 1n << 256n);
  check(
    v.chainId !== "0" &&
      address.test(v.registry) &&
      !/^0x0{40}$/.test(v.registry),
  );
  return { ...v };
}
export function domain(d) {
  deployment(d);
  return (
    BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
          [TAG_DOMAIN, BigInt(d.chainId), d.registry],
        ),
      ),
    ) % Q
  );
}
export function metadata(v) {
  exact(v, [
    "format",
    "name",
    "description",
    "imageHash",
    "canonicalizer",
    "mediaType",
    "width",
    "height",
    "creator",
    "createdAt",
  ]);
  check(v.format === "zft-shielded-metadata-v1" && hash32.test(v.imageHash));
  check(v.canonicalizer === "zft-png/1" && v.mediaType === "image/png");
  check(
    Number.isSafeInteger(v.width) &&
      v.width > 0 &&
      Number.isSafeInteger(v.height) &&
      v.height > 0 &&
      v.width * v.height <= 24000000,
  );
  check(
    typeof v.name === "string" &&
      v.name.length > 0 &&
      utf8ToBytes(v.name).length <= 256 &&
      typeof v.description === "string" &&
      utf8ToBytes(v.description).length <= 4096,
  );
  check(address.test(v.creator) && !/^0x0{40}$/.test(v.creator));
  check(
    typeof v.createdAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.createdAt) &&
      Number.isFinite(Date.parse(v.createdAt)) &&
      new Date(v.createdAt).toISOString() === v.createdAt,
  );
  check(utf8ToBytes(canonical(v)).length <= 8192);
  return structuredClone(v);
}
export function asset(d, m) {
  deployment(d);
  metadata(m);
  const mh = jsonDigest(m);
  const id = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [TAG_ASSET, BigInt(d.chainId), d.registry, m.imageHash, mh],
    ),
  );
  return { imageHash: m.imageHash, metadataHash: mh, assetId: id };
}
export function limbs(h) {
  check(hash32.test(h));
  const n = BigInt(h);
  return [n >> 128n, n & ((1n << 128n) - 1n)];
}
export function randomSecret() {
  const b = crypto.getRandomValues(new Uint8Array(31));
  const n = BigInt("0x" + bytesToHex(b));
  return n === 0n ? randomSecret() : n;
}
export async function createProfile() {
  const poseidon = await buildPoseidon();
  const H = (values) => {
    check(values.every((x) => typeof x === "bigint" && x >= 0n && x < Q));
    return poseidon.F.toObject(poseidon(values));
  };
  function commitment(d, a, secret, randomness) {
    const [hi, lo] = limbs(a);
    check(
      secret > 0n &&
        secret < MAX_SECRET &&
        randomness > 0n &&
        randomness < MAX_SECRET,
    );
    return H([1n, domain(d), hi, lo, secret, randomness]);
  }
  function note(d, m, secret = randomSecret(), randomness = randomSecret()) {
    const a = asset(d, m);
    return {
      format: "zft-shielded-note-v1",
      deployment: deployment(d),
      metadata: metadata(m),
      ...a,
      secret: String(secret),
      randomness: String(randomness),
      commitment: String(commitment(d, a.assetId, secret, randomness)),
    };
  }
  function validate(n, d) {
    exact(n, [
      "format",
      "deployment",
      "metadata",
      "imageHash",
      "metadataHash",
      "assetId",
      "secret",
      "randomness",
      "commitment",
    ]);
    check(
      n.format === "zft-shielded-note-v1" &&
        canonical(deployment(n.deployment)) === canonical(deployment(d)),
      "Wrong deployment",
    );
    const expected = note(
      d,
      n.metadata,
      uint(n.secret, MAX_SECRET),
      uint(n.randomness, MAX_SECRET),
    );
    check(canonical(n) === canonical(expected), "Note binding mismatch");
    return expected;
  }
  function nullifier(n, d = n.deployment) {
    validate(n, d);
    return H([2n, domain(d), BigInt(n.secret), BigInt(n.commitment)]);
  }
  function creationInput(n) {
    validate(n, n.deployment);
    const [hi, lo] = limbs(n.assetId);
    return {
      domain: String(domain(n.deployment)),
      assetHi: String(hi),
      assetLo: String(lo),
      commitment: n.commitment,
      secret: n.secret,
      randomness: n.randomness,
    };
  }
  function spendInput(old, next, path) {
    validate(old, old.deployment);
    validate(next, old.deployment);
    check(old.assetId === next.assetId && old.commitment !== next.commitment);
    exact(path, ["root", "siblings", "bits"]);
    check(
      Array.isArray(path.siblings) &&
        Array.isArray(path.bits) &&
        path.siblings.length === DEPTH &&
        path.bits.length === DEPTH,
    );
    const root = uint(String(path.root));
    let current = BigInt(old.commitment);
    for (let i = 0; i < DEPTH; i++) {
      const sibling = uint(String(path.siblings[i]));
      check(path.bits[i] === 0 || path.bits[i] === 1);
      current =
        path.bits[i] === 0 ? H([current, sibling]) : H([sibling, current]);
    }
    check(current === root, "Membership mismatch");
    const [hi, lo] = limbs(old.assetId);
    return {
      domain: String(domain(old.deployment)),
      root: String(path.root),
      nullifier: String(nullifier(old)),
      outputCommitment: next.commitment,
      assetHi: String(hi),
      assetLo: String(lo),
      secret: old.secret,
      randomness: old.randomness,
      nextSecret: next.secret,
      nextRandomness: next.randomness,
      siblings: path.siblings.map(String),
      bits: path.bits.map(String),
    };
  }
  class Tree {
    constructor() {
      this.leaves = [];
      this.levels = Array.from({ length: DEPTH + 1 }, () => []);
      this.levels[0] = this.leaves;
      this.seen = new Set();
      this.zeros = [0n];
      for (let i = 0; i < DEPTH; i++)
        this.zeros.push(H([this.zeros[i], this.zeros[i]]));
    }
    static fromLeaves(leaves) {
      check(Array.isArray(leaves) && leaves.length <= 2 ** DEPTH);
      const tree = new Tree(),
        copy = Array.from(leaves);
      check(
        copy.every((c) => typeof c === "bigint" && c > 0n && c < Q) &&
          new Set(copy).size === copy.length,
      );
      tree.leaves = copy;
      tree.levels[0] = copy;
      tree.seen = new Set(copy);
      for (let level = 0; level < DEPTH; level++) {
        const row = tree.levels[level];
        for (let i = 0; i < row.length; i += 2)
          tree.levels[level + 1].push(
            H([row[i], row[i + 1] ?? tree.zeros[level]]),
          );
      }
      return tree;
    }
    append(c) {
      check(
        typeof c === "bigint" &&
          c > 0n &&
          c < Q &&
          !this.seen.has(c) &&
          this.leaves.length < 2 ** DEPTH,
      );
      const index = this.leaves.length;
      this.leaves.push(c);
      this.seen.add(c);
      let at = index;
      for (let level = 0; level < DEPTH; level++) {
        const row = this.levels[level],
          left = at - (at % 2);
        this.levels[level + 1][Math.floor(at / 2)] = H([
          row[left] ?? this.zeros[level],
          row[left + 1] ?? this.zeros[level],
        ]);
        at = Math.floor(at / 2);
      }
      return index;
    }
    path(index) {
      check(
        Number.isInteger(index) && index >= 0 && index < this.leaves.length,
      );
      let at = index;
      const siblings = [],
        bits = [];
      for (let level = 0; level < DEPTH; level++) {
        siblings.push(this.levels[level][at ^ 1] ?? this.zeros[level]);
        bits.push(at % 2);
        at = Math.floor(at / 2);
      }
      return { root: this.root, siblings, bits };
    }
    get root() {
      return this.levels[DEPTH][0] ?? this.zeros[DEPTH];
    }
  }

  class Forest {
    constructor() {
      this.trees = [new Tree()];
      this.leaves = [];
      this.seen = new Set();
    }
    static fromLeaves(leaves) {
      check(Array.isArray(leaves));
      const copy = Array.from(leaves);
      check(
        copy.every((c) => typeof c === "bigint" && c > 0n && c < Q) &&
          new Set(copy).size === copy.length,
      );
      const forest = new Forest();
      forest.leaves = copy;
      forest.seen = new Set(copy);
      forest.trees = [];
      for (let i = 0; i < copy.length; i += 2 ** DEPTH)
        forest.trees.push(Tree.fromLeaves(copy.slice(i, i + 2 ** DEPTH)));
      if (!forest.trees.length) forest.trees.push(new Tree());
      return forest;
    }
    append(c) {
      check(typeof c === "bigint" && c > 0n && c < Q && !this.seen.has(c));
      const index = this.leaves.length,
        treeId = Math.floor(index / 2 ** DEPTH);
      if (!this.trees[treeId]) this.trees.push(new Tree());
      this.trees[treeId].append(c);
      this.leaves.push(c);
      this.seen.add(c);
      return index;
    }
    path(index) {
      check(
        Number.isSafeInteger(index) && index >= 0 && index < this.leaves.length,
      );
      return this.trees[Math.floor(index / 2 ** DEPTH)].path(
        index % 2 ** DEPTH,
      );
    }
    get root() {
      return this.trees.at(-1).root;
    }
  }
  return {
    H,
    commitment,
    note,
    validate,
    nullifier,
    creationInput,
    spendInput,
    Tree,
    Forest,
  };
}
export { hexToBytes, utf8ToBytes };
