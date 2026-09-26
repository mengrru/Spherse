import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { closeApp } from "./helpers/electron";
import { createChatProject, launchChatApp, navigateToProjectRoot } from "./helpers/chat";
import { seedHistorySession, type HistoryFixture } from "./helpers/chat-history";

const KEYWORD = "蓝鲸迁移方案";
const FILE_NAME = "蓝鲸迁移方案.md";
const FILE_PATH = `docs/${FILE_NAME}`;
const PLAIN_USER_TEXT = `帮我整理${KEYWORD}`;
const PLAIN_ASSISTANT_TEXT = `${KEYWORD}分三步执行`;
const TRIGGER_USER_TEXT = `每日提醒${KEYWORD}进度`;
const TRIGGER_ASSISTANT_TEXT = "已记录今日进度";

interface SearchFixture extends HistoryFixture {
  plainAssistantSeq: number;
  triggerUserSeq: number;
}

function buildSearchFixture(sessionId: string): SearchFixture {
  const events: HistoryFixture["events"] = [];
  let seq = 0;
  const base = Date.now() - 60_000;
  const emit = (type: string, data: Record<string, unknown>): number => {
    const current = seq;
    events.push({ type, seq: current, time: base + current * 1000, data });
    seq += 1;
    return current;
  };
  const textContent = (text: string) => [{ type: "text", text }];

  emit("turn/start", {});
  emit("user/message", {
    message: { role: "user", content: textContent(PLAIN_USER_TEXT), timestamp: base },
  });
  const plainAssistantSeq = emit("assistant/message", {
    message: { role: "assistant", content: textContent(PLAIN_ASSISTANT_TEXT), timestamp: base },
  });
  emit("turn/end", { reason: "completed" });

  emit("turn/start", {});
  const triggerUserSeq = emit("user/message", {
    message: {
      role: "user",
      content: textContent(TRIGGER_USER_TEXT),
      timestamp: base,
    },
    source: "triggered",
    triggerName: "每日汇总",
  });
  emit("assistant/message", {
    message: { role: "assistant", content: textContent(TRIGGER_ASSISTANT_TEXT), timestamp: base },
  });
  emit("turn/end", { reason: "completed" });

  return { sessionId, events, plainAssistantSeq, triggerUserSeq };
}

function searchDialog(page: Page) {
  return page.locator("[data-global-search-dialog]");
}

test("global search opens via panel context menu and shortcut, shows grouped results, jumps and locates", async () => {
  const project = await createChatProject();
  await mkdir(path.join(project.root, "docs"), { recursive: true });
  await writeFile(path.join(project.root, FILE_PATH), `# ${KEYWORD}\n\n正文内容\n`, "utf-8");
  const fixture = buildSearchFixture(randomUUID());
  seedHistorySession(project, fixture);

  const { app, page } = await launchChatApp(project);
  try {
    await navigateToProjectRoot(page, project.projectId);
    const panel = page.locator("[data-project-panel]");
    await expect(panel).toBeVisible();

    await panel.click({ button: "right", position: { x: 4, y: 300 } });
    const menuItem = page.getByRole("menuitem", { name: "搜索" }).first();
    await expect(menuItem).toBeVisible();
    await menuItem.click();
    await expect(searchDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(searchDialog(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+p");
    const dialog = searchDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/输入关键词/)).toBeVisible();

    const input = dialog.locator("input").first();
    await input.fill(KEYWORD);
    await expect(dialog.getByText("聊天")).toBeVisible();
    await expect(dialog.getByText("文件")).toBeVisible();
    await expect(dialog.getByText(FILE_PATH)).toBeVisible();
    await expect(dialog.getByText(PLAIN_ASSISTANT_TEXT, { exact: false })).toBeVisible();

    await dialog.locator("button", { hasText: FILE_PATH }).first().click();
    await expect(page.locator("[data-content-browser]")).toContainText(KEYWORD);
    expect(decodeURIComponent(page.url())).toContain(`content?path=${FILE_PATH}`);
    await expect(searchDialog(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+p");
    await expect(searchDialog(page)).toBeVisible();
    await searchDialog(page).locator("input").first().fill(KEYWORD);
    const triggerHit = searchDialog(page).locator("button", { hasText: TRIGGER_USER_TEXT }).first();
    await expect(triggerHit).toBeVisible();
    await triggerHit.click();

    await expect(page.getByText(TRIGGER_USER_TEXT)).toBeVisible();
    await expect(page.getByText(TRIGGER_ASSISTANT_TEXT).first()).toBeVisible();
    await expect(page.locator(`[data-entry-seq="${fixture.triggerUserSeq}"]`)).toBeVisible();
    await expect
      .poll(async () => page.url(), { timeout: 10_000 })
      .not.toContain("messageId=");
  } finally {
    await closeApp(app);
  }
});
