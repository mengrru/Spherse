import { expect, test } from "@playwright/test";
import { createTextSelectionProject, launchAppWithProject } from "./helpers/electron";

test("text selection session shows stable button, fixed popover, and highlight overlay", async () => {
  const project = await createTextSelectionProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    await page.waitForSelector("text=The obsidian tower stands beside the northern sea.");
    await page.getByText("Writer 1", { exact: true }).waitFor();
    const firstMouseUp = { x: 720, y: 360 };
    await page.evaluate(() => {
      const textNode = [...document.querySelectorAll("p")]
        .flatMap((node) => [...node.childNodes])
        .find((node) => node.textContent?.includes("obsidian tower"));
      if (!textNode) throw new Error("target text node not found");
      const start = textNode.textContent!.indexOf("obsidian tower");
      const end = start + "obsidian tower stands beside".length;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.mouse.move(firstMouseUp.x, firstMouseUp.y);
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
    }, firstMouseUp);

    const button = page.getByTestId("text-selection-toolbar");
    await expect(button).toBeVisible();
    const buttonBox = await button.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(1200);
    expect(Math.round(buttonBox!.x + buttonBox!.width / 2)).toBe(firstMouseUp.x);
    expect(Math.round(buttonBox!.y)).toBe(firstMouseUp.y);

    const backgroundBeforeHover = await button.evaluate((node) => getComputedStyle(node).backgroundColor);
    await button.hover();
    const backgroundAfterHover = await button.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(backgroundBeforeHover).not.toBe("rgba(0, 0, 0, 0)");
    expect(backgroundAfterHover).not.toBe("rgba(0, 0, 0, 0)");
    expect(backgroundAfterHover).toBe(backgroundBeforeHover);

    const highlight = page.getByTestId("text-selection-highlight");
    await expect(highlight).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed ?? true)).toBe(true);

    await button.getByRole("button", { name: "发起会话" }).click();
    const popover = page.getByTestId("text-selection-popover");
    await expect(popover).toBeVisible();
    const popoverBox = await popover.boundingBox();
    expect(popoverBox).not.toBeNull();
    expect(Math.round(popoverBox!.width)).toBe(300);
    expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(800);

    const agentList = page.getByTestId("text-selection-agent-list");
    await expect(agentList).toBeVisible();
    const agentListBox = await agentList.boundingBox();
    expect(agentListBox).not.toBeNull();
    expect(agentListBox!.height).toBeLessThanOrEqual(240);
    const popoverScroll = await popover.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
      contentOverflowY: node.firstElementChild
        ? getComputedStyle(node.firstElementChild).overflowY
        : "",
      contentClientHeight: node.firstElementChild?.clientHeight ?? 0,
      contentScrollHeight: node.firstElementChild?.scrollHeight ?? 0,
    }));
    expect(popoverScroll.scrollHeight).toBe(popoverScroll.clientHeight);
    expect(popoverScroll.overflowY).not.toBe("auto");
    expect(popoverScroll.contentScrollHeight).toBe(popoverScroll.contentClientHeight);
    expect(popoverScroll.contentOverflowY).not.toBe("auto");
    const agentListScroll = await agentList.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(agentListScroll.scrollHeight).toBeGreaterThan(agentListScroll.clientHeight);
    expect(agentListScroll.overflowY).toBe("auto");
    const lastAgentBox = await agentList.getByRole("button", { name: /Writer 24/ }).boundingBox();
    expect(lastAgentBox).not.toBeNull();
    expect(lastAgentBox!.y + lastAgentBox!.height).toBeGreaterThan(agentListBox!.y + agentListBox!.height);

    const commentText = "unique visible comment preview should not render";
    await page.getByPlaceholder("添加补充说明（可选）...").fill(commentText);
    await expect(popover.locator("div").filter({ hasText: new RegExp(`^${commentText}$`) })).toHaveCount(0);
    await page.getByPlaceholder("添加补充说明（可选）...").click();
    await popover.evaluate((node) => node.dispatchEvent(new Event("scroll")));
    await expect(popover).toBeVisible();

    await agentList.getByRole("button", { name: "Writer 1 发送" }).click();
    await expect(page).toHaveURL(/#\/project\/[^/]+\/chat\/[^/?#]+$/);
    await expect(page.getByPlaceholder("输入消息... (Shift+Enter 换行)")).toBeVisible();
    await expect(page.getByText("请处理以下来自「world/lore.md」的内容：")).toBeVisible();

    await page.goto(page.url().replace(/\/chat\/[^/?#]+$/, `/content?path=${encodeURIComponent(project.contentPath)}`));
    await page.waitForSelector("text=The obsidian tower stands beside the northern sea.");

    const secondMouseUp = { x: 640, y: 420 };
    await page.evaluate(() => {
      const textNode = [...document.querySelectorAll("p")]
        .flatMap((node) => [...node.childNodes])
        .find((node) => node.textContent?.includes("beacon wakes"));
      if (!textNode) throw new Error("second target text node not found");
      const start = textNode.textContent!.indexOf("beacon wakes");
      const end = start + "beacon wakes".length;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
    }, secondMouseUp);
    await expect(button).toBeVisible();
  } finally {
    await closeApp(app);
  }
});

test("text selection copies via Ctrl/Cmd+C after native selection is released", async () => {
  const project = await createTextSelectionProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    await page.waitForSelector("text=The obsidian tower stands beside the northern sea.");
    const mouseUp = { x: 720, y: 400 };
    await page.evaluate(() => {
      const textNode = [...document.querySelectorAll("p")]
        .flatMap((node) => [...node.childNodes])
        .find((node) => node.textContent?.includes("obsidian tower"));
      if (!textNode) throw new Error("target text node not found");
      const start = textNode.textContent!.indexOf("obsidian tower");
      const end = start + "obsidian tower".length;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
    }, mouseUp);

    const toolbar = page.getByTestId("text-selection-toolbar");
    await expect(toolbar).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed ?? true)).toBe(true);

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.keyboard.press("ControlOrMeta+c");

    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe("obsidian tower");
    await expect(toolbar).toBeHidden();
    await expect(page.getByTestId("text-selection-highlight")).toBeHidden();
  } finally {
    await closeApp(app);
  }
});

