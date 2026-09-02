import { expect, test } from "@playwright/test";
import { closeApp } from "./helpers/electron";
import {
  createChatProject,
  launchChatApp,
  getServerPort,
  createSessionViaApi,
  navigateToSession,
  assistantTextMessage,
  mockChatServer,
} from "./helpers/chat";

test("withdraw button removes the last user turn after server confirms", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    const received: string[] = [];
    await mockChatServer(page, port, (parsed, send, tools) => {
      if (parsed.type === "message") {
        tools.runTurn(String(parsed.content), parsed.intentId as string | undefined, assistantTextMessage("Answer"));
        return;
      }
      if (parsed.type === "withdraw") {
        received.push("withdraw");
        send({ type: "turn_withdrawn", seq: 0, upTo: 2 });
      }
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

    await mockChatServer(page, port, (parsed, send, tools) => {
      if (parsed.type === "message") {
        tools.runTurn(String(parsed.content), parsed.intentId as string | undefined, assistantTextMessage("Answer"));
        return;
      }
      if (parsed.type === "withdraw") {
        send({
          type: "error",
          message: "Session last turn is already compacted",
          code: "PERMANENT",
        });
      }
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
