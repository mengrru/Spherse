import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  base: "./",
  resolve: {
    alias: {
      "@": resolve(__dirname, "../app/src"),
      "@spherse/app/src": resolve(__dirname, "../app/src"),
      "@spherse/i18n/react": resolve(__dirname, "../i18n/dist/react.js"),
      "@spherse/i18n": resolve(__dirname, "../i18n/dist/index.js"),
    },
  },
  build: {
    outDir: "dist",
  },
});
