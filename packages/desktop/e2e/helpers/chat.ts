import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "../..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");
const navToken = Date.now();

export interface ChatProject {
  root: string;
  projectId: string;
}

export interface MockEvent {
  type: string;
  [key: string]: unknown;
}

export async function createChatProject(): Promise<ChatProject> {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-chat-"));
  await mkdir(path.join(root, ".spherse", "agents"), { recursive: true });
  const projectId = Math.random().toString(36).slice(2, 10);
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: Test\ncreated: ${Date.now()}\ndefaultModel: gemini-2.5-pro\n`,
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

export async function launchChatApp(project: ChatProject): Promise<{ app: ElectronApplication; page: Page }> {
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

export async function getServerPort(page: Page): Promise<number> {
  return page.evaluate(() => window.electronAPI.getServerPort());
}

export async function createSessionViaApi(page: Page, projectId: string, agentId: string): Promise<string> {
  const port = await getServerPort(page);
  const res = await fetch(`http://localhost:${port}/api/projects/${projectId}/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: "POST",
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`createSession ${res.status}: ${JSON.stringify(body)}`);
  const { sessionId } = body as { sessionId: string };
  return sessionId;
}

export async function navigateToSession(page: Page, projectId: string, sessionId: string): Promise<void> {
  const projectUrl = `/project/${projectId}/chat/${sessionId}`;
  await page.goto(`file://${rendererEntry}?e2e=${navToken}#${projectUrl}`);
}

export function assistantTextMessage(text: string): MockEvent[] {
  return [
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: { role: "user", content: [{ type: "text", text: "test message" }] } },
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "test message" }] } },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", message: { role: "assistant", content: [{ type: "text", text }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } },
    { type: "turn_end", message: { role: "assistant", content: [{ type: "text", text }] }, toolResults: [] },
    { type: "agent_end", messages: [] },
  ];
}

export function assistantFailedMessage(errorMessage: string): MockEvent[] {
  return [
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: { role: "user", content: [{ type: "text", text: "test message" }] } },
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "test message" }] } },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage } },
    { type: "turn_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage }, toolResults: [] },
    { type: "agent_end", messages: [] },
  ];
}

export async function mockChatWebSocket(page: Page, port: number, events: MockEvent[]): Promise<void> {
  await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
    ws.onMessage((message) => {
      const parsed = JSON.parse(message as string);
      if (parsed.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      } else if (parsed.type === "message") {
        for (const event of events) {
          ws.send(JSON.stringify(event));
        }
      } else if (parsed.type === "abort") {
        ws.send(JSON.stringify({ type: "agent_end", messages: [] }));
      }
    });
  });
}

export async function mockStreamingWithoutEnd(page: Page, port: number, eventsBeforeEnd: MockEvent[]): Promise<{ complete: () => void }> {
  let resolveComplete: () => void;
  const completePromise = new Promise<void>((resolve) => { resolveComplete = resolve; });

  await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
    ws.onMessage((message) => {
      const parsed = JSON.parse(message as string);
      if (parsed.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      } else if (parsed.type === "message") {
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

export function createStreamingSequence(): MockEvent[] {
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
