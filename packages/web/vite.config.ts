import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const webVersion = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
).version as string;

export default defineConfig({
  define: {
    __SPHERSE_WEB_VERSION__: JSON.stringify(webVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "inline",
      includeAssets: [
        "favicon.svg",
        "icons/apple-touch-icon.png",
        "icons/pwa-192x192.png",
      ],
      manifest: {
        name: "Spherse",
        short_name: "Spherse",
        description: "AI 辅助文字创作与演绎的桌面工具 — 移动端",
        display: "standalone",
        orientation: "portrait",
        background_color: "#fafafa",
        theme_color: "#fafafa",
        icons: [
          {
            src: "icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/preview\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  root: ".",
  base: "./",
  resolve: {
    alias: {
      "@": resolve(__dirname, "../app/src"),
      "@spherse/i18n/react": resolve(__dirname, "../i18n/dist/react.js"),
      "@spherse/i18n": resolve(__dirname, "../i18n/dist/index.js"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-markdown") || id.includes("/remark-") || id.includes("/rehype-") || id.includes("/unified") || id.includes("/micromark") || id.includes("/mdast-")) {
            return "vendor-markdown";
          }
          if (id.includes("/react-router") || id.includes("react-dom") || id.endsWith("/react/index.js") || id.includes("/react/")) {
            return "vendor-react";
          }
        },
      },
    },
  },
});
