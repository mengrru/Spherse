import { expect, test } from "@playwright/test";
import { closeApp } from "./helpers/electron";
import {
  createChatProject,
  launchChatApp,
  navigateToSession,
} from "./helpers/chat";
import { newHistoryFixture, seedHistorySession } from "./helpers/chat-history";

test("history rendering covers every session event type", async () => {
  const project = await createChatProject();
  const fixture = newHistoryFixture();
  seedHistorySession(project, fixture);
  const { app, page } = await launchChatApp(project);

  try {
    await navigateToSession(page, project.projectId, fixture.sessionId);
    await page.waitForSelector("[data-chat-composer]");
    await page.waitForSelector("[data-chat-messages]");

    await expect(page.getByText("普通用户消息")).toBeVisible();
    await expect(page.getByText("第一条助手回复")).toBeVisible();
    await expect(page.locator('img[src*="uploads/pic.png"]')).toHaveCount(1);

    await expect(page.getByText("run_command")).toBeVisible();
    await expect(page.getByText("printf history-ok")).toBeVisible();

    await expect(page.locator("iframe")).toHaveCount(1);

    await expect(page.getByText("继续执行吗？")).toBeVisible();
    await expect(page.getByText("继续执行", { exact: true })).toBeVisible();

    await expect(page.locator('img[alt="一只猫"]')).toHaveCount(1);

    const error = page.locator("[data-chat-error]");
    await expect(error).toHaveCount(1);
    await error.getByRole("button").first().click();
    await expect(error.getByText(/历史错误/)).toBeVisible();

    const trigger = page.locator("[data-chat-turn-collapse]");
    await expect(trigger).toContainText("每日汇总");
    await trigger.click();
    await expect(page.getByText("触发器回复")).toBeVisible();

    await expect(page.getByText("已被重试淘汰的问题")).toHaveCount(0);
    await expect(page.getByText("淘汰回复")).toHaveCount(0);
    await expect(page.getByText("被撤回的问题")).toHaveCount(0);
    await expect(page.getByText("撤回回复")).toHaveCount(0);

    await expect(page.getByText("工具总结文本")).toBeVisible();
    await expect(page.getByText("重试后的回复")).toBeVisible();
  } finally {
    await closeApp(app);
  }
});
