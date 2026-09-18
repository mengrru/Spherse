import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeApp } from "./helpers/electron";
import {
  createChatProject,
  launchChatApp,
  createSessionViaApi,
  navigateToSession,
} from "./helpers/chat";

test.setTimeout(60_000);

async function seedQuickLinkAgent(project: { root: string }): Promise<void> {
  await mkdir(path.join(project.root, "world"), { recursive: true });
  await writeFile(
    path.join(project.root, "world", "characters.md"),
    "# Characters\n\nHero list.\n",
  );
  await writeFile(
    path.join(project.root, ".spherse", "agents", "assistant", "profile.md"),
    [
      "---",
      "id: assistant-1",
      "name: Assistant",
      "type: assistant",
      "model: deepseek-v4-flash",
      "tools: []",
      "quickLinks:",
      "  - world/characters.md",
      "---",
      "You help with everything.",
      "",
    ].join("\n"),
  );
}

test("chat header quick link opens floating content window that survives chat close", async () => {
  const project = await createChatProject();
  await seedQuickLinkAgent(project);
  const { app, page } = await launchChatApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-header]");

    const quickLink = page.locator("[data-chat-quick-links] button", { hasText: /^characters$/ });
    await expect(quickLink).toBeVisible({ timeout: 5000 });

    await quickLink.click();
    await expect(page.locator("[data-content-float-root]")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-content-float-root] [data-content-doc]")).toBeVisible({
      timeout: 5000,
    });

    await page.locator("[data-chat-header] button[title='关闭']").click();
    await expect(page.locator("[data-chat-header]")).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator("[data-content-float-root]")).toHaveCount(1);
  } finally {
    await closeApp(app);
  }
});

test("mobile viewport slides quick link panel out below the header and toggles closed", async () => {
  const project = await createChatProject();
  await seedQuickLinkAgent(project);
  const { app, page } = await launchChatApp(project);

  try {
    await page.setViewportSize({ width: 375, height: 700 });
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-header]");

    const quickLink = page.locator("[data-chat-quick-links] button", { hasText: /^characters$/ });
    await expect(quickLink).toBeVisible({ timeout: 5000 });

    await quickLink.click();
    await expect(page.locator("[data-chat-quick-link-panel]")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-chat-quick-link-panel] [data-content-doc]")).toBeVisible({
      timeout: 5000,
    });

    await quickLink.click();
    await expect(page.locator("[data-chat-quick-link-panel]")).toHaveCount(0, { timeout: 5000 });
  } finally {
    await closeApp(app);
  }
});
