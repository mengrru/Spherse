import { expect, test } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeApp } from "./helpers/electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

const MANIFEST_DOC = {
  $manifest: {
    version: 1,
    desc: "e2e board",
    queries: { listTodos: { path: "todos", identity: "id" } },
    mutations: {
      addTodo: {
        op: "append",
        path: "todos",
        fields: { title: { type: "string", required: true } },
        auto: { id: "uuid" },
      },
    },
  },
  todos: [],
};

const PAGE_HTML = [
  "<!DOCTYPE html>",
  '<html><head><meta charset="utf-8"></head><body>',
  "<h1>Data Selective Test</h1>",
  '<p>parallel result: <span id="parallel-result">--</span></p>',
  '<p>entries result: <span id="entries-result">--</span></p>',
  '<p>manifest write result: <span id="manifest-result">--</span></p>',
  '<p>mutate result: <span id="mutate-result">--</span></p>',
  '<button id="btn-parallel">Parallel writes</button>',
  '<button id="btn-entries">Entries</button>',
  '<button id="btn-set-manifest">Set $manifest</button>',
  '<button id="btn-mutate">Mutate addTodo x10</button>',
  "<script>",
  "const DATA_FILE = 'board.data.json';",
  "function spherseCall(action, params) {",
  "  return new Promise((resolve, reject) => {",
  "    const requestId = 'r' + Date.now() + Math.random().toString(36).slice(2);",
  "    const timeout = setTimeout(() => { cleanup(); reject(new Error('spherse timeout')); }, 5000);",
  "    const handler = (e) => {",
  "      if (e.data?.type === 'spherse:response' && e.data.requestId === requestId) {",
  "        cleanup();",
  "        if (e.data.ok) resolve(e.data.data); else reject(new Error('spherse rejected'));",
  "      }",
  "    };",
  "    function cleanup() { clearTimeout(timeout); window.removeEventListener('message', handler); }",
  "    window.addEventListener('message', handler);",
  "    window.parent.postMessage({ type: 'spherse:action', action, params, requestId }, '*');",
  "  });",
  "}",
  "document.getElementById('btn-parallel').onclick = async function () {",
  "  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>",
  "    spherseCall('data.set', { file: DATA_FILE, key: 'k' + i, value: i }).catch(() => 'FAIL')));",
  "  const fails = results.filter((r) => r === 'FAIL').length;",
  "  const entries = await spherseCall('data.entries', { file: DATA_FILE });",
  "  const present = Array.from({ length: 20 }, (_, i) => 'k' + i).filter((k) => k in entries).length;",
  "  document.getElementById('parallel-result').textContent = 'fails=' + fails + ' present=' + present;",
  "};",
  "document.getElementById('btn-entries').onclick = async function () {",
  "  const entries = await spherseCall('data.entries', { file: DATA_FILE });",
  "  document.getElementById('entries-result').textContent = JSON.stringify(Object.keys(entries));",
  "};",
  "document.getElementById('btn-set-manifest').onclick = async function () {",
  "  const r = await spherseCall('data.set', { file: DATA_FILE, key: '$manifest', value: {} }).catch((e) => 'rejected');",
  "  document.getElementById('manifest-result').textContent = r === 'rejected' ? 'rejected' : 'WROTE:' + JSON.stringify(r);",
  "};",
  "document.getElementById('btn-mutate').onclick = async function () {",
  "  const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>",
  "    window.spherse.data.mutate({ file: DATA_FILE, name: 'addTodo', args: { title: 'page-' + i }, idempotencyKey: 'e2e-' + i }).catch(() => 'FAIL')));",
  "  const fails = results.filter((r) => r === 'FAIL').length;",
  "  const ids = results.filter((r) => r !== 'FAIL' && /^[0-9a-f-]{36}$/.test(r.id)).length;",
  "  const entries = await spherseCall('data.entries', { file: DATA_FILE });",
  "  document.getElementById('mutate-result').textContent = 'fails=' + fails + ' ids=' + ids + ' todos=' + entries.todos.length;",
  "};",
  "</script></body></html>",
].join("\n");

async function createProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-sel-"));
  await mkdir(path.join(root, ".spherse"), { recursive: true });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# Test\n");
  await writeFile(path.join(root, "board.html"), PAGE_HTML);
  await writeFile(path.join(root, "board.data.json"), JSON.stringify(MANIFEST_DOC, null, 2));
  return { root, projectId };
}

async function launchAppWithProject(project: { root: string; projectId: string }): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-sel-user-"));
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

async function openBoardPage(page: Page, projectId: string) {
  await page.goto(
    `file://${rendererEntry}?e2e=${Date.now()}#/project/${projectId}/content?path=${encodeURIComponent("board.html")}`,
  );
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#btn-parallel")).toBeVisible({ timeout: 30_000 });
  return frame;
}

test("20 parallel SDK writes through server DataStore lose nothing; $manifest stays intact", async () => {
  const project = await createProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    const frame = await openBoardPage(page, project.projectId);
    await frame.locator("#btn-parallel").click();
    await expect(frame.locator("#parallel-result")).toContainText("fails=0 present=20", { timeout: 30_000 });

    const onDisk = JSON.parse(await readFile(path.join(project.root, "board.data.json"), "utf8"));
    expect(Object.keys(onDisk).filter((k) => k.startsWith("k"))).toHaveLength(20);
    expect(onDisk.$manifest).toBeDefined();
    expect(onDisk.$manifest.mutations.addTodo.op).toBe("append");
  } finally {
    await closeApp(app);
  }
});

test("data.mutate from page applies manifest mutations atomically", async () => {
  const project = await createProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    const frame = await openBoardPage(page, project.projectId);
    await frame.locator("#btn-mutate").click();
    await expect(frame.locator("#mutate-result")).toContainText("fails=0 ids=10 todos=10", { timeout: 30_000 });

    const onDisk = JSON.parse(await readFile(path.join(project.root, "board.data.json"), "utf8"));
    expect(onDisk.todos).toHaveLength(10);
    for (const t of onDisk.todos as { title: string; id: string }[]) {
      expect(t.title).toMatch(/^page-\d+$/);
      expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  } finally {
    await closeApp(app);
  }
});

test("data.entries excludes $-prefixed keys; $-key writes are rejected", async () => {
  const project = await createProject();
  const { app, page } = await launchAppWithProject(project);

  try {
    const frame = await openBoardPage(page, project.projectId);
    await frame.locator("#btn-entries").click();
    await expect(frame.locator("#entries-result")).toContainText("todos", { timeout: 15_000 });
    await expect(frame.locator("#entries-result")).not.toContainText("$manifest");

    await frame.locator("#btn-set-manifest").click();
    await expect(frame.locator("#manifest-result")).toContainText("rejected", { timeout: 15_000 });
  } finally {
    await closeApp(app);
  }
});
