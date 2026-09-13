import { expect, test } from "@playwright/test";
import { closeApp } from "./helpers/electron";
import {
  createChatProject,
  createSessionViaApi,
  getServerPort,
  launchChatApp,
  mockV2ChatServer,
  navigateToSession,
} from "./helpers/chat";

test("reconnects with since and replays a run completed while disconnected", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    const server = await mockV2ChatServer(page, port);

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");
    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");
    await expect.poll(() => server.receivedMessages).toBe(1);

    server.streamAssistant("Hel");
    await expect(page.getByText("Hel", { exact: true })).toBeVisible();

    server.closeActiveSocket();
    server.completeWhileDisconnected("Hello world!");

    await expect.poll(() => server.sinceValues.length).toBe(1);
    await expect(page.getByText("Hello world!", { exact: true })).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByText("Hel", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toBeVisible({ timeout: 10000 });
  } finally {
    await closeApp(app);
  }
});

test("dedups replayed persisted messages with the run snapshot after reconnect", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    const server = await mockV2ChatServer(page, port);

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");
    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");
    await expect.poll(() => server.receivedMessages).toBe(1);

    server.streamAssistant("Hel");
    await expect(page.getByText("Hel", { exact: true })).toBeVisible();

    server.closeActiveSocket();
    server.completeMessageWhileDisconnected("Hello world!");
    await expect.poll(() => server.sinceValues.length).toBe(1);
    await expect(page.getByText("Hello world!", { exact: true })).toHaveCount(1, { timeout: 10000 });

    server.streamAssistant("Second");
    await expect(page.getByText("Second", { exact: true })).toBeVisible();
    server.finishAssistant("Second done");
    await expect(page.getByText("Second done", { exact: true })).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator("[data-chat-message]")).toHaveCount(3);
    await expect(page.getByText("Hel", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toBeVisible({ timeout: 10000 });
  } finally {
    await closeApp(app);
  }
});
