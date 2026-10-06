// Local workerd visual fixtures. No chain writes, account keys, or hosted bindings.
import { encode, decode } from "fast-png";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url);
process.chdir(root.pathname);
const dir = ".local/og-fixtures",
  output = "research/sharing-fixtures";
await mkdir(dir, { recursive: true });
await mkdir(output, { recursive: true });
for (const [label, w, h, color] of [
  ["red", 320, 320, [239, 69, 69]],
  ["blue", 320, 320, [25, 119, 240]],
  ["yellow", 320, 320, [250, 199, 29]],
  ["magenta", 320, 320, [225, 35, 225]],
  ["portrait", 320, 640, [239, 69, 69]],
  ["landscape", 640, 320, [239, 69, 69]],
  ["large", 6000, 4000, [0, 0, 0]],
  ["avatar", 256, 256, [0, 217, 148]],
  ["cover", 1280, 480, [24, 88, 138]],
]) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c =
        label === "large"
          ? [x % 256, y % 256, (x * 13 + y * 7) % 256]
          : (x + y) % 80 < 20
            ? [12, 18, 24]
            : color;
      data.set([...c, 255], (y * w + x) * 4);
    }
  await writeFile(
    `${dir}/${label}.png`,
    encode(
      { width: w, height: h, data, channels: 4, depth: 8 },
      { zlib: { level: 6 } },
    ),
  );
}
await writeFile(
  `${dir}/worker.ts`,
  await readFile(new URL("./fixtures/og-worker.txt", import.meta.url)),
);
await writeFile(
  `${dir}/wrangler.jsonc`,
  JSON.stringify({
    name: "zft-og-local-test",
    main: "worker.ts",
    compatibility_date: "2026-10-04",
    compatibility_flags: ["nodejs_compat"],
    rules: [
      { type: "Data", globs: ["**/*.woff", "**/*.png"], fallthrough: true },
    ],
  }),
);
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    `${dir}/wrangler.jsonc`,
    "--port",
    "8788",
    "--local",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: `${process.cwd()}/${dir}/wrangler.log`,
    },
  },
);
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
try {
  await new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (log.includes("Ready on")) {
        clearInterval(t);
        clearTimeout(limit);
        resolve();
      }
    }, 100);
    const limit = setTimeout(() => {
      clearInterval(t);
      reject(new Error("Worker startup timed out: " + log));
    }, 30000);
    child.once("exit", (code) => {
      clearInterval(t);
      clearTimeout(limit);
      reject(new Error(`Worker exited ${code}: ${log}`));
    });
  });
  const checks = [];
  const profilePixels = {};
  const artworkPixels = {};
  for (const fixture of [
    "0",
    "1",
    "2",
    "3",
    "4",
    "large",
    "missing",
    "profile",
    "profile-missing",
    "long-title",
    "portrait",
    "landscape",
    "help-basics",
    "help-technical",
  ]) {
    const res = await fetch(`http://localhost:8788/${fixture}`),
      bytes = new Uint8Array(await res.arrayBuffer());
    if (!res.ok) throw new Error(new TextDecoder().decode(bytes));
    const image = decode(bytes);
    if (image.width !== 1200 || image.height !== 630 || bytes.length > 1048576)
      throw new Error("Invalid OG dimensions/size");
    const colors = { red: 0, blue: 0, yellow: 0, magenta: 0 };
    for (let i = 0; i < image.data.length; i += image.channels) {
      const r = image.data[i],
        g = image.data[i + 1],
        b = image.data[i + 2];
      if (r > 180 && g < 100 && b < 100) colors.red++;
      if (b > 190 && r < 80 && g > 80 && g < 160) colors.blue++;
      if (r > 200 && g > 150 && b < 70) colors.yellow++;
      if (r > 170 && b > 170 && g < 90) colors.magenta++;
    }
    artworkPixels[fixture] = colors;
    if (fixture.startsWith("profile")) {
      // These regions exclude the title and NFT collage. The first covers the
      // avatar; the second is bare background where only the cover can paint.
      const count = (x0, y0, width, height, match) => {
        let total = 0;
        for (let y = y0; y < y0 + height; y++)
          for (let x = x0; x < x0 + width; x++) {
            const i = (y * image.width + x) * image.channels;
            if (match(image.data[i], image.data[i + 1], image.data[i + 2]))
              total++;
          }
        return total;
      };
      profilePixels[fixture] = {
        avatar: count(
          65,
          65,
          50,
          50,
          (r, g, b) => r < 10 && g > 200 && b > 135 && b < 160,
        ),
        cover: count(10, 180, 30, 100, (r, g, b) => r < 20 && g > 20 && b > 30),
      };
    }
    await writeFile(`${output}/${fixture}.png`, bytes);
    checks.push({
      fixture,
      bytes: bytes.length,
      width: image.width,
      height: image.height,
      renderMs: Number(res.headers.get("x-render-ms")),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  assert(profilePixels.profile.avatar > 1000, "Profile avatar pixels missing");
  assert(profilePixels.profile.cover > 1500, "Profile cover pixels missing");
  assert.equal(profilePixels["profile-missing"].avatar, 0);
  assert.equal(profilePixels["profile-missing"].cover, 0);
  for (const key of ["0", "missing", "help-basics", "help-technical"])
    assert.deepEqual(artworkPixels[key], {
      red: 0,
      blue: 0,
      yellow: 0,
      magenta: 0,
    });
  for (const key of ["1", "2", "3", "4", "long-title", "portrait", "landscape"])
    assert(
      artworkPixels[key].red > 10_000,
      `${key}: foreground artwork missing`,
    );
  assert.equal(artworkPixels["1"].blue, 0);
  assert.equal(artworkPixels["1"].yellow, 0);
  assert.equal(artworkPixels["2"].yellow, 0);
  for (const key of ["2", "3", "4"]) assert(artworkPixels[key].blue > 500);
  for (const key of ["3", "4"]) assert(artworkPixels[key].yellow > 1_000);
  assert.equal(
    artworkPixels["4"].magenta,
    0,
    "Only three artworks should render",
  );
  const hashFor = (fixture) => checks.find((c) => c.fixture === fixture).sha256;
  assert.equal(
    hashFor("3"),
    hashFor("4"),
    "Fourth artwork must not change a capped collage",
  );
  assert.notEqual(hashFor("help-basics"), hashFor("help-technical"));
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        runtime: "local Cloudflare workerd",
        largeInput: {
          width: 6000,
          height: 4000,
          bytes: (await stat(`${dir}/large.png`)).size,
        },
        checks,
        profilePixels,
        artworkPixels,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "OG renderer passed: fourteen bounded 1200×630 fixtures with NFT/profile pixels, help views, long titles, crops and 24 MP / >1 MiB source. Inspect research/sharing-fixtures/*.png.",
  );
} finally {
  child.kill("SIGTERM");
}
