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

async function createFloatingChatProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-float-"));
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# Test\n");
  await mkdir(path.join(root, ".spherse", "agents", "assistant"), { recursive: true });
  await writeFile(
    path.join(root, ".spherse", "agents", "assistant", "profile.md"),
    [
      "---",
      "id: assistant-1",
      "name: Assistant",
      "type: assistant",
      "model: deepseek-v4-flash",
      "tools: []",
      "---",
      "You help with everything.",
      "",
    ].join("\n"),
  );
  return { root, projectId };
}

async function launchApp(project: { root: string; projectId: string }): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-float-user-"));
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

async function createSessionViaApi(page: Page, projectId: string, agentId: string): Promise<string> {
  const port: number = await page.evaluate(() => window.electronAPI.getServerPort());
  const res = await fetch(`http://localhost:${port}/api/projects/${projectId}/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: "POST",
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`createSession ${res.status}: ${JSON.stringify(body)}`);
  const { sessionId } = body as { sessionId: string };
  return sessionId;
}

async function closeApp(app: ElectronApplication) {
  try {
    await Promise.race([
      app.close(),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("app.close timeout")), 5_000)),
    ]);
  } catch {
    const pid = app.process()?.pid;
    if (pid) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }
  }
}

async function navigateToProject(page: Page, projectId: string) {
  const projectUrl = `/project/${projectId}`;
  await page.goto(`file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}`);
  await page.getByText("Assistant").first().waitFor({ timeout: 10000 });
}

function agentTrigger(page: Page) {
  return page.locator(`[data-slot="context-menu-trigger"]:has-text("Assistant")`);
}

function agentPanel(page: Page) {
  return page.locator(`[data-slot="context-menu-trigger"]:has-text("Assistant") >> xpath=ancestor::*[@data-slot="collapsible"]//*[@data-slot="collapsible-content"]`);
}

async function expandAgent(page: Page) {
  await agentTrigger(page).click();
  await expect(agentPanel(page)).toHaveAttribute("data-open", "");
}

function getSessionRow(page: Page, sessionId: string) {
  return page.locator(`[data-session-id="${sessionId}"]`);
}

test("right-click float shows floating chat overlay", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });

    await page.getByRole("menuitem", { name: "浮窗" }).click();

    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-chat-float-root] [data-chat-composer]")).toBeVisible();
  } finally {
    await closeApp(app);
  }
});

test("close button removes floating chat", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    await page.locator("[data-chat-float-titlebar] button").click();

    await expect(page.locator("[data-chat-float-root]")).toHaveCount(0, { timeout: 5000 });
  } finally {
    await closeApp(app);
  }
});

test("floating a different session auto-closes current float", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionA = await createSessionViaApi(page, project.projectId, "assistant-1");
    const sessionB = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const rowA = getSessionRow(page, sessionA);
    await rowA.waitFor({ state: "visible", timeout: 10000 });
    await rowA.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    const rowB = getSessionRow(page, sessionB);
    await rowB.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();

    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-chat-float-root] [data-chat-composer]")).toBeVisible();
  } finally {
    await closeApp(app);
  }
});

test("floating chat is draggable", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    const floatRoot = page.locator("[data-chat-float-root]");
    const titlebar = page.locator("[data-chat-float-titlebar]");
    const boxBefore = await floatRoot.boundingBox();
    expect(boxBefore).toBeTruthy();

    await titlebar.hover();
    await page.mouse.down();
    await page.mouse.move(boxBefore!.x - 80, boxBefore!.y - 60);
    await page.mouse.up();

    const boxAfter = await floatRoot.boundingBox();
    expect(boxAfter).toBeTruthy();
    expect(boxAfter!.x).toBeLessThan(boxBefore!.x);
    expect(boxAfter!.y).toBeLessThan(boxBefore!.y);
  } finally {
    await closeApp(app);
  }
});

test("main window session and floating session are independent", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionA = await createSessionViaApi(page, project.projectId, "assistant-1");
    const sessionB = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const rowA = getSessionRow(page, sessionA);
    await rowA.waitFor({ state: "visible", timeout: 10000 });
    await rowA.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    const rowB = getSessionRow(page, sessionB);
    await rowB.click();

    await expect(page).toHaveURL(
      new RegExp(`#/project/${project.projectId}/chat/${sessionB}`),
      { timeout: 5000 },
    );

    await expect(page.locator("[data-chat-float-root]")).toBeVisible();
    await expect(page.locator("[data-chat-root]")).toHaveCount(2);
  } finally {
    await closeApp(app);
  }
});

