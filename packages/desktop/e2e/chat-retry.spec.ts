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
  mockChatServer,
} from "./helpers/chat";

test("failed assistant response shows error with retry button; retry produces a new response", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    let attempt = 0;
    await mockChatServer(page, port, (parsed, _send, tools) => {
      if (parsed.type === "message") {
        attempt += 1;
        tools.runTurn(
          String(parsed.content),
          parsed.intentId as string | undefined,
          attempt === 1
            ? assistantFailedMessage("Something went wrong")
            : assistantTextMessage("Retried successfully"),
        );
      } else if (parsed.type === "retry") {
        tools.turnRetried();
        tools.runEvents(assistantTextMessage("Retried successfully"));
      }
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
    await mockChatServer(page, port, (parsed, send, tools) => {
      if (parsed.type !== "message") return;
      attempt += 1;
      if (attempt === 1) {
        send({
          type: "error",
          message: "No model configured",
          code: "MODEL_NOT_CONFIGURED",
        });
      } else {
        tools.runTurn(String(parsed.content), parsed.intentId as string | undefined, assistantTextMessage("Recovered"));
      }
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
