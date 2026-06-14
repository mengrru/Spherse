import { expect, test } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

const DATA_TEST_HTML = [
  "<!DOCTYPE html>",
  "<html><head><meta charset=\"utf-8\"></head><body>",
  "<h1>Data CRUD Test</h1>",
  "<p>get result: <span id=\"get-result\">--</span></p>",
  "<p>set result: <span id=\"set-result\">--</span></p>",
  "<p>delete result: <span id=\"delete-result\">--</span></p>",
  "<button id=\"btn-set-score\" onclick=\"setScore()\">Set Score 42</button>",
  "<button id=\"btn-set-complex\" onclick=\"setComplex()\">Set Complex</button>",
  "<button id=\"btn-get-score\" onclick=\"getScore()\">Get Score</button>",
  "<button id=\"btn-get-missing\" onclick=\"getMissing()\">Get Missing</button>",
  "<button id=\"btn-delete-score\" onclick=\"deleteScore()\">Delete Score</button>",
  "<script>",
  "const DATA_FILE = 'sdk-data-test.data.json';",
  "function spherseCall(action, params) {",
  "  return new Promise((resolve, reject) => {",
  "    const requestId = 'r' + Date.now() + Math.random().toString(36).slice(2);",
  "    const timeout = setTimeout(() => { cleanup(); reject(new Error('spherse timeout')); }, 10000);",
  "    const handler = (e) => {",
  "      if (e.data?.type === 'spherse:response' && e.data.requestId === requestId) {",
  "        cleanup();",
  "        e.data.ok ? resolve(e.data.data) : reject(new Error('spherse data error'));",
  "      }",
  "    };",
  "    function cleanup() { clearTimeout(timeout); window.removeEventListener('message', handler); }",
  "    window.addEventListener('message', handler);",
  "    window.parent.postMessage({ type: 'spherse:action', action, params, requestId }, '*');",
  "  });",
  "}",
  "async function setScore() {",
  "  const v = await spherseCall('data.set', { file: DATA_FILE, key: 'score', value: 42 });",
  "  document.getElementById('set-result').textContent = JSON.stringify(v);",
  "}",
  "async function setComplex() {",
  "  const v = await spherseCall('data.set', { file: DATA_FILE, key: 'player', value: { name: 'Alice', items: [1,2,3] } });",
  "  document.getElementById('set-result').textContent = JSON.stringify(v);",
  "}",
  "async function getScore() {",
  "  const v = await spherseCall('data.get', { file: DATA_FILE, key: 'score' });",
  "  document.getElementById('get-result').textContent = JSON.stringify(v);",
  "}",
  "async function getMissing() {",
  "  const v = await spherseCall('data.get', { file: DATA_FILE, key: 'nonexistent' });",
  "  document.getElementById('get-result').textContent = JSON.stringify(v);",
  "}",
  "async function deleteScore() {",
  "  const v = await spherseCall('data.delete', { file: DATA_FILE, key: 'score' });",
  "  document.getElementById('delete-result').textContent = JSON.stringify(v);",
  "}",
  "</script></body></html>",
].join("\n");

async function createDataProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-data-"));
  await mkdir(path.join(root, ".spherse"), { recursive: true });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\npaths:\n  agents: agents\n  index: AGENTS.md\n  changelog: CHANGELOG.md\n`,
  );

  await writeFile(path.join(root, "sdk-data-test.html"), DATA_TEST_HTML);

  return { root, testHtmlPath: "sdk-data-test.html", projectId };
}

async function launchAppWithProject(project: { root: string; projectId: string }): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const userDataDir = await mkdtemp(
    path.join(tmpdir(), "spherse-e2e-data-user-"),
  );
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_ENABLE_LOGGING: "1",
      XDG_CONFIG_HOME: userDataDir,
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async ({ id, projectRoot }) => {
    await window.electronAPI.openProject(projectRoot);
    await window.electronAPI.addOpenProject(id, projectRoot);
    await window.electronAPI.setLastActiveProject(id);
  }, { id: project.projectId, projectRoot: project.root });
  return { app, page };
}

test("data.set + data.get round trip", async () => {
  const project = await createDataProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    const projectUrl = `/project/${project.projectId}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.testHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-set-score")).toBeVisible({ timeout: 30_000 });

    await frame.locator("#btn-set-score").click();
    await expect(frame.locator("#set-result")).toContainText("42", { timeout: 10_000 });

    await frame.locator("#btn-get-score").click();
    await expect(frame.locator("#get-result")).toContainText("42", { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test("data.get nonexistent key returns null", async () => {
  const project = await createDataProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    const projectUrl = `/project/${project.projectId}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.testHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-get-missing")).toBeVisible({ timeout: 30_000 });

    await frame.locator("#btn-get-missing").click();
    await expect(frame.locator("#get-result")).toContainText("null", { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test("data.delete removes key", async () => {
  const project = await createDataProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    const projectUrl = `/project/${project.projectId}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.testHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-set-score")).toBeVisible({ timeout: 30_000 });

    await frame.locator("#btn-set-score").click();
    await expect(frame.locator("#set-result")).toContainText("42", { timeout: 10_000 });

    await frame.locator("#btn-delete-score").click();
    await expect(frame.locator("#delete-result")).toContainText("true", { timeout: 10_000 });

    await frame.locator("#btn-get-score").click();
    await expect(frame.locator("#get-result")).toContainText("null", { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test("data persistence survives navigation", async () => {
  const project = await createDataProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    const projectUrl = `/project/${project.projectId}`;

    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.testHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-set-score")).toBeVisible({ timeout: 30_000 });

    await frame.locator("#btn-set-score").click();
    await expect(frame.locator("#set-result")).toContainText("42", { timeout: 10_000 });

    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=sdk-data-test.html`,
    );

    const frame2 = page.frameLocator("iframe");
    await expect(frame2.locator("#btn-get-score")).toBeVisible({ timeout: 30_000 });

    await frame2.locator("#btn-get-score").click();
    await expect(frame2.locator("#get-result")).toContainText("42", { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test("data.set with complex JSON value", async () => {
  const project = await createDataProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    const projectUrl = `/project/${project.projectId}`;
    await page.goto(
      `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.testHtmlPath)}`,
    );

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#btn-set-complex")).toBeVisible({ timeout: 30_000 });

    await frame.locator("#btn-set-complex").click();
    await expect(frame.locator("#set-result")).toContainText('"name":"Alice"', { timeout: 10_000 });
    await expect(frame.locator("#set-result")).toContainText("[1,2,3]", { timeout: 10_000 });
  } finally {
    await app.close();
  }
});
