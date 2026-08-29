import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createFileTreeProject, launchFileTreeApp } from "./helpers/file-tree";

import { closeApp } from "./helpers/electron";

test.setTimeout(60_000);

function sidebar(page: import("@playwright/test").Page) {
  return page.locator("aside");
}

function treeButton(page: import("@playwright/test").Page, name: string) {
  return sidebar(page).locator("button").filter({ hasText: new RegExp(`^${name}$`) });
}

async function floatFile(page: import("@playwright/test").Page, name: string) {
  await treeButton(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "浮窗" }).click();
}

test("right-click float opens floating content window with file body", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await floatFile(page, "README.md");

    await expect(page.locator("[data-content-float-root]")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-content-float-root] [data-content-doc]")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-content-float-titlebar]")).toContainText("README.md");
  } finally {
    await closeApp(app);
  }
});

test("markdown content scrolls within the float", async () => {
  const project = await createFileTreeProject();
  const longBody = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: lorem ipsum dolor sit amet.`).join("\n\n");
  await writeFile(`${project.root}/long.md`, `# Long Doc\n\n${longBody}\n`);
  const { app, page } = await launchFileTreeApp(project);

  try {
    await floatFile(page, "long.md");
    const doc = page.locator("[data-content-float-root] [data-content-doc]");
    await expect(doc).toBeVisible({ timeout: 5000 });
    const scrollable = await doc.evaluate((el) => {
      const scroller = el.parentElement;
      return scroller ? scroller.scrollHeight > scroller.clientHeight : false;
    });
    expect(scrollable).toBe(true);
  } finally {
    await closeApp(app);
  }
});

test("close button removes floating content window", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await floatFile(page, "README.md");
    await expect(page.locator("[data-content-float-root]")).toBeVisible({ timeout: 5000 });

    await page.locator("[data-content-float-titlebar] button").click();

    await expect(page.locator("[data-content-float-root]")).toHaveCount(0, { timeout: 5000 });
  } finally {
    await closeApp(app);
  }
});

test("menu toggles to cancel-float when file is already floated", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await floatFile(page, "README.md");
    await expect(page.locator("[data-content-float-root]")).toBeVisible({ timeout: 5000 });

    await treeButton(page, "README.md").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "取消浮窗" })).toBeVisible();

    await page.getByRole("menuitem", { name: "取消浮窗" }).click();
    await expect(page.locator("[data-content-float-root]")).toHaveCount(0, { timeout: 5000 });
  } finally {
    await closeApp(app);
  }
});

test("multiple files can be floated simultaneously", async () => {
  const project = await createFileTreeProject();
  await mkdir(`${project.root}/notes`, { recursive: true });
  await writeFile(`${project.root}/notes/chapter1.md`, "# Chapter 1\n\nThe beginning.\n");
  const { app, page } = await launchFileTreeApp(project);

  try {
    await floatFile(page, "README.md");
    await expect(page.locator("[data-content-float-root]")).toHaveCount(1, { timeout: 5000 });

    await treeButton(page, "notes").click();
    await floatFile(page, "chapter1.md");
    await expect(page.locator("[data-content-float-root]")).toHaveCount(2, { timeout: 5000 });
  } finally {
    await closeApp(app);
  }
});

test("HTML file renders as preview iframe, not source", async () => {
  const project = await createFileTreeProject();
  await writeFile(
    `${project.root}/preview.html`,
    "<!DOCTYPE html><html><body><h1>Hello Preview</h1></body></html>\n",
  );
  const { app, page } = await launchFileTreeApp(project);

  try {
    await floatFile(page, "preview.html");
    await expect(page.locator("[data-content-float-root]")).toBeVisible({ timeout: 5000 });
    const iframe = page.locator("[data-content-float-root] iframe");
    await expect(iframe).toBeVisible({ timeout: 5000 });
    const rootBox = await page.locator("[data-content-float-root]").boundingBox();
    const titlebarBox = await page.locator("[data-content-float-titlebar]").boundingBox();
    const iframeBox = await iframe.boundingBox();
    expect(rootBox).not.toBeNull();
    expect(titlebarBox).not.toBeNull();
    expect(iframeBox).not.toBeNull();
    expect(iframeBox!.height).toBeGreaterThan(rootBox!.height - titlebarBox!.height - 20);
  } finally {
    await closeApp(app);
  }
});

test("double-click title bar opens file in content browser and closes float", async () => {
  const project = await createFileTreeProject();
  const { app, page } = await launchFileTreeApp(project);

  try {
    await floatFile(page, "README.md");
    await expect(page.locator("[data-content-float-root]")).toBeVisible({ timeout: 5000 });

    await page.locator("[data-content-float-titlebar]").dblclick();

    await expect(page.locator("[data-content-float-root]")).toHaveCount(0, { timeout: 5000 });
    await expect(page).toHaveURL(new RegExp(`/content\\?path=${encodeURIComponent("README.md")}$`));
  } finally {
    await closeApp(app);
  }
});
