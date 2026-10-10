import { build } from "vite";
import { fileURLToPath } from "node:url";
await build({
  configFile: false,
  resolve: {
    alias: {
      circomlibjs: fileURLToPath(
        new URL(
          "../node_modules/circomlibjs/src/poseidon_wasm.js",
          import.meta.url,
        ),
      ),
    },
  },
  root: fileURLToPath(new URL("../client/", import.meta.url)),
  base: "/",
  build: {
    outDir: "../build/client",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
