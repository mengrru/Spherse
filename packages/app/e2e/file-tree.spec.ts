import { expect, test } from "@playwright/test";
import { createFileTreeProject, launchFileTreeApp } from "./helpers/file-tree";

test.setTimeout(60_000);

function sidebar(page: import("@playwright/test").Page) {
  return page.locator("aside");
}

function treeButton(page: import("@playwright/test").Page, name: string) {
  return sidebar(page).locator("button").filter({ hasText: new RegExp(`^${name}$`) });
}

function treeSpan(page: import("@playwright/test").Page, text: string) {
  return sidebar(page).locator("span.overflow-hidden").filter({ hasText: text });
}

test("file tree shows root files and directories", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await expect(treeButton(page, "src")).toBeVisible();
    await expect(treeButton(page, "docs")).toBeVisible();
    await expect(treeButton(page, "README.md")).toBeVisible();

    const sidebarBox = await sidebar(page).boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(sidebarBox!.width).toBeCloseTo(260, -1);
  } finally {
    await app.close();
  }
});

test("folder expand and collapse", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    const srcRow = treeButton(page, "src");
    await expect(srcRow).toBeVisible();

    await expect(treeButton(page, "main.ts")).not.toBeVisible();
    await expect(treeButton(page, "components")).not.toBeVisible();

    await srcRow.click();
    await expect(treeButton(page, "components")).toBeVisible();
    await expect(treeButton(page, "main.ts")).toBeVisible();

    await treeButton(page, "components").click();
    await expect(treeButton(page, "ui")).toBeVisible();

    await treeButton(page, "ui").click();
    await expect(treeButton(page, "deep")).toBeVisible();

    await treeButton(page, "deep").click();
    await expect(treeSpan(page, "a-very-long-file-name")).toBeVisible();

    await srcRow.click();
    await expect(treeButton(page, "components")).not.toBeVisible();
    await expect(treeButton(page, "main.ts")).not.toBeVisible();
  } finally {
    await app.close();
  }
});

test("deeply nested file name truncates with ellipsis", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await treeButton(page, "src").click();
    await treeButton(page, "components").click();
    await treeButton(page, "ui").click();
    await treeButton(page, "deep").click();

    const longNameSpan = treeSpan(page, "a-very-long-file-name");
    await expect(longNameSpan).toBeVisible();

    const isEllipsisActive = await longNameSpan.evaluate((el) => {
      return el.scrollWidth > el.clientWidth;
    });
    expect(isEllipsisActive).toBe(true);

    const sidebarBox = await sidebar(page).boundingBox();
    const spanBox = await longNameSpan.boundingBox();
    expect(spanBox!.x + spanBox!.width).toBeLessThanOrEqual(
      sidebarBox!.x + sidebarBox!.width + 1,
    );
  } finally {
    await app.close();
  }
});

test("create a new file via context menu", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    const docsRow = treeButton(page, "docs");
    await expect(docsRow).toBeVisible();
    await docsRow.click({ button: "right" });

    await page.getByRole("menuitem", { name: "新建文件", exact: true }).click();

    const input = sidebar(page).locator("input").last();
    await expect(input).toBeVisible();
    await input.fill("notes.md");
    await input.press("Enter");

    await expect(treeButton(page, "notes.md")).toBeVisible({ timeout: 5000 });
  } finally {
    await app.close();
  }
});

test("create a new folder via context menu", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    const docsRow = treeButton(page, "docs");
    await docsRow.click({ button: "right" });

    await page.getByRole("menuitem", { name: "新建文件夹" }).click();

    const input = sidebar(page).locator("input").last();
    await expect(input).toBeVisible();
    await input.fill("images");
    await input.press("Enter");

    await expect(treeButton(page, "images")).toBeVisible({ timeout: 5000 });
  } finally {
    await app.close();
  }
});

test("cancel creating a file with Escape", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    const docsRow = treeButton(page, "docs");
    await docsRow.click({ button: "right" });

    await page.getByRole("menuitem", { name: "新建文件", exact: true }).click();
    const input = sidebar(page).locator("input").last();
    await expect(input).toBeVisible();
    await input.press("Escape");

    await expect(input).not.toBeVisible();
  } finally {
    await app.close();
  }
});

test("delete a file via context menu and confirm", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await treeButton(page, "docs").click();
    const guideRow = treeButton(page, "guide.md");
    await expect(guideRow).toBeVisible();

    await guideRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "删除" }).click();

    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("guide.md");

    await dialog.getByRole("button", { name: "删除" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(guideRow).not.toBeVisible({ timeout: 5000 });
  } finally {
    await app.close();
  }
});

test("cancel deletion via alert dialog", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await treeButton(page, "docs").click();
    const guideRow = treeButton(page, "guide.md");
    await expect(guideRow).toBeVisible();

    await guideRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "删除" }).click();

    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(guideRow).toBeVisible();
  } finally {
    await app.close();
  }
});

test("sidebar does not expand when file names overflow", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    const initialBox = await sidebar(page).boundingBox();
    expect(initialBox).not.toBeNull();

    await treeButton(page, "src").click();
    await treeButton(page, "components").click();
    await treeButton(page, "ui").click();
    await treeButton(page, "deep").click();

    await expect(treeSpan(page, "a-very-long-file-name")).toBeVisible();

    const afterExpandBox = await sidebar(page).boundingBox();
    expect(afterExpandBox).not.toBeNull();
    expect(Math.abs(afterExpandBox!.width - initialBox!.width)).toBeLessThan(2);
  } finally {
    await app.close();
  }
});
