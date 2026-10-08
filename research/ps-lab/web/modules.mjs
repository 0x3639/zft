// Build fixed browser ESM assets from unchanged local validators.
// No generated files are committed and no request controls a filesystem path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, posix } from "node:path";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
function replace(source, from, to) {
  assert.equal(source.split(from).length, 2, "portable source anchor changed");
  return source.replace(from, to);
}
export function browserModules() {
  const modules = new Map();
  let verify = read("../verify.mjs");
  verify = replace(
    verify,
    'import assert from "node:assert/strict";',
    'import assert, {bytesToHex, hexToBytes, concatBytes} from "./runtime.mjs";',
  );
  verify = replace(
    verify,
    'Buffer.from(bytes).toString("hex")',
    "bytesToHex(bytes)",
  );
  verify = replace(
    verify,
    "new Uint8Array(Buffer.concat(parts))",
    "concatBytes(...parts)",
  );
  verify = replace(
    verify,
    'new Uint8Array(Buffer.from(value, "hex"))',
    "hexToBytes(value)",
  );
  modules.set("/web/verify.mjs", verify);
  let profile = read("../local/profile.mjs");
  profile = replace(
    profile,
    'import assert from "node:assert/strict";',
    'import assert, {hash, randomHex} from "./runtime.mjs";',
  );
  profile = replace(
    profile,
    'import { createHash, randomBytes } from "node:crypto";\n',
    "",
  );
  profile = replace(profile, 'from "../verify.mjs"', 'from "./verify.mjs"');
  profile = replace(
    profile,
    'export const hash = (data) => createHash("sha256").update(data).digest("hex");',
    "export {hash};",
  );
  profile = replace(
    profile,
    'export const randomHex = (size) => randomBytes(size).toString("hex");',
    "export {randomHex};",
  );
  profile = replace(profile, "Buffer.byteLength(wire)", "utf8(wire).length");
  modules.set("/web/profile.mjs", profile);
  const client = read("../local/client.mjs");
  const imports = client.slice(0, client.indexOf("export class Client"));
  const validator = client.slice(
    client.indexOf("  validateSnapshot(snapshot) {"),
    client.indexOf("  savePending(s, asset, source = null) {"),
  );
  assert(
    validator.length > 100 && !validator.includes("this.db"),
    "snapshot validator extraction",
  );
  modules.set(
    "/web/snapshot.mjs",
    replace(
      replace(
        imports,
        'import { store, transaction } from "./store.mjs";\n',
        "",
      ),
      '"node:assert/strict"',
      '"./runtime.mjs"',
    ) +
      "export class Client {\n" +
      validator +
      "}\n",
  );
  const vault = read("../local/vault.mjs");
  let schema = vault.slice(
    vault.indexOf("export const FORMAT"),
    vault.indexOf("export class LocalVault"),
  );
  const start = schema.indexOf("function passwordKey("),
    end = schema.indexOf("function record(");
  assert(start > 0 && end > start, "vault schema extraction");
  schema = schema.slice(0, start) + schema.slice(end);
  schema = replace(
    schema,
    "const hex = (s, n) => Buffer.from(p.bytes(s, n));",
    "const hex = (s,n) => p.bytes(s,n);",
  );
  schema = replace(
    schema,
    'const randomHex = (n) => randomBytes(n).toString("hex");\n',
    "",
  );
  schema = replace(schema, "Buffer.byteLength(wire)", "p.utf8(wire).length");
  modules.set(
    "/web/schema.mjs",
    'import assert from "./runtime.mjs";\nimport * as p from "./profile.mjs";\nimport {Client} from "./snapshot.mjs";\n' +
      schema +
      "\nexport {content,validateContent,header,record};\n",
  );
  for (const file of [
    "runtime.mjs",
    "vault.mjs",
    "storage.mjs",
    "worker.mjs",
    "vault-ui.mjs",
    "checks.mjs",
  ])
    modules.set("/web/" + file, read("./" + file));
  // Resolve the installed, lock-pinned noble dependency closure at startup only.
  const require = createRequire(import.meta.url);
  const roots = Object.fromEntries(
    ["curves", "hashes"].map((name) => [
      name,
      dirname(require.resolve("@noble/" + name + "/utils.js")),
    ]),
  );
  function vendor(specifier) {
    assert(
      /^@noble\/(curves|hashes)\/(?:[\w-]+\/)*[\w-]+\.js$/.test(specifier),
      "vendor allowlist",
    );
    const url = "/vendor/" + specifier;
    if (modules.has(url)) return url;
    const [, name, ...parts] = specifier.split("/");
    const source = readFileSync(roots[name] + "/" + parts.join("/"), "utf8");
    modules.set(url, source);
    modules.set(url, rewrite(source, url));
    return url;
  }
  function rewrite(source, url) {
    return source.replace(
      /((?:from\s*|import\s*)["'])([^"']+)(["'])/g,
      (all, before, spec, after) => {
        if (spec.startsWith("@noble/"))
          return (
            before + posix.relative(posix.dirname(url), vendor(spec)) + after
          );
        if (
          spec.startsWith(".") &&
          (url.startsWith("/vendor/") || spec.startsWith("../vendor/"))
        ) {
          const resolved = posix.normalize(
            posix.join(posix.dirname(url), spec),
          );
          assert(resolved.startsWith("/vendor/@noble/"), "dependency path");
          vendor(resolved.slice("/vendor/".length));
        }
        return all;
      },
    );
  }
  for (const [url, source] of [...modules])
    modules.set(url, rewrite(source, url));
  for (const [url, source] of modules)
    assert(
      !/["']node:/.test(source) &&
        (!url.startsWith("/web/") || !/\bBuffer\./.test(source)),
      "unported browser module " + url,
    );
  return modules;
}
