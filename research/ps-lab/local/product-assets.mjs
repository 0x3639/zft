import assert from "node:assert/strict";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// Read only a fixed local build at startup, never a request-selected path.
export function productAssets(
  root = fileURLToPath(new URL("../../../dist/web/", import.meta.url)),
) {
  const assets = new Map();
  let size = 0,
    count = 0;
  const read = (path, type) => {
    const stat = lstatSync(path);
    assert(
      stat.isFile() && !stat.isSymbolicLink(),
      "regular build file required",
    );
    size += stat.size;
    assert(++count <= 2048 && size <= 64 * 1024 * 1024, "local build limit");
    return { type, data: readFileSync(path) };
  };
  assets.set(
    "/ps/",
    read(join(root, "index.html"), "text/html; charset=utf-8"),
  );
  const types = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
  };
  function scan(dir) {
    assert(
      lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink(),
      "regular build directory required",
    );
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      assert(!e.isSymbolicLink(), "build symlink rejected");
      if (e.isDirectory()) scan(path);
      else {
        const extension = "." + e.name.split(".").at(-1);
        if (Object.hasOwn(types, extension))
          assets.set(
            "/" + relative(root, path).split("\\").join("/"),
            read(path, types[extension]),
          );
      }
    }
  }
  scan(join(root, "assets"));
  return assets;
}
export function productRoute(url) {
  return (
    /^\/ps\/?$/.test(url) ||
    /^\/ps\/(create|receive|recover)$/.test(url) ||
    /^\/ps\/item\/[0-9a-f]{64}\/[0-9a-f]{96}$/.test(url)
  );
}
