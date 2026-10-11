import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import http from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeApp } from "./helpers/electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

async function startStubPromptMarket(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    language: "zh-cn",
    prompts: [
      {
        id: "e2e-worldview",
        title: "E2E 世界观助手",
        description: "E2E 世界观创作模板",
        category: "创作",
        content: "你是 E2E 世界观创作助手，帮助用户构建自洽的世界观设定。",
      },
      {
        id: "e2e-roleplay",
        title: "E2E 角色扮演",
        description: "E2E 角色扮演模板",
        category: "娱乐",
        content: "你将扮演用户设定的角色，进行沉浸式互动对话。",
      },
    ],
  };

  const server = http.createServer((req, res) => {
    if (req.url === "/spherse/prompts/zh-cn.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(manifest));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/spherse/prompts`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function createPromptTemplatesProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-prompt-templates-"));
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# Test\n");
  return { root, projectId };
}

async function launchApp(
  project: { root: string; projectId: string },
  stubBaseUrl: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-prompt-templates-user-"));
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_ENABLE_LOGGING: "1",
      XDG_CONFIG_HOME: userDataDir,
      SPHERSE_PROMPT_MARKETPLACE_BASE_URL: stubBaseUrl,
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

async function openAgentDialog(page: Page) {
  await page.locator("[title='创建智能体']").click();
  await page.getByRole("menuitem", { name: "创建智能体" }).click();
  await page.getByText("基本").waitFor({ timeout: 10000 });
}

test("prompt templates dialog lists, copies and shows full content", async () => {
  test.setTimeout(120_000);
  const stub = await startStubPromptMarket();
  const project = await createPromptTemplatesProject();
  const { app, page } = await launchApp(project, stub.baseUrl);

  try {
    await page.goto(`file://${rendererEntry}?e2e=${Date.now()}#/project/${project.projectId}`);
    await openAgentDialog(page);

    await page.locator("[data-prompt-templates-entry]").click();
    await expect(page.getByText("提示词模板")).toBeVisible({ timeout: 15_000 });

    const card = page.locator("[data-prompt-card='e2e-worldview']");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-prompt-card='e2e-roleplay']")).toBeVisible();

    await card.locator("[data-prompt-copy]").click();
    await expect(card.getByText("已复制")).toBeVisible({ timeout: 5000 });

    await card.locator("[data-prompt-view]").click();
    const detail = page.locator("[data-prompt-detail='e2e-worldview']");
    await expect(detail).toBeVisible({ timeout: 5000 });
    await expect(detail.getByText("你是 E2E 世界观创作助手，帮助用户构建自洽的世界观设定。")).toBeVisible();

    await detail.locator("[data-prompt-back]").click();
    await expect(page.locator("[data-prompt-card='e2e-worldview']")).toBeVisible({ timeout: 5000 });
  } finally {
    await closeApp(app);
    await stub.close().catch(() => {});
  }
});
