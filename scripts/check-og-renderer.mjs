// Local workerd visual fixtures. No chain writes, account keys, or hosted bindings.
import { encode, decode } from "fast-png";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
  ["large", 6000, 4000, [0, 0, 0]],
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
  for (const fixture of ["0", "1", "2", "3", "large", "missing"]) {
    const res = await fetch(`http://localhost:8788/${fixture}`),
      bytes = new Uint8Array(await res.arrayBuffer());
    if (!res.ok) throw new Error(new TextDecoder().decode(bytes));
    const image = decode(bytes);
    if (image.width !== 1200 || image.height !== 630 || bytes.length > 1048576)
      throw new Error("Invalid OG dimensions/size");
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
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "OG renderer passed: six bounded 1200×630 fixtures including 24 MP / >1 MiB source. Inspect research/sharing-fixtures/*.png.",
  );
} finally {
  child.kill("SIGTERM");
}
