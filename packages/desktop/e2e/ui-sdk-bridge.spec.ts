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

/**
 * Drives the host through the *injected* SDK bridge (`window.spherse.*`) rather than
 * hand-written postMessage. The other ui-sdk e2e specs prove the host reacts to raw
 * `spherse:action` messages; this spec proves the @spherse/sdk bundle the server injects
 * into preview iframes actually exposes a working surface — `call()` resolves/rejects via
 * requestId correlation, `fire()` navigates, and the `api.*` / `data.*` namespaces route
 * through to the host handlers.
 */
const BRIDGE_HTML = [
  "<!DOCTYPE html>",
  '<html><head><meta charset="utf-8"></head><body>',
  '<div id="status">ready</div>',
  '<button id="btn-surface">Check surface</button>',
  '<button id="btn-open">Open file</button>',
  '<button id="btn-data-set">Data set</button>',
  '<button id="btn-data-get">Data get</button>',
  '<button id="btn-agents">List agents</button>',
  '<button id="btn-filetree">File tree</button>',
  '<button id="btn-unknown">Unknown op</button>',
  '<button id="btn-watch">Watch file</button>',
  "<script>",
  "function show(text){document.getElementById('status').textContent=text;}",
  "document.getElementById('btn-surface').onclick=function(){",
  "  var s=window.spherse;",
  "  show([typeof s, typeof s.call, typeof s.fire, typeof s.getRuntime, typeof s.data, typeof s.api, typeof s.events, typeof s.openFile].join(','));",
  "};",
  "document.getElementById('btn-open').onclick=function(){window.spherse.openFile('world/target-file.md');};",
  "document.getElementById('btn-data-set').onclick=async function(){",
  "  try{var r=await window.spherse.data.set({file:'sdk-bridge.data.json',key:'score',value:99});show('set:'+JSON.stringify(r));}",
  "  catch(e){show('set-err:'+e.message);}",
  "};",
  "document.getElementById('btn-data-get').onclick=async function(){",
  "  try{var r=await window.spherse.data.get({file:'sdk-bridge.data.json',key:'score'});show('get:'+JSON.stringify(r));}",
  "  catch(e){show('get-err:'+e.message);}",
  "};",
  "document.getElementById('btn-agents').onclick=async function(){",
  "  try{var r=await window.spherse.api.agents.list();show('agents:'+(Array.isArray(r)?r.length+' agents':'non-array'));}",
  "  catch(e){show('agents-err:'+e.message);}",
  "};",
  "document.getElementById('btn-filetree').onclick=async function(){",
  "  try{var r=await window.spherse.api.fileTree();show('filetree:'+(Array.isArray(r)?r.length+' entries':'non-array'));}",
  "  catch(e){show('filetree-err:'+e.message);}",
  "};",
  "document.getElementById('btn-unknown').onclick=async function(){",
  "  try{await window.spherse.api.call('nonexistent_op');show('unknown:resolved');}",
  "  catch(e){show('unknown:rejected:'+e.message);}",
  "};",
  "document.getElementById('btn-watch').onclick=function(){",
  "  window.spherse.events.on('file:update',{path:'./sdk-watch.json'},function(e){show('event:'+e.path);});",
  "  show('watching');",
  "};",
  "document.body.dataset.bridgeReady='true';",
  "</script></body></html>",
].join("\n");

async function createBridgeProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-bridge-"));
  await mkdir(path.join(root, ".spherse", "agents", "test-agent"), {
    recursive: true,
  });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# Test\n");
  await mkdir(path.join(root, "world"), { recursive: true });

  await writeFile(
    path.join(root, ".spherse", "agents", "test-agent", "profile.md"),
    [
      "---",
      "id: test-agent",
      "name: Test Agent",
      "type: assistant",
      "model: deepseek-v4-flash",
      "tools: []",
      "---",
      "You are a test agent.",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(root, "world", "target-file.md"),
    "# Target File\n",
  );
  await mkdir(path.join(root, "pages"), { recursive: true });
  await writeFile(path.join(root, "pages", "sdk-bridge.html"), BRIDGE_HTML);
  await writeFile(path.join(root, "pages", "sdk-watch.json"), "{}\n");

  return { root, bridgeHtmlPath: "pages/sdk-bridge.html", projectId };
}

