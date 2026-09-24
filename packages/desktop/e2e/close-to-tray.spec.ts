import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeApp } from "./helpers/electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");

test.setTimeout(60_000);

const require = createRequire(import.meta.url);
const electronBinary = require("electron") as unknown as string;

function testEnv(userDataDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    ELECTRON_ENABLE_LOGGING: "1",
    XDG_CONFIG_HOME: userDataDir,
  };
}

async function launch() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-tray-user-"));
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    cwd: appRoot,
    env: testEnv(userDataDir),
  });
  const logs: string[] = [];
  app.process().stderr?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page, logs, userDataDir };
}

function windowState(app: Awaited<ReturnType<typeof electron.launch>>) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win ? { exists: true, destroyed: win.isDestroyed(), visible: win.isVisible() } : { exists: false };
  });
}

test("closing the window hides it to tray by default and relaunch restores it", async () => {
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    let logs: string[];
    let userDataDir: string;
    ({ app, logs, userDataDir } = await launch());

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => windowState(app!)).toEqual({ exists: true, destroyed: false, visible: false });
    expect(logs.join("")).not.toContain("[tray]");

    const second = spawn(electronBinary, [mainEntry, `--user-data-dir=${userDataDir}`], {
      cwd: appRoot,
      env: testEnv(userDataDir),
      stdio: "ignore",
    });
    const exitCode = await new Promise<number | null>((resolve) => second.once("exit", (code) => resolve(code)));
    expect(exitCode).toBe(0);
    await expect.poll(() => windowState(app!)).toEqual({ exists: true, destroyed: false, visible: true });
  } finally {
    await closeApp(app);
  }
});

test("closing the window quits the app when close-to-tray is disabled", async () => {
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    let page;
    ({ app, page } = await launch());
    await page.evaluate(async () => {
      const current = await window.electronAPI.getSettings();
      await window.electronAPI.saveSettings({
        ...(current ?? {}),
        locale: current?.locale ?? "zh-CN",
        models: current?.models ?? {
          text: { defaultModel: "", providers: {} },
          image: { defaultModel: "", providers: {} },
        },
        closeToTray: false,
      });
    });

    const exited = new Promise<void>((resolve) => app!.process().once("exit", () => resolve()));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await exited;
    app = undefined;
  } finally {
    await closeApp(app);
  }
});
