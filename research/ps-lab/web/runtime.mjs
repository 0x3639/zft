// Minimal browser adapters for the unchanged lab validators; not a Node polyfill.
import { sha256 } from "../vendor/@noble/hashes/sha2.js";
import {
  bytesToHex,
  hexToBytes,
  concatBytes,
} from "../vendor/@noble/hashes/utils.js";
export { bytesToHex, hexToBytes, concatBytes };
export const utf8 = (value) => new TextEncoder().encode(value);
export const hash = (value) =>
  bytesToHex(sha256(typeof value === "string" ? utf8(value) : value));
export const randomHex = (size) =>
  bytesToHex(crypto.getRandomValues(new Uint8Array(size)));
export function assert(ok, message = "validation failed") {
  if (!ok) throw new Error(message);
}
assert.equal = (a, b, message) => assert(a === b, message);
assert.notEqual = (a, b, message) => assert(a !== b, message);
assert.match = (value, pattern) =>
  assert(typeof value === "string" && pattern.test(value));
const same = (a, b) =>
  a === b ||
  (a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    Object.getPrototypeOf(a) === Object.getPrototypeOf(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k])));
assert.deepEqual = (a, b, message) => assert(same(a, b), message);
export default assert;
