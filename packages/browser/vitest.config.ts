import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  test: {
    testTimeout: 30000,
    projects: [
      {
        resolve: {
          alias: {
            "node:path": fileURLToPath(new URL("./src/node-path-shim.ts", import.meta.url)),
            "better-sqlite3": fileURLToPath(new URL("./src/better-sqlite3-shim.ts", import.meta.url)),
            "adm-zip": fileURLToPath(new URL("./src/adm-zip-shim.ts", import.meta.url)),
          },
        },
        test: {
          name: "browser",
          include: ["src/**/__tests__/**/*.browser.test.ts"],
          browser: {
            provider: playwright(),
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
