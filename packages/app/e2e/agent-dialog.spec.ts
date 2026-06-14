import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

async function createAgentDialogProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-agent-dialog-"));
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\npaths:\n  agents: agents\n  index: AGENTS.md\n  changelog: CHANGELOG.md\n`,
  );
  await mkdir(path.join(root, ".spherse", "agents", "assistant"), { recursive: true });
  await writeFile(
    path.join(root, ".spherse", "agents", "assistant", "profile.md"),
    [
      "---",
      "id: assistant",
      "name: Assistant",
      "type: assistant",
      "model: deepseek-v4-flash",
      "tools: []",
      "---",
      "You help with writing.",
      "",
    ].join("\n"),
  );
  await mkdir(path.join(root, "world"), { recursive: true });
  await writeFile(path.join(root, "world", "characters.md"), "# Characters\n");
  await writeFile(path.join(root, "world", "locations.md"), "# Locations\n");
  await mkdir(path.join(root, "world", "history"), { recursive: true });
  await writeFile(path.join(root, "world", "history", "timeline.md"), "# Timeline\n");
  await writeFile(path.join(root, "README.md"), "# Test\n");
  return { root, projectId };
}

async function launchApp(project: { root: string; projectId: string }): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-agent-dialog-user-"));
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
  return { app, page };
}

async function navigateToProject(page: Page, projectId: string) {
  const projectUrl = `/project/${projectId}`;
  await page.goto(`file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}`);
  await page.getByText("Assistant").first().waitFor({ timeout: 10000 });
}

async function openAgentDialog(page: Page) {
  await page.locator("[title='创建搭档']").click();
  await page.getByText("基本").waitFor({ timeout: 10000 });
}

test("search file suggestions appear when typing in agent dialog", async () => {
  const project = await createAgentDialogProject();
  const { app, page } = await launchApp(project);

  try {
    await navigateToProject(page, project.projectId);
    await openAgentDialog(page);

    const refsInput = page.locator("[placeholder*='参考'], [placeholder*='reference'], [placeholder*='搜索']").first();
    await refsInput.waitFor({ timeout: 5000 });
    await refsInput.fill("characters");

    const suggestion = page.getByText("world/characters.md");
    await expect(suggestion).toBeVisible({ timeout: 5000 });
  } finally {
    await app.close();
  }
});

test("clicking suggestion adds path as badge in agent dialog", async () => {
  const project = await createAgentDialogProject();
  const { app, page } = await launchApp(project);

  try {
    await navigateToProject(page, project.projectId);
    await openAgentDialog(page);

    const refsInput = page.locator("[placeholder*='参考'], [placeholder*='reference'], [placeholder*='搜索']").first();
    await refsInput.waitFor({ timeout: 5000 });
    await refsInput.fill("locations");

    const suggestion = page.getByText("world/locations.md");
    await expect(suggestion).toBeVisible({ timeout: 5000 });
    await suggestion.click();

    const badge = page.locator("[data-slot='badge']").filter({ hasText: "world/locations.md" });
    await expect(badge).toBeVisible({ timeout: 3000 });
  } finally {
    await app.close();
  }
});

test("enter key manually adds typed path in agent dialog", async () => {
  const project = await createAgentDialogProject();
  const { app, page } = await launchApp(project);

  try {
    await navigateToProject(page, project.projectId);
    await openAgentDialog(page);

    const refsInput = page.locator("[placeholder*='参考'], [placeholder*='reference'], [placeholder*='搜索']").first();
    await refsInput.waitFor({ timeout: 5000 });
    await refsInput.fill("world/history/timeline.md");
    await refsInput.press("Enter");

    const badge = page.locator("[data-slot='badge']").filter({ hasText: "world/history/timeline.md" });
    await expect(badge).toBeVisible({ timeout: 3000 });
  } finally {
    await app.close();
  }
});
