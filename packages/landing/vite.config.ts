import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@spherse/i18n/react": resolve(__dirname, "../i18n/dist/react.js"),
      "@spherse/i18n": resolve(__dirname, "../i18n/dist/index.js"),
    },
  },
  build: {
    outDir: "dist",
  },
});
