import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileTreeProject, launchFileTreeApp } from "./helpers/file-tree";
import { closeApp } from "./helpers/electron";

test.setTimeout(60_000);

const BINARY_PAYLOAD = Buffer.from([0x00, 0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x7f]);

test("unsupported file card downloads original bytes and keeps open-externally", async () => {
  const project = await createFileTreeProject();
  const source = path.join(project.root, "asset.zip");
  await writeFile(source, BINARY_PAYLOAD);

  const saveDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-dl-"));
  const target = path.join(saveDir, "asset.zip");
  process.env.SPHERSE_E2E_SAVE_DIALOG_PATH = target;

  const { app, page } = await launchFileTreeApp(project, { initialPath: "asset.zip" });

  try {
    await expect(
      page.getByText("此文件类型无法在 Spherse 内预览"),
    ).toBeVisible({ timeout: 10_000 });

    const downloadButton = page.getByRole("button", { name: "下载" });
    await expect(downloadButton).toBeVisible();
    await expect(page.getByRole("button", { name: "用默认应用打开" })).toBeVisible();

    await downloadButton.click();

    await expect
      .poll(async () => {
        try {
          return (await readFile(target)).equals(BINARY_PAYLOAD);
        } catch {
          return false;
        }
      }, { timeout: 10_000 })
      .toBe(true);
  } finally {
    delete process.env.SPHERSE_E2E_SAVE_DIALOG_PATH;
    await closeApp(app);
  }
});
