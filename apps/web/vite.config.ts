import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("apps/web"),
  plugins: [react()],
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
