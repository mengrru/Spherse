import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFileTreeProject } from "./helpers/file-tree";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

test.setTimeout(60_000);

test("app launches and shows main UI", async () => {
  const project = await createFileTreeProject();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-launch-user-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;

  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      cwd: appRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_ENABLE_LOGGING: "1",
        XDG_CONFIG_HOME: userDataDir,
      },
    });

    const page = await app.firstWindow();
    expect(page).not.toBeNull();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForLoadState("domcontentloaded");

    await page.evaluate(async ({ id, projectRoot }) => {
      await window.electronAPI.openProject(projectRoot);
      await window.electronAPI.addOpenProject(id, projectRoot);
      await window.electronAPI.setLastActiveProject(id);
    }, { id: project.projectId, projectRoot: project.root });

    const projectUrl = `/project/${project.projectId}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent("README.md")}`,
    );
    await page.waitForSelector("text=文件", { timeout: 30_000 });

    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByText("文件")).toBeVisible();
  } finally {
    await app?.close();
  }
});