test("text selection keyboard copy does not hijack editable targets inside popover", async () => {
  const project = await createTextSelectionProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    await page.waitForSelector("text=The obsidian tower stands beside the northern sea.");
    const mouseUp = { x: 720, y: 400 };
    await page.evaluate(() => {
      const textNode = [...document.querySelectorAll("p")]
        .flatMap((node) => [...node.childNodes])
        .find((node) => node.textContent?.includes("obsidian tower"));
      if (!textNode) throw new Error("target text node not found");
      const start = textNode.textContent!.indexOf("obsidian tower");
      const end = start + "obsidian tower".length;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
    }, mouseUp);

    const toolbar = page.getByTestId("text-selection-toolbar");
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "发起会话" }).click();
    const popover = page.getByTestId("text-selection-popover");
    await expect(popover).toBeVisible();

    const commentText = "editable comment copy";
    const commentInput = page.getByPlaceholder("添加补充说明（可选）...");
    await commentInput.fill(commentText);
    await commentInput.evaluate((el) => {
      el.focus();
      el.setSelectionRange(0, el.value.length);
    });

    await app.evaluate(({ clipboard }) => clipboard.clear());
    await page.keyboard.press("ControlOrMeta+c");

    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(commentText);
    await expect(popover).toBeVisible();
  } finally {
    await closeApp(app);
  }
});

test("text selection session keeps long agent list scrollable in a compact viewport", async () => {
  const project = await createTextSelectionProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    await page.setViewportSize({ width: 1200, height: 360 });
    await page.waitForSelector("text=The obsidian tower stands beside the northern sea.");

    const mouseUp = { x: 720, y: 180 };
    await page.evaluate(() => {
      const textNode = [...document.querySelectorAll("p")]
        .flatMap((node) => [...node.childNodes])
        .find((node) => node.textContent?.includes("obsidian tower"));
      if (!textNode) throw new Error("target text node not found");
      const start = textNode.textContent!.indexOf("obsidian tower");
      const end = start + "obsidian tower stands beside".length;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }));
    }, mouseUp);

    const toolbar = page.getByTestId("text-selection-toolbar");
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "发起会话" }).click();

    const popover = page.getByTestId("text-selection-popover");
    const agentList = page.getByTestId("text-selection-agent-list");
    await expect(popover).toBeVisible();
    await expect(agentList).toBeVisible();

    const popoverBox = await popover.boundingBox();
    const agentListBox = await agentList.boundingBox();
    expect(popoverBox).not.toBeNull();
    expect(agentListBox).not.toBeNull();
    expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(360);
    expect(agentListBox!.y + agentListBox!.height).toBeLessThanOrEqual(popoverBox!.y + popoverBox!.height - 12);

    const agentListScroll = await agentList.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(agentListScroll.scrollHeight).toBeGreaterThan(agentListScroll.clientHeight);
    expect(agentListScroll.overflowY).toBe("auto");
  } finally {
    await closeApp(app);
  }
});
