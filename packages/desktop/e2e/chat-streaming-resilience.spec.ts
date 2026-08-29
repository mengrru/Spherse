import { expect, test } from "@playwright/test";
import { closeApp } from "./helpers/electron";
import type { Page } from "@playwright/test";
import {
  createChatProject,
  launchChatApp,
  getServerPort,
  createSessionViaApi,
  navigateToSession,
  mockChatWebSocket,
  mockStreamingWithoutEnd,
  createStreamingSequence,
} from "./helpers/chat";

test("abort button visible throughout entire agent turn until agent_end", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    const eventsBeforeEnd = createStreamingSequence().filter((e) => e.type !== "agent_end");
    const { complete } = await mockStreamingWithoutEnd(page, port, eventsBeforeEnd);

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("[data-chat-composer] button svg.lucide-square", { timeout: 5000 });

    await expect(page.locator("[data-chat-composer] button svg.lucide-square")).toBeVisible();
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toHaveCount(0);

    await expect(textarea).toBeEnabled();
    await textarea.fill("typed while streaming");

    complete();

    await page.waitForSelector("[data-chat-composer] button svg.lucide-send", { timeout: 5000 });
    await expect(page.locator("[data-chat-composer] button svg.lucide-square")).toHaveCount(0);
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toBeVisible();
    await expect(textarea).toHaveValue("typed while streaming");
  } finally {
    await closeApp(app);
  }
});

test("streaming continues after switching away and back", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionA = await createSessionViaApi(page, project.projectId, "assistant-1");
    const sessionB = await createSessionViaApi(page, project.projectId, "assistant-1");

    await mockChatWebSocket(page, port, createStreamingSequence());

    await navigateToSession(page, project.projectId, sessionA);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("text=Hello", { timeout: 5000 });

    await navigateToSession(page, project.projectId, sessionB);
    await page.waitForSelector("[data-chat-composer]", { timeout: 5000 });

    await navigateToSession(page, project.projectId, sessionA);

    await page.waitForSelector("text=Based on the file content.", { timeout: 10000 });
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toBeVisible({ timeout: 10000 });
  } finally {
    await closeApp(app);
  }
});

test("sidebar shows streaming indicator on background session", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionA = await createSessionViaApi(page, project.projectId, "assistant-1");
    const sessionB = await createSessionViaApi(page, project.projectId, "assistant-1");

    const eventsBeforeEnd = createStreamingSequence().filter((e) => e.type !== "agent_end");
    const { complete } = await mockStreamingWithoutEnd(page, port, eventsBeforeEnd);

    await navigateToSession(page, project.projectId, sessionA);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("text=Hello", { timeout: 5000 });

    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/project/${project.projectId}/chat/${sessionB}`);
    await page.waitForSelector("[data-chat-composer]", { timeout: 5000 });

    const sessionARow = page.locator(`[data-session-id="${sessionA}"]`);
    await expect(sessionARow).toBeVisible({ timeout: 5000 });
    await expect(sessionARow.locator("svg.lucide-loader-circle")).toBeVisible({ timeout: 5000 });

    complete();

    await page.waitForSelector(`[data-session-id="${sessionA}"] svg.lucide-loader-circle`, { state: "hidden", timeout: 10000 }).catch(() => {});
  } finally {
    await closeApp(app);
  }
});
