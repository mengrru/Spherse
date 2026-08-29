import { expect, test } from "@playwright/test";
import { closeApp } from "./helpers/electron";
import {
  createChatProject,
  launchChatApp,
  getServerPort,
  createSessionViaApi,
  navigateToSession,
  assistantTextMessage,
  assistantFailedMessage,
  type MockEvent,
} from "./helpers/chat";

test("failed assistant response shows error with retry button; retry produces a new response", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    let attempt = 0;
    await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
      ws.onMessage((message) => {
        const parsed = JSON.parse(message as string);
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (parsed.type === "message" || parsed.type === "retry") {
          attempt += 1;
          const events: MockEvent[] = attempt === 1
            ? assistantFailedMessage("Something went wrong")
            : assistantTextMessage("Retried successfully");
          for (const event of events) ws.send(JSON.stringify(event));
        }
      });
    });

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("[data-chat-error]", { timeout: 5000 });
    await expect(page.locator("[data-chat-retry]")).toBeVisible();

    await page.locator("[data-chat-retry]").click();

    await page.waitForSelector("text=Retried successfully", { timeout: 5000 });
    await expect(page.locator("[data-chat-error]")).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("error event (pre-prompt failure) shows error UI; retry resends the message", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    let attempt = 0;
    await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
      ws.onMessage((message) => {
        const parsed = JSON.parse(message as string);
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (parsed.type === "message") {
          attempt += 1;
          if (attempt === 1) {
            ws.send(JSON.stringify({
              type: "error",
              message: "No model configured",
              code: "MODEL_NOT_CONFIGURED",
            }));
          } else {
            for (const event of assistantTextMessage("Recovered")) ws.send(JSON.stringify(event));
          }
        }
      });
    });

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("[data-chat-error]", { timeout: 5000 });
    await expect(page.locator("[data-chat-retry]")).toBeVisible();

    await page.locator("[data-chat-retry]").click();

    await page.waitForSelector("text=Recovered", { timeout: 5000 });
    await expect(page.locator("[data-chat-error]")).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});
