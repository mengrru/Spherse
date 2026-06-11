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

async function createFloatingChatProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-float-"));
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
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
  return root;
}

async function launchApp(projectRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
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
  const res = await fetch(`http://localhost:${port}/api/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: "POST",
  });
  const { sessionId } = await res.json() as { sessionId: string };
  return sessionId;
}

async function navigateToProject(page: Page, projectRoot: string) {
  const projectUrl = `/project/${projectKeyBase(projectRoot)}`;
  await page.goto(`file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}`);
  await page.getByText("Assistant").first().waitFor({ timeout: 10000 });
}

function agentTrigger(page: Page) {
  return page.locator(`[data-slot="collapsible-trigger"]:has-text("Assistant")`);
}

function agentPanel(page: Page) {
  return page.locator(`[data-slot="collapsible-trigger"]:has-text("Assistant") >> xpath=ancestor::*[@data-slot="collapsible"]//*[@data-slot="collapsible-content"]`);
}

async function expandAgent(page: Page) {
  await agentTrigger(page).click();
  await expect(agentPanel(page)).toHaveAttribute("data-open", "");
}

function getSessionRow(page: Page, sessionId: string) {
  return page.locator(`[data-session-id="${sessionId}"]`);
}

test("right-click float shows floating chat overlay", async () => {
  const projectRoot = await createFloatingChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "assistant-1");
    await navigateToProject(page, projectRoot);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });

    await page.getByRole("menuitem", { name: "浮窗" }).click();

    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-chat-float-root] [data-chat-composer]")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("close button removes floating chat", async () => {
  const projectRoot = await createFloatingChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "assistant-1");
    await navigateToProject(page, projectRoot);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    await page.locator("[data-chat-float-titlebar] button").click();

    await expect(page.locator("[data-chat-float-root]")).toHaveCount(0, { timeout: 5000 });
  } finally {
    await app.close();
  }
});

test("floating a different session auto-closes current float", async () => {
  const projectRoot = await createFloatingChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionA = await createSessionViaApi(page, projectRoot, "assistant-1");
    const sessionB = await createSessionViaApi(page, projectRoot, "assistant-1");
    await navigateToProject(page, projectRoot);
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
    await app.close();
  }
});

test("floating chat is draggable", async () => {
  const projectRoot = await createFloatingChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "assistant-1");
    await navigateToProject(page, projectRoot);
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
    await app.close();
  }
});

test("main window session and floating session are independent", async () => {
  const projectRoot = await createFloatingChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionA = await createSessionViaApi(page, projectRoot, "assistant-1");
    const sessionB = await createSessionViaApi(page, projectRoot, "assistant-1");
    await navigateToProject(page, projectRoot);
    await expandAgent(page);

    const rowA = getSessionRow(page, sessionA);
    await rowA.waitFor({ state: "visible", timeout: 10000 });
    await rowA.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    const rowB = getSessionRow(page, sessionB);
    await rowB.click();

    await expect(page).toHaveURL(
      new RegExp(`#/project/${projectKeyBase(projectRoot)}/chat/${sessionB}`),
      { timeout: 5000 },
    );

    await expect(page.locator("[data-chat-float-root]")).toBeVisible();
    await expect(page.locator("[data-chat-root]")).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test("cancel float from context menu closes floating chat", async () => {
  const projectRoot = await createFloatingChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "assistant-1");
    await navigateToProject(page, projectRoot);
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
    await app.close();
  }
});

test("floating chat is resizable", async () => {
  const projectRoot = await createFloatingChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "assistant-1");
    await navigateToProject(page, projectRoot);
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
    await app.close();
  }
});

test("floating session row shows as active in sidebar", async () => {
  const projectRoot = await createFloatingChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "assistant-1");
    await navigateToProject(page, projectRoot);
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
    await app.close();
  }
});

test("clicking floating session in sidebar does not navigate", async () => {
  const projectRoot = await createFloatingChatProject();
  const { app, page } = await launchApp(projectRoot);

  try {
    const sessionId = await createSessionViaApi(page, projectRoot, "assistant-1");
    await navigateToProject(page, projectRoot);
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
    await app.close();
  }
});

test("switching project clears floating chat", async () => {
  const projectA = await createFloatingChatProject();
  const projectB = await mkdtemp(path.join(tmpdir(), "spherse-e2e-float-b-"));
  await mkdir(path.join(projectB, ".spherse", "agents"), { recursive: true });
  await mkdir(path.join(projectB, ".spherse", "agents", "assistant"), { recursive: true });
  await writeFile(
    path.join(projectB, ".spherse", "agents", "assistant", "profile.md"),
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
  await page.evaluate(({ a, b }: { a: string; b: string }) => {
    void window.electronAPI.addOpenProject(a);
    void window.electronAPI.addOpenProject(b);
    void window.electronAPI.setLastActiveProject(a);
  }, { a: projectA, b: projectB });

  try {
    const sessionId = await createSessionViaApi(page, projectA, "assistant-1");
    await navigateToProject(page, projectA);
    await expandAgent(page);

    const sessionRow = getSessionRow(page, sessionId);
    await sessionRow.waitFor({ state: "visible", timeout: 10000 });
    await sessionRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "浮窗" }).click();
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });

    const projectBName = projectB.split("/").pop()!;
    await page.getByTitle(projectBName).click();
    await page.waitForTimeout(1000);
    await expect(page.locator("[data-chat-float-root]")).toHaveCount(0, { timeout: 5000 });

    const projectAName = projectA.split("/").pop()!;
    await page.getByTitle(projectAName).click();
    await page.waitForTimeout(1000);
    await expect(page.locator("[data-chat-float-root]")).toBeVisible({ timeout: 5000 });
  } finally {
    await app.close();
  }
});
