import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeApp } from "./helpers/electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");
const navToken = Date.now();

const CARD_HTML = [
  "<!DOCTYPE html>",
  '<html><head><meta charset="UTF-8"></head><body>',
  '<div id="out">waiting</div>',
  "<script>",
  "function show(){var r=window.__SPHERSE__;if(r&&r.sessionId)document.getElementById('out').textContent='sid:'+r.sessionId;}",
  "window.addEventListener('message',function(e){if(e.data&&e.data.type==='spherse:runtime'){window.__SPHERSE__=e.data;show();}});",
  "show();",
  "</script>",
  "</body></html>",
].join("\n");

async function createCardProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-card-"));
  await mkdir(path.join(root, ".spherse", "agents", "assistant"), { recursive: true });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# Test\n");
  await writeFile(
    path.join(root, ".spherse", "agents", "assistant", "profile.md"),
    [
      "---",
      "id: assistant-1",
      "name: Assistant",
      "type: assistant",
      "model: deepseek-v4-flash",
      "tools: []",
      "---",
      "You help with everything.",
      "",
    ].join("\n"),
  );
  return { root, projectId };
}

async function launchApp(project: { root: string; projectId: string }): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-card-user-"));
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

async function createSessionViaApi(page: Page, projectId: string, agentId: string): Promise<string> {
  const port: number = await page.evaluate(() => window.electronAPI.getServerPort());
  const token = (await page.evaluate(() => window.electronAPI.getMobileAccessState())).token ?? null;
  const res = await fetch(`http://localhost:${port}/api/projects/${projectId}/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`createSession ${res.status}: ${JSON.stringify(body)}`);
  return (body as { sessionId: string }).sessionId;
}

function createCardSequence(mode: "content" | "file" = "content"): Record<string, unknown>[] {
  const args = mode === "file"
    ? { type: "html", file_path: "card.html" }
    : { type: "html", content: CARD_HTML };
  const updateDetails = mode === "file"
    ? { type: "html", html: CARD_HTML, file_path: "card.html" }
    : { type: "html", html: CARD_HTML };
  return [
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: { role: "user", content: [{ type: "text", text: "show card" }] } },
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "show card" }] } },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Here is a card" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Here is a card" }] } },
    {
      type: "tool_execution_start",
      toolCallId: "card1",
      toolName: "render_card",
      args,
    },
    {
      type: "tool_execution_update",
      toolCallId: "card1",
      toolName: "render_card",
      args,
      partialResult: {
        content: [{ type: "text", text: "rendering..." }],
        details: updateDetails,
      },
    },
    {
      type: "tool_execution_end",
      toolCallId: "card1",
      toolName: "render_card",
      result: "HTML card rendered successfully",
      isError: false,
    },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
    { type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }] }, toolResults: [] },
    { type: "agent_end", messages: [] },
  ];
}

async function assertCardReceivesRuntime(
  project: { root: string; projectId: string },
  mode: "content" | "file",
) {
  const { app, page } = await launchApp(project);
  try {
    const port: number = await page.evaluate(() => window.electronAPI.getServerPort());
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
      ws.onMessage((message) => {
        const parsed = JSON.parse(message as string);
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        } else if (parsed.type === "message") {
          for (const event of createCardSequence(mode)) {
            ws.send(JSON.stringify(event));
          }
        }
      });
    });

    await page.goto(`file://${rendererEntry}?e2e=${navToken}#/project/${project.projectId}/chat/${sessionId}`);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("show card");
    await textarea.press("Enter");

    const frame = page.frameLocator("[data-chat-message] iframe").first();
    await expect(frame.locator("#out")).toHaveText(`sid:${sessionId}`, { timeout: 15_000 });
  } finally {
    await closeApp(app);
  }
}

test("HtmlCard iframe receives runtime context with current sessionId (inline content)", async () => {
  const project = await createCardProject();
  await assertCardReceivesRuntime(project, "content");
});

test("HtmlCard iframe receives runtime context with current sessionId (file_path)", async () => {
  const project = await createCardProject();
  await writeFile(path.join(project.root, "card.html"), CARD_HTML);
  await assertCardReceivesRuntime(project, "file");
});
