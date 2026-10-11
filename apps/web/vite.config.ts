import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("apps/web"),
  plugins: [react()],
  define: {
    __SHIELDED_CANDIDATE__: process.env.ZFT_SHIELDED_CANDIDATE === "1",
  },
  resolve:
    process.env.ZFT_SHIELDED_CANDIDATE === "1"
      ? {
          alias: {
            circomlibjs: resolve(
              "research/shielded-lab/node_modules/circomlibjs/src/poseidon_wasm.js",
            ),
          },
        }
      : undefined,
  build: { outDir: resolve("dist/web"), emptyOutDir: true },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/art": "http://127.0.0.1:8787",
      "/metadata": "http://127.0.0.1:8787",
      "/profile-media": "http://127.0.0.1:8787",
    },
  },
});
