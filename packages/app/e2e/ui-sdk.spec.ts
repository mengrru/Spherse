import { expect, test } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

async function createUiSdkProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-sdk-"));
  await mkdir(path.join(root, ".spherse", "agents", "test-agent"), {
    recursive: true,
  });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\npaths:\n  agents: agents\n  index: AGENTS.md\n  changelog: CHANGELOG.md\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# Test\n");
  await mkdir(path.join(root, "world"), { recursive: true });

  await writeFile(
    path.join(root, ".spherse", "agents", "test-agent", "profile.md"),
    [
      "---",
      "id: test-agent",
      "name: Test Agent",
      "type: assistant",
      "model: deepseek-v4-flash",
      "tools: []",
      "---",
      "You are a test agent.",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(root, "world", "target-file.md"),
    "# Target File\n\nThis is the target file content.\n",
  );

  await writeFile(
    path.join(root, "sdk-test-trigger.html"),
    [
      "<!DOCTYPE html>",
      "<html><body>",
      '<button id="btn-open" onclick="openFile()">Open File</button>',
      '<button id="btn-session" onclick="createSession()">Create Session</button>',
      "<script>",
      "function openFile() {",
      "  window.parent.postMessage({",
      '    type: "spherse:action",',
      '    action: "openFile",',
      '    params: { path: "world/target-file.md" }',
      '  }, "*");',
      "}",
      "function createSession() {",
      "  window.parent.postMessage({",
      '    type: "spherse:action",',
      '    action: "createSession",',
      '    params: { agentId: "test-agent", message: "E2E test" }',
      '  }, "*");',
      "}",
      "</script></body></html>",
    ].join("\n"),
  );

  return { root, triggerHtmlPath: "sdk-test-trigger.html", projectId };
}

async function launchAppWithSdkProject(project: { root: string; projectId: string }): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const userDataDir = await mkdtemp(
    path.join(tmpdir(), "spherse-e2e-sdk-user-"),
  );
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

test("openFile action navigates from iframe", async () => {
  const project = await createUiSdkProject();
  const { app, page } = await launchAppWithSdkProject(project);

  try {
    const projectUrl = `/project/${project.projectId}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.triggerHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-open")).toBeVisible({ timeout: 30_000 });

    await frame.locator("#btn-open").click();

    await expect(page).toHaveURL(
      new RegExp(
        `#/project/${project.projectId}/content\\?path=world%2Ftarget-file\\.md`,
      ),
    );
  } finally {
    await app.close();
  }
});

test("createSession action navigates from iframe", async () => {
  const project = await createUiSdkProject();
  const { app, page } = await launchAppWithSdkProject(project);

  try {
    const projectUrl = `/project/${project.projectId}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.triggerHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-session")).toBeVisible({ timeout: 30_000 });

    await frame.locator("#btn-session").click();

    await expect(page).toHaveURL(
      new RegExp(
        `#/project/${project.projectId}/chat/[^/?#]+$`,
      ),
    );
    await expect(
      page.getByPlaceholder("输入消息... (Shift+Enter 换行)"),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test("unknown action is ignored", async () => {
  const project = await createUiSdkProject();
  const { app, page } = await launchAppWithSdkProject(project);

  try {
    const projectUrl = `/project/${project.projectId}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.triggerHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-open")).toBeVisible({ timeout: 30_000 });

    const urlBefore = page.url();

    await page.evaluate(() => {
      window.postMessage(
        {
          type: "spherse:action",
          action: "unknownAction",
          params: {},
        },
        "*",
      );
    });

    await page.waitForTimeout(500);
    expect(page.url()).toBe(urlBefore);
  } finally {
    await app.close();
  }
});

test("rate limit blocks excess calls", async () => {
  const project = await createUiSdkProject();
  const { app, page } = await launchAppWithSdkProject(project);

  try {
    const projectUrl = `/project/${project.projectId}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.triggerHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-open")).toBeVisible({ timeout: 30_000 });

    let navigatedCount = 0;
    page.on("framenavigated", () => {
      navigatedCount++;
    });

    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => {
        window.postMessage(
          {
            type: "spherse:action",
            action: "openFile",
            params: { path: "world/target-file.md" },
          },
          "*",
        );
      });
    }

    await page.waitForTimeout(2000);
    expect(navigatedCount).toBeLessThanOrEqual(10);
  } finally {
    await app.close();
  }
});
