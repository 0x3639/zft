// Fetches pinned public source metadata only. Never imports or executes fetched files.
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  lstatSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readSelected, safeName, verifySupplement } from "./source-package.mjs";
const here = dirname(fileURLToPath(import.meta.url));
if (process.argv.length !== 2) throw Error("No arguments supported");
const pins = JSON.parse(
  readFileSync(resolve(here, "source-pins.json"), "utf8"),
);
const cache = resolve(here, ".sources");
mkdirSync(cache, { recursive: true });
if (lstatSync(cache).isSymbolicLink())
  throw Error("Source cache must be a directory");
let reused = 0,
  downloaded = 0;
for (const record of pins.upstream)
  for (const source of record.supplements) {
    const name = safeName(
      record.package.replaceAll("/", "__") + "/" + source.path,
    );
    const path = resolve(cache, name);
    if (existsSync(path)) {
      verifySupplement(readSelected(cache, name), source);
      reused++;
      continue;
    }
    const url = new URL(source.url);
    if (
      url.origin !== "https://raw.githubusercontent.com" ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(
        "/" + record.repository + "/" + record.commit + "/",
      ) ||
      source.bytes > 4 * 1024 * 1024
    )
      throw Error("Unselected source URL");
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.body)
      throw Error("Pinned source fetch failed");
    const parts = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > source.bytes) throw Error("Pinned source response too large");
      parts.push(chunk);
    }
    const bytes = Buffer.concat(parts);
    verifySupplement(bytes, source);
    let directory = cache;
    for (const part of name.split("/").slice(0, -1)) {
      directory = resolve(directory, part);
      mkdirSync(directory, { recursive: true });
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error("Invalid cache path");
    }
    writeFileSync(path, bytes, { flag: "wx", mode: 0o644 });
    downloaded++;
  }
console.log(
  JSON.stringify({ downloaded, reused, executedUpstreamCode: false }),
);
