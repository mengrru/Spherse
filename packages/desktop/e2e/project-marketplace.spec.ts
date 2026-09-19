import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

import { closeApp } from "./helpers/electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");

test.setTimeout(120_000);

async function startStubMarketplace(): Promise<{ manifestUrl: string; close: () => Promise<void> }> {
  const zip = new AdmZip();
  zip.addFile("e2e-world/", Buffer.alloc(0));
  zip.addFile("e2e-world/AGENTS.md", Buffer.from("# E2E World\n"));
  zip.addFile("e2e-world/notes.md", Buffer.from("hello from marketplace\n"));
  const zipBuffer = zip.toBuffer();
  const zipPath = "/spherse/projects/e2e-world/1.0.0/e2e-world-1.0.0.zip";
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projects: [
      {
        name: "e2e-world",
        description: "E2E marketplace project",
        version: "1.0.0",
        category: "游戏",
        zipUrl: "",
        size: zipBuffer.length,
        updatedAt: new Date().toISOString(),
      },
    ],
  };

  const server = http.createServer((req, res) => {
    if (req.url === "/manifest.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(manifest));
      return;
    }
    if (req.url === zipPath) {
      res.writeHead(200, { "content-type": "application/zip" });
      res.end(zipBuffer);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  manifest.projects[0].zipUrl = `http://127.0.0.1:${address.port}${zipPath}`;
  return {
    manifestUrl: `http://127.0.0.1:${address.port}/manifest.json`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

test("marketplace download installs and opens the project", async () => {
  const stub = await startStubMarketplace();
  const destDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-market-dest-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-market-user-"));
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      cwd: appRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_ENABLE_LOGGING: "1",
        XDG_CONFIG_HOME: userDataDir,
        SPHERSE_PROJECT_MARKETPLACE_MANIFEST_URL: stub.manifestUrl,
        SPHERSE_E2E_SELECT_DIRECTORY: destDir,
      },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("搭建属于你自己的世界")).toBeVisible({ timeout: 30_000 });

    await page.locator("div[data-activity-bar] button[title='添加项目']").click();
    await page.getByRole("menuitem", { name: "市场" }).click();
    await expect(page.getByText("项目市场")).toBeVisible({ timeout: 15_000 });

    const card = page.locator("[data-market-project='e2e-world']");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "下载" }).click();

    await expect(page.locator("[data-project-avatar]")).toHaveCount(1, { timeout: 30_000 });
    await expect.poll(() => page.url()).toContain("/project/");

    const projectRoot = path.join(destDir, "e2e-world");
    const content = await readFile(path.join(projectRoot, "notes.md"), "utf-8");
    expect(content).toContain("hello from marketplace");
  } finally {
    await closeApp(app);
    await stub.close().catch(() => {});
  }
});
