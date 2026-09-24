import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileTreeProject, launchFileTreeApp } from "./helpers/file-tree";
import { closeApp } from "./helpers/electron";

test.setTimeout(60_000);

function tabBar(page: Page) {
  return page.locator("[data-tab-bar]");
}

function tabs(page: Page) {
  return tabBar(page).getByRole("tab");
}

function treeButton(page: Page, name: string) {
  return page.locator("aside").locator("button").filter({ hasText: new RegExp(`^${name}$`) });
}

test("opening files creates tabs once, switching and closing tabs navigates", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await expect(tabs(page)).toHaveText(["欢迎页", "README"]);
    await expect(tabBar(page).getByRole("tab", { name: "欢迎页" })).toBeVisible();
    await expect(tabBar(page).getByRole("button", { name: "关闭 欢迎页" })).toHaveCount(0);

    await treeButton(page, "docs").click();
    await treeButton(page, "guide.md").click();
    await expect(tabs(page)).toHaveText(["欢迎页", "README", "guide"]);
    await expect(tabBar(page).getByRole("tab", { name: "guide" })).toHaveAttribute("aria-selected", "true");

    await treeButton(page, "README.md").click();
    await expect(tabs(page)).toHaveText(["欢迎页", "README", "guide"]);
    await expect(tabBar(page).getByRole("tab", { name: "README" })).toHaveAttribute("aria-selected", "true");

    await tabBar(page).getByRole("tab", { name: "guide" }).click();
    await expect(page.locator("[data-content-browser]")).toContainText("Guide");

    await tabBar(page).getByRole("button", { name: "关闭 guide" }).click();
    await expect(tabs(page)).toHaveText(["欢迎页", "README"]);
    await expect(tabBar(page).getByRole("tab", { name: "README" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-content-browser]")).toContainText("Test Project");

    await tabBar(page).getByRole("tab", { name: "欢迎页" }).click();
    await expect(page.locator("[data-content-browser]")).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("tabs are restored after reload", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await treeButton(page, "docs").click();
    await treeButton(page, "guide.md").click();
    await expect(tabs(page)).toHaveText(["欢迎页", "README", "guide"]);

    await page.reload();
    await page.waitForSelector("[data-tab-bar]", { timeout: 30_000 });
    await expect(tabs(page)).toHaveText(["欢迎页", "README", "guide"]);
  } finally {
    await closeApp(app);
  }
});

test("deleting an open file closes its tab", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await treeButton(page, "docs").click();
    await treeButton(page, "guide.md").click();
    await expect(tabs(page)).toHaveText(["欢迎页", "README", "guide"]);

    await treeButton(page, "guide.md").click({ button: "right" });
    await page.getByRole("menuitem", { name: "删除" }).click();
    await page.locator('[role="alertdialog"]').getByRole("button", { name: "删除" }).click();

    await expect(tabs(page)).toHaveText(["欢迎页", "README"]);
    await expect(tabBar(page).getByRole("tab", { name: "README" })).toHaveAttribute("aria-selected", "true");
  } finally {
    await closeApp(app);
  }
});

test("unsaved edits prompt before switching tabs", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await treeButton(page, "docs").click();
    await treeButton(page, "guide.md").click();
    await tabBar(page).getByRole("tab", { name: "README" }).click();

    await page.getByRole("button", { name: "编辑" }).click();
    await page.locator("[data-content-browser] textarea").fill("# Changed\n");
    await tabBar(page).getByRole("tab", { name: "guide" }).click();

    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "继续编辑" }).click();
    await expect(tabBar(page).getByRole("tab", { name: "README" })).toHaveAttribute("aria-selected", "true");

    await tabBar(page).getByRole("button", { name: "关闭 README" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "放弃修改" }).click();
    await expect(tabs(page)).toHaveText(["欢迎页", "guide"]);
  } finally {
    await closeApp(app);
  }
});

test("mobile hides the content browser header for html files while tabs are enabled", async () => {
  const project = await createFileTreeProject();
  await writeFile(path.join(project.root, "page.html"), "<!doctype html><h1>Hello page</h1>\n");
  const { app, page } = await launchFileTreeApp(project);

  try {
    await expect(page.getByRole("button", { name: "复制路径" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await expect(tabs(page)).toHaveText(["欢迎页", "README"]);
    await expect(page.getByRole("button", { name: "复制路径" })).toBeVisible();

    await page.evaluate((id) => {
      window.location.hash = `#/project/${id}/content?path=page.html`;
    }, project.projectId);
    await expect(tabs(page)).toHaveText(["欢迎页", "README", "page"]);
    await expect(page.locator("[data-content-browser] iframe")).toBeVisible();
    await expect(page.getByRole("button", { name: "复制路径" })).toHaveCount(0);

    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(page.getByRole("button", { name: "复制路径" })).toBeVisible();
  } finally {
    await closeApp(app);
  }
});
