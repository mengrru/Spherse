import { expect, test } from "@playwright/test";
import {

import { closeApp } from "./helpers/electron";
  createChatProject,
  launchChatApp,
  getServerPort,
  createSessionViaApi,
  navigateToSession,
  assistantTextMessage,
  type MockEvent,
} from "./helpers/chat";

test("withdraw button removes the last user turn after server confirms", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    const received: string[] = [];
    await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
      ws.onMessage((message) => {
        const parsed = JSON.parse(message as string);
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (parsed.type === "message") {
          for (const event of assistantTextMessage("Answer")) ws.send(JSON.stringify(event));
          return;
        }
        if (parsed.type === "withdraw") {
          received.push("withdraw");
          ws.send(JSON.stringify({ type: "turn_withdrawn", seq: 1 }));
        }
      });
    });

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("first question");
    await textarea.press("Enter");
    await page.waitForSelector("text=Answer", { timeout: 5000 });

    const withdrawButton = page.locator("[data-chat-message][data-role='user'] [data-chat-withdraw]");
    await expect(withdrawButton).toBeVisible();

    await withdrawButton.click();
    await page.locator("[data-chat-withdraw-confirm]").click();

    await expect(page.locator("text=first question")).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator("text=Answer")).toHaveCount(0);
    expect(received).toEqual(["withdraw"]);
  } finally {
    await closeApp(app);
  }
});

test("withdraw failure shows error without retry affordance", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
      ws.onMessage((message) => {
        const parsed = JSON.parse(message as string);
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (parsed.type === "message") {
          for (const event of assistantTextMessage("Answer")) ws.send(JSON.stringify(event));
          return;
        }
        if (parsed.type === "withdraw") {
          ws.send(JSON.stringify({
            type: "error",
            message: "Session last turn is already compacted",
            code: "PERMANENT",
          }));
        }
      });
    });

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("question");
    await textarea.press("Enter");
    await page.waitForSelector("text=Answer", { timeout: 5000 });

    await page.locator("[data-chat-message][data-role='user'] [data-chat-withdraw]").click();
    await page.locator("[data-chat-withdraw-confirm]").click();

    await page.waitForSelector("[data-chat-error]", { timeout: 5000 });
    await expect(page.locator("[data-chat-retry]")).toHaveCount(0);
    await expect(page.locator("text=question")).toBeVisible();
  } finally {
    await closeApp(app);
  }
});
