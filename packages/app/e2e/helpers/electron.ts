import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "../..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

export interface TestProject {
  root: string;
  contentPath: string;
  projectId: string;
}

export async function createTextSelectionProject(): Promise<TestProject> {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-"));
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# Test\n");
  await mkdir(path.join(root, "world"), { recursive: true });
  for (let index = 1; index <= 24; index += 1) {
    const id = `writer-${index}`;
    await mkdir(path.join(root, ".spherse", "agents", id), { recursive: true });
    await writeFile(
      path.join(root, ".spherse", "agents", id, "profile.md"),
      [
        "---",
        `id: ${id}`,
        `name: Writer ${index}`,
        "type: assistant",
        "model: deepseek-v4-flash",
        "tools: []",
        "---",
        "You help with writing.",
        "",
      ].join("\n"),
    );
  }
  await writeFile(
    path.join(root, "world", "lore.md"),
    [
      "# Lore",
      "",
      "The obsidian tower stands beside the northern sea.",
      "Its beacon wakes when the moon turns red.",
      "",
    ].join("\n"),
  );
  return { root, contentPath: "world/lore.md", projectId };
}

export async function launchAppWithProject(project: TestProject): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-user-data-"));
  const app = await electron.launch({
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
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async ({ id, projectRoot }) => {
    await window.electronAPI.openProject(projectRoot);
    await window.electronAPI.addOpenProject(id, projectRoot);
    await window.electronAPI.setLastActiveProject(id);
  }, { id: project.projectId, projectRoot: project.root });
  const projectUrl = `/project/${project.projectId}`;
  await page.goto(`file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.contentPath)}`);
  await page.waitForSelector("text=The obsidian tower stands beside the northern sea.");
  return { app, page };
}