async function launchApp(project: { root: string; projectId: string }): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-bridge-user-"));
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

async function openBridge(page: Page, project: { projectId: string; bridgeHtmlPath: string }) {
  const projectUrl = `/project/${project.projectId}`;
  await page.goto(
    `file://${rendererEntry}?e2e=${Date.now()}#${projectUrl}/content?path=${encodeURIComponent(project.bridgeHtmlPath)}`,
  );
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#btn-surface")).toBeVisible({ timeout: 30_000 });
  await expect(frame.locator("body")).toHaveAttribute("data-bridge-ready", "true");
  return frame;
}

test("window.spherse is injected with the documented surface", async () => {
  const project = await createBridgeProject();
  const { app, page } = await launchApp(project);

  try {
    const frame = await openBridge(page, project);
    await frame.locator("#btn-surface").click();
    await expect(frame.locator("#status")).toHaveText(
      "object,function,function,function,object,object,object,function",
      { timeout: 10_000 },
    );
  } finally {
    await app.close();
  }
});

test("spherse.openFile() (fire) navigates the host", async () => {
  const project = await createBridgeProject();
  const { app, page } = await launchApp(project);

  try {
    const frame = await openBridge(page, project);
    await frame.locator("#btn-open").click();
    await expect(page).toHaveURL(
      new RegExp(
        `#/project/${project.projectId}/content\\?path=world%2Ftarget-file\\.md`,
      ),
    );
  } finally {
    await app.close();
  }
});

test("spherse.data.set/get round-trip resolves via call()", async () => {
  const project = await createBridgeProject();
  const { app, page } = await launchApp(project);

  try {
    const frame = await openBridge(page, project);
    await frame.locator("#btn-data-set").click();
    await expect(frame.locator("#status")).toHaveText("set:99", { timeout: 10_000 });

    await frame.locator("#btn-data-get").click();
    await expect(frame.locator("#status")).toHaveText("get:99", { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test("spherse.api.agents.list() bridges to the server HTTP allowlist", async () => {
  const project = await createBridgeProject();
  const { app, page } = await launchApp(project);

  try {
    const frame = await openBridge(page, project);
    await frame.locator("#btn-agents").click();
    await expect(frame.locator("#status")).toHaveText("agents:1 agents", { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test("spherse.api.fileTree() bridges to the server HTTP allowlist", async () => {
  const project = await createBridgeProject();
  const { app, page } = await launchApp(project);

  try {
    const frame = await openBridge(page, project);
    await frame.locator("#btn-filetree").click();
    const status = frame.locator("#status");
    await expect(status).toHaveText(/filetree:\d+ entries/, { timeout: 10_000 });
    const text = (await status.textContent()) ?? "";
    const count = Number.parseInt(text.match(/filetree:(\d+)/)![1], 10);
    // At least AGENTS.md, the html fixture, and the target file exist.
    expect(count).toBeGreaterThanOrEqual(3);
  } finally {
    await app.close();
  }
});

test("spherse.api.call() rejects when the op is not allowlisted", async () => {
  const project = await createBridgeProject();
  const { app, page } = await launchApp(project);

  try {
    const frame = await openBridge(page, project);
    await frame.locator("#btn-unknown").click();
    await expect(frame.locator("#status")).toHaveText("unknown:rejected:unknown_op", {
      timeout: 10_000,
    });
  } finally {
    await app.close();
  }
});

test("spherse.events.on() receives filtered file:update events", async () => {
  const project = await createBridgeProject();
  const { app, page } = await launchApp(project);

  try {
    const frame = await openBridge(page, project);
    await frame.locator("#btn-watch").click();
    await expect(frame.locator("#status")).toHaveText("watching");

    await writeFile(path.join(project.root, "pages", "sdk-watch.json"), '{"updated":true}\n');

    await expect(frame.locator("#status")).toHaveText(
      "event:pages/sdk-watch.json",
      { timeout: 10_000 },
    );
  } finally {
    await app.close();
  }
});
