import { expect, test, type Page } from "@playwright/test";
import { createFileTreeProject, launchFileTreeApp } from "./helpers/file-tree";
import { closeApp, createTextSelectionProject, launchAppWithProject } from "./helpers/electron";

test.setTimeout(90_000);

function pane(page: Page) {
  return page.locator("[data-split-pane]");
}

function main(page: Page) {
  return page.locator("[data-split-main]");
}

function tabs(page: Page) {
  return page.locator("[data-tab-bar]").getByRole("tab");
}

function treeButton(page: Page, name: string) {
  return page.locator("aside").locator("button").filter({ hasText: new RegExp(`^${name}$`) });
}

test("header split moves the file into the split pane, which persists and closes", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await expect(tabs(page)).toHaveText(["欢迎页", "README"]);
    await main(page).getByRole("button", { name: "分窗" }).click();

    await expect(pane(page)).toContainText("Test Project");
    await expect(pane(page).getByRole("button", { name: "返回" })).toHaveCount(0);
    await expect(pane(page).getByRole("button", { name: "编辑" })).toHaveCount(0);
    await expect(pane(page).getByRole("button", { name: "分窗" })).toHaveCount(0);
    await expect(tabs(page)).toHaveText(["欢迎页"]);
    await expect(main(page).locator("[data-content-browser]")).toHaveCount(0);

    const layout = page.locator("[data-split-layout]");
    const layoutBox = (await layout.boundingBox())!;
    const paneBox = (await pane(page).boundingBox())!;
    expect(Math.abs(paneBox.width - layoutBox.width / 2)).toBeLessThan(4);

    const divider = page.getByRole("separator", { name: "调整分窗宽度" });
    const dividerBox = (await divider.boundingBox())!;
    const y = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(layoutBox.x + layoutBox.width * 0.6, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await pane(page).boundingBox())!.width).toBeLessThan(layoutBox.width * 0.45);
    const resizedWidth = (await pane(page).boundingBox())!.width;

    await page.reload();
    await page.waitForSelector("[data-split-pane]", { timeout: 30_000 });
    await expect(pane(page)).toContainText("Test Project");
    await expect.poll(async () => Math.round((await pane(page).boundingBox())!.width)).toBe(Math.round(resizedWidth));

    await pane(page).getByRole("button", { name: "关闭" }).click();
    await expect(pane(page)).toHaveCount(0);
    await expect(page.getByRole("separator")).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("context menu splits and unsplits a file; deleting its folder ends the split", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await treeButton(page, "docs").click();
    await treeButton(page, "guide.md").click({ button: "right" });
    await page.getByRole("menuitem", { name: "分窗", exact: true }).click();
    await expect(pane(page)).toContainText("Guide");
    await expect(main(page).locator("[data-content-browser]")).toContainText("Test Project");

    await treeButton(page, "guide.md").click({ button: "right" });
    await page.getByRole("menuitem", { name: "取消分窗" }).click();
    await expect(pane(page)).toHaveCount(0);

    await treeButton(page, "guide.md").click({ button: "right" });
    await page.getByRole("menuitem", { name: "分窗", exact: true }).click();
    await expect(pane(page)).toContainText("Guide");

    await treeButton(page, "docs").click({ button: "right" });
    await page.getByRole("menuitem", { name: "删除" }).click();
    await page.locator('[role="alertdialog"]').getByRole("button", { name: "删除" }).click();
    await expect(pane(page)).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("split state is kept per project across project switches", async () => {
  const first = await createFileTreeProject();
  const second = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(first);

  try {
    await page.evaluate(async ({ id, projectRoot }) => {
      await window.electronAPI.openProject(projectRoot);
      await window.electronAPI.addOpenProject(id, projectRoot);
    }, { id: second.projectId, projectRoot: second.root });
    await page.reload();
    await page.waitForSelector("text=文件", { timeout: 30_000 });

    await main(page).getByRole("button", { name: "分窗" }).click();
    await expect(pane(page)).toContainText("Test Project");

    await page.evaluate((id) => {
      window.location.hash = `#/project/${id}`;
    }, second.projectId);
    await expect(page).toHaveURL(new RegExp(`#/project/${second.projectId}`));
    await expect(pane(page)).toHaveCount(0);

    await page.evaluate((id) => {
      window.location.hash = `#/project/${id}`;
    }, first.projectId);
    await expect(pane(page)).toContainText("Test Project");
  } finally {
    await closeApp(app);
  }
});

test("text selected in the split pane can be sent to the chat open on the left", async () => {
  const project = await createTextSelectionProject();
  const { app, page } = await launchAppWithProject(project);

  async function selectInPane(text: string) {
    await page.evaluate((needle) => {
      const root = document.querySelector("[data-split-pane]");
      const textNode = [...(root?.querySelectorAll("p") ?? [])]
        .flatMap((node) => [...node.childNodes])
        .find((node) => node.textContent?.includes(needle));
      if (!textNode) throw new Error("target text node not found");
      const start = textNode.textContent!.indexOf(needle);
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + needle.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const rect = range.getBoundingClientRect();
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.right, clientY: rect.bottom }));
    }, text);
  }

  try {
    await page.getByRole("button", { name: "分窗" }).click();
    await expect(pane(page)).toContainText("The obsidian tower stands beside the northern sea.");

    await selectInPane("obsidian tower");
    await page.getByTestId("text-selection-toolbar").getByRole("button", { name: "发起会话" }).click();
    const popover = page.getByTestId("text-selection-popover");
    await expect(popover.getByText("发送至当前会话")).toHaveCount(0);
    await page.getByTestId("text-selection-agent-list").getByRole("button", { name: "Writer 1 发送" }).click();
    await expect(page).toHaveURL(/#\/project\/[^/]+\/chat\/[^/?#]+$/);
    await expect(main(page).getByText("请处理以下来自「world/lore.md」的内容：")).toHaveCount(1);
    const chatUrl = page.url();

    await selectInPane("beacon wakes");
    await page.getByTestId("text-selection-toolbar").getByRole("button", { name: "发起会话" }).click();
    const current = popover.getByRole("button", { name: /发送至当前会话/ });
    await expect(current).toContainText("Writer 1");
    await current.click();

    await expect(main(page).getByText("请处理以下来自「world/lore.md」的内容：")).toHaveCount(2);
    expect(page.url()).toBe(chatUrl);
  } finally {
    await closeApp(app);
  }
});
