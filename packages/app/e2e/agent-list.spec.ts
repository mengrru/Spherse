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

function projectKeyBase(projectPath: string): string {
  const name = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? "project";
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-") || "project";
}

async function createProject(agents: Array<{ slug: string; id: string; name: string; description: string }>) {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-agent-list-"));
  for (const agent of agents) {
    const dir = path.join(root, ".spherse", "agents", agent.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "profile.md"),
      [
        "---",
        `id: ${agent.id}`,
        `name: ${agent.name}`,
        "type: assistant",
        "model: deepseek-v4-flash",
        "tools: []",
        "---",
        agent.description,
        "",
      ].join("\n"),
    );
  }
  return root;
}

function createSingleAgentProject() {
  return createProject([
    { slug: "writer", id: "writer-1", name: "Writer", description: "You help with writing." },
  ]);
}

function createMultiAgentProject() {
  return createProject([
    { slug: "writer", id: "writer-1", name: "Writer", description: "You are a Writer." },
    { slug: "researcher", id: "researcher-1", name: "Researcher", description: "You are a Researcher." },
    { slug: "reviewer", id: "reviewer-1", name: "Reviewer", description: "You are a Reviewer." },
  ]);
}

async function launchApp(projectRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-rename-user-"));
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
  await page.evaluate(async (root: string) => {
    await window.electronAPI.addOpenProject(root);
    await window.electronAPI.setLastActiveProject(root);
  }, projectRoot);
  return { app, page };
}

async function createSessionViaApi(page: Page, projectRoot: string, agentId: string): Promise<string> {
  const port: number = await page.evaluate(
    (dir) => window.electronAPI.startServer(dir),
    projectRoot,
  );
  const res = await fetch(`http://localhost:${port}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  const { sessionId } = await res.json() as { sessionId: string };
  return sessionId;
}

async function navigateToProject(page: Page, projectRoot: string) {
  const projectUrl = `/project/${projectKeyBase(projectRoot)}`;
  await page.goto(`file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}`);
  await page.getByText("Writer").first().waitFor({ timeout: 10000 });
}

function getSessionRow(page: Page, sessionId: string) {
  return page.locator(`[data-session-id="${sessionId}"]`);
}

function agentTrigger(page: Page, agentName: string) {
  return page.locator(`[data-slot="collapsible-trigger"]:has-text("${agentName}")`);
}

function agentPanel(page: Page, agentName: string) {
  return page.locator(`[data-slot="collapsible-trigger"]:has-text("${agentName}") >> xpath=ancestor::*[@data-slot="collapsible"]//*[@data-slot="collapsible-content"]`);
}

async function expandAgent(page: Page, agentName: string) {
  await agentTrigger(page, agentName).click();
  await expect(agentPanel(page, agentName)).toHaveAttribute("data-open", "");
}

test("right-click session row opens context menu with rename, rename updates title", async () => {
  const projectRoot = await createSingleAgentProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "writer-1");
    await navigateToProject(page, projectRoot);
    await expandAgent(page, "Writer");

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });

    await sessionRow.click({ button: "right" });

    const renameItem = page.getByRole("menuitem", { name: "重命名" });
    await expect(renameItem).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("menuitem", { name: "删除" })).toBeVisible();

    await renameItem.click();

    const input = page.locator("[data-slot='input']").first();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    await input.fill("My Renamed Session");
    await input.press("Enter");

    await expect(page.getByText("My Renamed Session")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("rename with empty input shows validation error and keeps editing", async () => {
  const projectRoot = await createSingleAgentProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "writer-1");
    await navigateToProject(page, projectRoot);
    await expandAgent(page, "Writer");

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });

    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "重命名" }).click();

    const input = page.locator("[data-slot='input']").first();
    await expect(input).toBeVisible();

    await input.clear();
    await input.press("Enter");

    await expect(page.getByText("请输入会话名称")).toBeVisible();

    await input.fill("Valid Name");
    await input.press("Enter");

    await expect(page.getByText("Valid Name")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("escape cancels rename without saving", async () => {
  const projectRoot = await createSingleAgentProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "writer-1");
    await navigateToProject(page, projectRoot);
    await expandAgent(page, "Writer");

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });

    const originalTitle = await sessionRow.textContent();

    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "重命名" }).click();

    const input = page.locator("[data-slot='input']").first();
    await expect(input).toBeVisible();
    await input.fill("Should Not Save");

    await input.press("Escape");

    await expect(page.locator("[data-slot='input']")).toHaveCount(0);

    const titleAfterCancel = await sessionRow.textContent();
    expect(titleAfterCancel).toBe(originalTitle);
  } finally {
    await app.close();
  }
});

test("all agents are collapsed by default", async () => {
  const projectRoot = await createMultiAgentProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    await navigateToProject(page, projectRoot);

    await expect(agentTrigger(page, "Writer")).toBeVisible({ timeout: 10000 });
    await expect(agentTrigger(page, "Researcher")).toBeVisible();
    await expect(agentTrigger(page, "Reviewer")).toBeVisible();

    await expect(agentTrigger(page, "Writer")).not.toHaveAttribute("data-panel-open", "");
    await expect(agentTrigger(page, "Researcher")).not.toHaveAttribute("data-panel-open", "");
    await expect(agentTrigger(page, "Reviewer")).not.toHaveAttribute("data-panel-open", "");
  } finally {
    await app.close();
  }
});

test("expanding all agents keeps them all open — no auto-collapse", async () => {
  const projectRoot = await createMultiAgentProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    await navigateToProject(page, projectRoot);

    await expect(agentTrigger(page, "Writer")).toBeVisible({ timeout: 10000 });

    await agentTrigger(page, "Writer").click();
    await expect(agentPanel(page, "Writer")).toHaveAttribute("data-open", "");

    await agentTrigger(page, "Researcher").click();
    await expect(agentPanel(page, "Researcher")).toHaveAttribute("data-open", "");

    await agentTrigger(page, "Reviewer").click();
    await expect(agentPanel(page, "Reviewer")).toHaveAttribute("data-open", "");

    await expect(agentPanel(page, "Writer")).toHaveAttribute("data-open", "");
    await expect(agentPanel(page, "Researcher")).toHaveAttribute("data-open", "");
  } finally {
    await app.close();
  }
});
