import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(appRoot, "release");

const executableEnv = process.env.SPHERSE_SMOKE_EXECUTABLE;
const smokeEnabled = executableEnv !== undefined || process.env.SPHERSE_SMOKE === "1";
const expectedVersion = process.env.SPHERSE_SMOKE_VERSION;

test.skip(!smokeEnabled, "packaged smoke test requires SPHERSE_SMOKE=1 or SPHERSE_SMOKE_EXECUTABLE");

test.setTimeout(90_000);

async function discoverExecutable(): Promise<string> {
  if (executableEnv) {
    if (!existsSync(executableEnv)) {
      throw new Error(`SPHERSE_SMOKE_EXECUTABLE does not exist: ${executableEnv}`);
    }
    return executableEnv;
  }
  if (!existsSync(releaseDir)) {
    throw new Error(`no packaged app under ${releaseDir}; run npm run pack or npm run dist first`);
  }
  if (process.platform === "darwin") {
    const entries = await readdir(releaseDir);
    const candidates = ["mac-arm64", "mac-universal", "mac"].filter((dir) => entries.includes(dir));
    if (candidates.length === 0) {
      throw new Error(`no macOS app directory (mac*/Spherse.app) under ${releaseDir}`);
    }
    const binary = path.join(releaseDir, candidates[0], "Spherse.app", "Contents", "MacOS", "Spherse");
    if (!existsSync(binary)) {
      throw new Error(`packaged binary not found: ${binary}`);
    }
    return binary;
  }
  if (process.platform === "win32") {
    const binary = path.join(releaseDir, "win-unpacked", "Spherse.exe");
    if (!existsSync(binary)) {
      throw new Error(`packaged binary not found: ${binary}`);
    }
    return binary;
  }
  throw new Error(`packaged smoke test does not support platform ${process.platform}`);
}

test("packaged app launches, mounts renderer and serves /health", async () => {
  const executable = await discoverExecutable();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-smoke-user-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;

  try {
    app = await electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
      },
    });

    const page = await app.firstWindow();
    expect(page).not.toBeNull();
    await page.waitForLoadState("domcontentloaded");

    await page.waitForFunction(() => {
      const root = document.getElementById("root");
      return root !== null && root.childElementCount > 0;
    });

    const port = await page.evaluate(() => window.electronAPI.getServerPort());
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    if (expectedVersion) {
      const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
      expect(version).toBe(expectedVersion);
    }
  } finally {
    await app?.close();
  }
});
