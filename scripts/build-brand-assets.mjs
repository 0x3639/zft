import { format } from "prettier";
// Regenerate deterministic runtime assets while preserving the supplied package.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const satoriRequire = createRequire(require.resolve("satori"));
const { parse } = satoriRequire("@shuding/opentype.js");
const root = "apps/web/public/assets/brand";
const fontBytes = await readFile("scripts/brand/IBMPlexMono-SemiBold.ttf");
const font = parse(
  fontBytes.buffer.slice(
    fontBytes.byteOffset,
    fontBytes.byteOffset + fontBytes.byteLength,
  ),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inventory = [];
async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(file)));
    else out.push(file);
  }
  return out.sort();
}
function outlined(source) {
  let svg = source
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
    .replace(/ xmlns:c2pa="[^"]+"/g, "");
  assert(
    !/<(?:script|foreignObject)\b|\bon\w+=|\b(?:href|xlink:href)=/i.test(svg),
  );
  svg = svg.replace(
    /<text\b([^>]*)>([\s\S]*?)<\/text>/g,
    (_, attributes, content) => {
      const a = Object.fromEntries(
        [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [
          m[1],
          m[2],
        ]),
      );
      assert.equal(a["font-weight"], "600");
      assert(a["font-family"].includes("IBM Plex Mono"));
      const runs = [];
      const pieces = content.split(/(<tspan\b[^>]*>[\s\S]*?<\/tspan>)/);
      for (const piece of pieces.filter(Boolean)) {
        const span = piece.match(/^<tspan\b([^>]*)>([^<]*)<\/tspan>$/);
        const text = span ? span[2] : piece;
        assert(/^[zft.]+$/.test(text));
        runs.push({
          text,
          fill: span?.[1].match(/fill="([^"]+)"/)?.[1] ?? a.fill,
        });
      }
      let x = Number(a.x);
      const size = Number(a["font-size"]),
        y = Number(a.y),
        spacing = Number(a["letter-spacing"] ?? 0);
      return (
        "<g>" +
        runs
          .map((run) =>
            [...run.text]
              .map((character) => {
                const glyph = font.charToGlyph(character);
                const d = glyph.getPath(x, y, size).toPathData(3);
                x += (glyph.advanceWidth / font.unitsPerEm) * size + spacing;
                return `<path fill="${run.fill}" d="${d}"/>`;
              })
              .join(""),
          )
          .join("") +
        "</g>"
      );
    },
  );
  assert(!/<(?:text|tspan)\b/.test(svg));
  return svg + "\n";
}
for (const file of await files(`${root}/original`)) {
  const bytes = await readFile(file),
    relative = path.relative(`${root}/original`, file);
  const entry = {
    file: relative,
    original: `/assets/brand/original/${relative}`,
    sha256: hash(bytes),
    bytes: bytes.length,
  };
  if (file.endsWith(".svg")) {
    const generated = outlined(bytes.toString("utf8"));
    await mkdir(path.dirname(`${root}/rendered/${relative}`), {
      recursive: true,
    });
    await writeFile(`${root}/rendered/${relative}`, generated);
    entry.rendered = `/assets/brand/rendered/${relative}`;
    entry.renderedSha256 = hash(generated);
  }
  inventory.push(entry);
}
await writeFile(
  `${root}/manifest.json`,
  JSON.stringify(
    {
      version: 1,
      font: {
        name: "IBM Plex Mono SemiBold",
        sha256: hash(fontBytes),
        source: "https://github.com/google/fonts/tree/main/ofl/ibmplexmono",
        license: "/licenses/IBM-Plex-Mono.txt",
      },
      assets: inventory,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "apps/web/public/favicon.svg",
  await readFile(`${root}/rendered/favicon/favicon-tile.svg`),
);
const pngs = await Promise.all(
  [16, 32, 48].map((size) =>
    readFile(`${root}/original/favicon/favicon-tile-${size}.png`),
  ),
);
const header = Buffer.alloc(6 + pngs.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
for (let i = 0; i < pngs.length; i++) {
  const start = 6 + i * 16,
    size = [16, 32, 48][i];
  header[start] = size;
  header[start + 1] = size;
  header.writeUInt16LE(1, start + 4);
  header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(pngs[i].length, start + 8);
  header.writeUInt32LE(offset, start + 12);
  offset += pngs[i].length;
}
await writeFile(
  "apps/web/public/favicon.ico",
  Buffer.concat([header, ...pngs]),
);
const dark = await readFile(
  `${root}/rendered/logo/zft-lockup-horizontal-on-dark.svg`,
  "utf8",
);
const mark = await readFile(
  `${root}/rendered/logo/zft-mark-on-dark.svg`,
  "utf8",
);
await writeFile(
  "packages/protocol/brand.ts",
  await format(
    `// Generated by scripts/build-brand-assets.mjs. Supplied geometry; outlined lettering.\nexport const BRAND_REVISION = "zft-2026-10" as const;\nexport const BRAND_LOCKUP_DARK = ${JSON.stringify(dark)};\nexport const BRAND_MARK_DARK = ${JSON.stringify(mark)};\n`,
    { parser: "typescript" },
  ),
);
console.log(
  `Preserved ${inventory.length} supplied files; generated font-independent SVGs and favicon aliases.`,
);

const card = (entry) =>
  `<article><div class="preview ${entry.file.includes("on-light") || entry.file.includes("avatar-light") ? "light" : "dark"}"><img src="${entry.rendered ?? entry.original}" alt="${entry.file}" loading="lazy"></div><h2>${entry.file.split("/").at(-1)}</h2><p><a href="${entry.original}" download>Original</a>${entry.rendered ? ` · <a href="${entry.rendered}" download>Web SVG</a>` : ""}</p></article>`;
await writeFile(
  `${root}/index.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZFT · Brand assets</title><link rel="icon" href="/favicon.svg?v=2026-10"><link rel="stylesheet" href="/assets/brand/gallery.css"></head><body><main><header><img src="/assets/brand/rendered/logo/zft-lockup-horizontal-on-dark.svg" width="200" height="60" alt="ZFT"><h1>Brand assets</h1><p>All ${inventory.length} supplied files are preserved. Web SVGs outline the lettering so they render consistently without installed fonts.</p><p><a href="/assets/brand/original/README.txt">Original notes</a> · <a href="/assets/brand/manifest.json">Asset inventory</a> · <a href="/licenses/IBM-Plex-Mono.txt">Font license</a> · <a href="/">Back to ZFT</a></p></header>${[
    "logo",
    "favicon",
    "avatar",
    "app-icon",
  ]
    .map(
      (group) =>
        `<section><h2>${group === "app-icon" ? "App icons" : group.charAt(0).toUpperCase() + group.slice(1)}</h2><div class="grid">${inventory
          .filter((entry) => entry.file.startsWith(group + "/"))
          .map(card)
          .join("")}</div></section>`,
    )
    .join("")}</main></body></html>
`,
);