test("cancel float from context menu closes floating chat", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "取消浮窗" }).click();

    await expect(page.locator("[data-chat-float-root]")).toHaveCount(0, { timeout: 5000 });
  } finally {
    await closeApp(app);
  }
});

test("floating chat is resizable", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    const floatRoot = page.locator("[data-chat-float-root]");
    const boxBefore = await floatRoot.boundingBox();
    expect(boxBefore).toBeTruthy();

    const seHandle = floatRoot.locator(".cursor-se-resize");
    const handleBox = await seHandle.boundingBox();
    expect(handleBox).toBeTruthy();

    await seHandle.hover();
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 80, handleBox!.y + 60);
    await page.mouse.up();

    const boxAfter = await floatRoot.boundingBox();
    expect(boxAfter).toBeTruthy();
    expect(boxAfter!.width).toBeGreaterThan(boxBefore!.width);
    expect(boxAfter!.height).toBeGreaterThan(boxBefore!.height);
  } finally {
    await closeApp(app);
  }
});

test("double-click title bar closes float and navigates to chat page", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    const titlebar = page.locator("[data-chat-float-titlebar]");
    await titlebar.dblclick();

    await expect(page.locator("[data-chat-float-root]")).toHaveCount(0, { timeout: 5000 });
    await expect(page).toHaveURL(
      new RegExp(`#/project/${project.projectId}/chat/${sessionId}`),
      { timeout: 5000 },
    );
  } finally {
    await closeApp(app);
  }
});

test("floating session row shows as active in sidebar", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    await expect(
      sessionRow.locator("button[class*='bg-sidebar-accent']"),
    ).toBeVisible({ timeout: 5000 });
  } finally {
    await closeApp(app);
  }
});

test("clicking floating session in sidebar does not navigate", async () => {
  const project = await createFloatingChatProject();
  const { app, page } = await launchApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToProject(page, project.projectId);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    const currentUrl = page.url();
    await sessionRow.click();

    await page.waitForTimeout(500);
    expect(page.url()).toBe(currentUrl);
  } finally {
    await closeApp(app);
  }
});

test("switching project clears floating chat", async () => {
  const projectA = await createFloatingChatProject();
  const projectBRoot = await mkdtemp(path.join(tmpdir(), "spherse-e2e-float-b-"));
  await mkdir(path.join(projectBRoot, ".spherse", "agents"), { recursive: true });
  const projectBId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(projectBRoot, ".spherse", "project.yaml"),
    `id: ${projectBId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\n`,
  );
  await writeFile(path.join(projectBRoot, "AGENTS.md"), "# Test\n");
  await mkdir(path.join(projectBRoot, ".spherse", "agents", "assistant"), { recursive: true });
  await writeFile(
    path.join(projectBRoot, ".spherse", "agents", "assistant", "profile.md"),
    [
      "---",
      "id: assistant-1",
      "name: Helper",
      "type: assistant",
      "model: deepseek-v4-flash",
      "tools: []",
      "---",
      "You help with everything.",
      "",
    ].join("\n"),
  );

  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-float-user-"));
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
  await page.evaluate(async ({ aId, aPath, bId, bPath }: { aId: string; aPath: string; bId: string; bPath: string }) => {
    await window.electronAPI.openProject(aPath);
    await window.electronAPI.openProject(bPath);
    await window.electronAPI.addOpenProject(aId, aPath);
    await window.electronAPI.addOpenProject(bId, bPath);
    await window.electronAPI.setLastActiveProject(aId);
  }, { aId: projectA.projectId, aPath: projectA.root, bId: projectBId, bPath: projectBRoot });

  try {
    const sessionId = await createSessionViaApi(page, projectA.projectId, "assistant-1");
    await navigateToProject(page, projectA.projectId);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    const projectBName = projectBRoot.split("/").pop()!;
    await page.getByTitle(projectBName).click();
    await page.waitForTimeout(1000);
    await expect(page.locator("[data-chat-float-root]")).toHaveCount(0, { timeout: 5000 });

    const projectAName = projectA.root.split("/").pop()!;
    await page.getByTitle(projectAName).click();
    await page.waitForTimeout(1000);
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });
  } finally {
    await closeApp(app);
  }
});
