import { expect, test } from "@playwright/test";
import { closeApp } from "./helpers/electron";
import {
  createChatProject,
  launchChatApp,
  getServerPort,
  createSessionViaApi,
  navigateToSession,
  mockMultiClientBroadcastChat,
  sendAsSecondClient,
} from "./helpers/chat";

test("a user message settled from a second client appears live on the desktop", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    await mockMultiClientBroadcastChat(page, port);

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    await expect(page.locator("text=hello from the other client")).toHaveCount(0);

    await sendAsSecondClient(page, port, "hello from the other client");

    await expect(page.locator("[data-chat-message][data-role='user']", { hasText: "hello from the other client" })).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=hello from the other client")).toBeVisible();
  } finally {
    await closeApp(app);
  }
});
