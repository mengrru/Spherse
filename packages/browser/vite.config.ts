import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

const browserVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  root: ".",
  base: "./",
  define: {
    __SPHERSE_BROWSER_VERSION__: JSON.stringify(browserVersion),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "../app/src"),
      "@spherse/i18n/react": resolve(__dirname, "../i18n/dist/react.js"),
      "@spherse/i18n": resolve(__dirname, "../i18n/dist/index.js"),
      "node:path": "@spherse/core/paths",
      "better-sqlite3": resolve(__dirname, "./src/better-sqlite3-shim.ts"),
      "adm-zip": resolve(__dirname, "./src/adm-zip-shim.ts"),
    },
  },
  worker: {
    format: "es",
    rollupOptions: {
      external: (id: string) =>
        id === "@modelcontextprotocol/client/stdio" ||
        id.endsWith("/node_modules/@modelcontextprotocol/client/dist/stdio.mjs") ||
        id === "better-sqlite3" ||
        id === "adm-zip" ||
        (id.startsWith("node:") && id !== "node:path"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "./index.html"),
      },
      external: (id) =>
        id === "@modelcontextprotocol/client/stdio" ||
        id.endsWith("/node_modules/@modelcontextprotocol/client/dist/stdio.mjs") ||
        id === "better-sqlite3" ||
        id === "adm-zip" ||
        (id.startsWith("node:") && id !== "node:path") ||
        (id.startsWith("node_modules/") && id.includes("node:")),
    },
  },
});
