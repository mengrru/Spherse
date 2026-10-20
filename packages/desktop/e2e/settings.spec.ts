import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeApp } from "./helpers/electron";
import { getServerPort, authHeaders } from "./helpers/chat";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");

test.setTimeout(60_000);

async function launch(): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-settings-user-"));
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
  return { app, page, userDataDir };
}

async function openSettings(page: Page) {
  await page.locator('[title="设置"]').click();
  await page.getByRole("dialog").waitFor({ timeout: 10_000 });
}

async function fetchModelSettings(page: Page) {
  const port = await getServerPort(page);
  const res = await fetch(`http://localhost:${port}/api/settings/models`, {
    headers: await authHeaders(page),
  });
  expect(res.ok).toBeTruthy();
  return res.json() as Promise<{
    models: {
      text: { defaultModel: string; providers: Record<string, { configured: boolean }> };
      image: { defaultModel: string; providers: Record<string, { configured: boolean }> };
    };
    customProviders: unknown[];
  }>;
}

test("connecting a second provider through the connect button keeps both keys configured", async () => {
  const { app, page, userDataDir } = await launch();
  try {
    await openSettings(page);

    const deepseekRow = page.locator("div.rounded-lg", { hasText: "DeepSeek" }).first();
    await deepseekRow.getByPlaceholder("API密钥").fill("sk-e2e-first-key");
    await deepseekRow.getByPlaceholder("API密钥").blur();

    await expect
      .poll(async () => {
        const current = await fetchModelSettings(page);
        return current.models.text.providers["deepseek"]?.configured ?? false;
      })
      .toBe(true);

    const openaiRow = page.locator("div.rounded-lg", { hasText: "OpenAI" }).first();
    await openaiRow.getByPlaceholder("API密钥").fill("sk-e2e-second-key");
    await openaiRow.getByRole("button", { name: "连接" }).click();

    await expect
      .poll(async () => {
        const current = await fetchModelSettings(page);
        return (
          current.models.text.providers["deepseek"]?.configured === true &&
          current.models.text.providers["openai"]?.configured === true
        );
      })
      .toBe(true);
  } finally {
    await closeApp(app);
  }
});

test("settings modal saves a provider key through the server api and it survives restart", async () => {
  const { app, page, userDataDir } = await launch();
  try {
    await openSettings(page);

    const initial = await fetchModelSettings(page);
    expect(initial.models.text.providers["deepseek"]?.configured ?? false).toBe(false);

    const deepseekRow = page.locator("div.rounded-lg", { hasText: "DeepSeek" }).first();
    const keyInput = deepseekRow.getByPlaceholder("API密钥");
    await keyInput.fill("sk-e2e-test-key");
    await keyInput.blur();

    await expect
      .poll(async () => {
        const current = await fetchModelSettings(page);
        return current.models.text.providers["deepseek"]?.configured ?? false;
      })
      .toBe(true);

    const persisted = await fetchModelSettings(page);
    expect(JSON.stringify(persisted)).not.toContain("sk-e2e-test-key");

    await closeApp(app);

    const second = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      cwd: appRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_ENABLE_LOGGING: "1",
        XDG_CONFIG_HOME: userDataDir,
      },
    });
    try {
      const secondPage = await second.firstWindow();
      await secondPage.waitForLoadState("domcontentloaded");
      const reloaded = await fetchModelSettings(secondPage);
      expect(reloaded.models.text.providers["deepseek"]?.configured ?? false).toBe(true);
    } finally {
      await closeApp(second);
    }
  } finally {
    await closeApp(app);
  }
});
