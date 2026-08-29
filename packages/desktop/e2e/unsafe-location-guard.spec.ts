import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
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

test.setTimeout(90_000);

async function createZoneProject(zoneRoot: string): Promise<string> {
  const root = path.join(zoneRoot, "my-project");
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: zone-proj\nname: my-project\ncreated: ${Date.now()}\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# my-project\n");
  return root;
}

function launchEnv(userDataDir: string, zoneRoot: string, dialogResponse: string) {
  return {
    ...process.env,
    NODE_ENV: "test",
    ELECTRON_ENABLE_LOGGING: "1",
    XDG_CONFIG_HOME: userDataDir,
    SPHERSE_UNSAFE_ZONE: zoneRoot,
    SPHERSE_E2E_DIALOG_RESPONSE: dialogResponse,
  };
}

async function recordedDialogs(
  app: ElectronApplication,
): Promise<Array<{ kind: string; detail: string }>> {
  return (await app.evaluate(() => {
    const g = globalThis as { __spherseTestDialogs?: Array<{ kind: string; detail: string }> };
    return g.__spherseTestDialogs ?? [];
  })) as Array<{ kind: string; detail: string }>;
}

test("declining the unsafe location keeps the project unopened", async () => {
  const zoneRoot = await mkdtemp(path.join(tmpdir(), "spherse-e2e-zone-"));
  const projectRoot = await createZoneProject(zoneRoot);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-guard-user-"));
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      cwd: appRoot,
      env: launchEnv(userDataDir, zoneRoot, "1"),
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForLoadState("domcontentloaded");

    const result = await page.evaluate(async (p) => await window.electronAPI.openProject(p), projectRoot);
    expect(result).toBeNull();

    await expect(page.getByText("搭建属于你自己的世界")).toBeVisible({ timeout: 30_000 });
    const dialogs = await recordedDialogs(app);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toEqual({ kind: "confirmUnsafeLocation", detail: expect.any(String) });
  } finally {
    await closeApp(app);
  }
});

test("confirming the unsafe location opens the project", async () => {
  const zoneRoot = await mkdtemp(path.join(tmpdir(), "spherse-e2e-zone-"));
  const projectRoot = await createZoneProject(zoneRoot);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-guard-user-"));
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      cwd: appRoot,
      env: launchEnv(userDataDir, zoneRoot, "0"),
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForLoadState("domcontentloaded");

    const result = await page.evaluate(async (p) => await window.electronAPI.openProject(p), projectRoot);
    expect(result?.projectId).toBeTruthy();

    await page.evaluate(async ({ id, root }) => {
      await window.electronAPI.addOpenProject(id, root);
      await window.electronAPI.setLastActiveProject(id);
    }, { id: result!.projectId, root: projectRoot });

    await page.goto(`file://${rendererEntry}?e2e=${Date.now()}#/`);
    await expect(page.locator("[data-project-avatar]")).toHaveCount(1, { timeout: 30_000 });
    const dialogs = await recordedDialogs(app);
    expect(dialogs).toHaveLength(2);
    expect(dialogs[0]).toEqual({ kind: "confirmUnsafeLocation", detail: expect.any(String) });
    expect(dialogs[1]).toEqual({
      kind: "startupUnsafeWarning",
      detail: expect.stringContaining("my-project"),
    });
  } finally {
    await closeApp(app);
  }
});

test("startup warns about restored projects inside the unsafe zone", async () => {
  const zoneRoot = await mkdtemp(path.join(tmpdir(), "spherse-e2e-zone-"));
  const projectRoot = await createZoneProject(zoneRoot);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-guard-user-"));
  await writeFile(
    path.join(userDataDir, "settings.json"),
    JSON.stringify({
      openProjects: [
        { id: "zone-proj", path: projectRoot, name: "my-project", lastOpened: new Date().toISOString() },
      ],
    }),
  );
  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      cwd: appRoot,
      env: launchEnv(userDataDir, zoneRoot, "0"),
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("[data-project-avatar]")).toHaveCount(1, { timeout: 30_000 });
    await expect.poll(async () => (await recordedDialogs(app)).length).toBe(1);
    const dialogs = await recordedDialogs(app);
    expect(dialogs[0]).toEqual({
      kind: "startupUnsafeWarning",
      detail: expect.stringContaining("my-project"),
    });
  } finally {
    await closeApp(app);
  }
});
