import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");
const navToken = Date.now();

async function createChatProject() {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-chat-"));
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\npaths:\n  agents: agents\n  index: AGENTS.md\n  changelog: CHANGELOG.md\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# Test\n");
  await mkdir(path.join(root, ".spherse", "agents", "assistant"), { recursive: true });
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
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-chat-user-"));
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
  const res = await fetch(`http://localhost:${port}/api/projects/${projectId}/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: "POST",
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`createSession ${res.status}: ${JSON.stringify(body)}`);
  const { sessionId } = body as { sessionId: string };
  return sessionId;
}

function navigateToSession(page: Page, projectId: string, sessionId: string) {
  const projectUrl = `/project/${projectId}/chat/${sessionId}`;
  return page.goto(`file://${rendererEntry}?e2e=${navToken}#${projectUrl}`);
}

interface MockEvent {
  type: string;
  [key: string]: any;
}

async function mockChatWebSocket(page: Page, port: number, events: MockEvent[]) {
  await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
    ws.onMessage((message) => {
      const parsed = JSON.parse(message as string);
      if (parsed.type === "message") {
        for (const event of events) {
          ws.send(JSON.stringify(event));
        }
      } else if (parsed.type === "abort") {
        ws.send(JSON.stringify({ type: "agent_end", messages: [] }));
      }
    });
  });
}

async function mockStreamingWithoutEnd(page: Page, port: number, eventsBeforeEnd: MockEvent[]): Promise<{ complete: () => void }> {
  let resolveComplete: () => void;
  const completePromise = new Promise<void>((resolve) => { resolveComplete = resolve; });

  await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
    ws.onMessage((message) => {
      const parsed = JSON.parse(message as string);
      if (parsed.type === "message") {
        for (const event of eventsBeforeEnd) {
          ws.send(JSON.stringify(event));
        }
        void completePromise.then(() => {
          ws.send(JSON.stringify({ type: "agent_end", messages: [] }));
        });
      } else if (parsed.type === "abort") {
        ws.send(JSON.stringify({ type: "agent_end", messages: [] }));
      }
    });
  });

  return { complete: () => resolveComplete() };
}

function createStreamingSequence(): MockEvent[] {
  return [
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: { role: "user", content: [{ type: "text", text: "test message" }] } },
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "test message" }] } },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] } },
    { type: "tool_execution_start", toolCallId: "tc1", toolName: "read_file", args: { path: "a.md" } },
    { type: "tool_execution_update", toolCallId: "tc1", toolName: "read_file", args: { path: "a.md" }, partialResult: "content" },
    { type: "tool_execution_end", toolCallId: "tc1", toolName: "read_file", result: "content", isError: false },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Based on" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Based on the file content." }] } },
    { type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "Based on the file content." }] }, toolResults: [] },
    { type: "agent_end", messages: [] },
  ];
}

test("abort button visible throughout entire agent turn until agent_end", async () => {
  const project = await createChatProject();
  const { app, page } = await launchApp(project);

  try {
    const port: number = await page.evaluate(() => window.electronAPI.getServerPort());
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    const eventsBeforeEnd = createStreamingSequence().filter((e) => e.type !== "agent_end");
    const { complete } = await mockStreamingWithoutEnd(page, port, eventsBeforeEnd);

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("[data-chat-composer] button svg.lucide-square", { timeout: 5000 });

    await expect(page.locator("[data-chat-composer] button svg.lucide-square")).toBeVisible();
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toHaveCount(0);

    complete();

    await page.waitForSelector("[data-chat-composer] button svg.lucide-send", { timeout: 5000 });
    await expect(page.locator("[data-chat-composer] button svg.lucide-square")).toHaveCount(0);
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("streaming continues after switching away and back", async () => {
  const project = await createChatProject();
  const { app, page } = await launchApp(project);

  try {
    const port: number = await page.evaluate(() => window.electronAPI.getServerPort());
    const sessionA = await createSessionViaApi(page, project.projectId, "assistant-1");
    const sessionB = await createSessionViaApi(page, project.projectId, "assistant-1");

    await mockChatWebSocket(page, port, createStreamingSequence());

    await navigateToSession(page, project.projectId, sessionA);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("text=Hello", { timeout: 5000 });

    await navigateToSession(page, project.projectId, sessionB);
    await page.waitForSelector("[data-chat-composer]", { timeout: 5000 });

    await navigateToSession(page, project.projectId, sessionA);

    await page.waitForSelector("text=Based on the file content.", { timeout: 10000 });
    await expect(page.locator("[data-chat-composer] button svg.lucide-send")).toBeVisible({ timeout: 10000 });
  } finally {
    await app.close();
  }
});

test("sidebar shows streaming indicator on background session", async () => {
  const project = await createChatProject();
  const { app, page } = await launchApp(project);

  try {
    const port: number = await page.evaluate(() => window.electronAPI.getServerPort());
    const sessionA = await createSessionViaApi(page, project.projectId, "assistant-1");
    const sessionB = await createSessionViaApi(page, project.projectId, "assistant-1");

    const eventsBeforeEnd = createStreamingSequence().filter((e) => e.type !== "agent_end");
    const { complete } = await mockStreamingWithoutEnd(page, port, eventsBeforeEnd);

    await navigateToSession(page, project.projectId, sessionA);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("text=Hello", { timeout: 5000 });

    await navigateToSession(page, project.projectId, sessionB);
    await page.waitForSelector("[data-chat-composer]", { timeout: 5000 });

    await page.locator('[data-slot="collapsible-trigger"]:has-text("Assistant")').click();
    const sessionARow = page.locator(`[data-session-id="${sessionA}"]`);
    await expect(sessionARow).toBeVisible({ timeout: 5000 });
    await expect(sessionARow.locator("svg.lucide-loader-circle")).toBeVisible({ timeout: 5000 });

    complete();

    await page.waitForSelector(`[data-session-id="${sessionA}"] svg.lucide-loader-circle`, { state: "hidden", timeout: 10000 }).catch(() => {});
  } finally {
    await app.close();
  }
});
