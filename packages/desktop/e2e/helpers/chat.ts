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
  await openProjectInApp(page, project);
  return { app, page };
}

export async function getServerPort(page: Page): Promise<number> {
  return page.evaluate(() => window.electronAPI.getServerPort());
}

export async function getServerAccessToken(page: Page): Promise<string | null> {
  const state = await page.evaluate(() => window.electronAPI.getMobileAccessState());
  return state.token ?? null;
}

export async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await getServerAccessToken(page);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createSessionViaApi(page: Page, projectId: string, agentId: string): Promise<string> {
  const port = await getServerPort(page);
  const res = await fetch(`http://localhost:${port}/api/projects/${projectId}/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: "POST",
    headers: await authHeaders(page),
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

export async function navigateToProjectRoot(page: Page, projectId: string): Promise<void> {
  await page.goto(`file://${rendererEntry}?e2e=${Date.now()}#/project/${projectId}`);
}

export async function openProjectInApp(page: Page, project: ChatProject): Promise<void> {
  await page.evaluate(async ({ id, projectRoot }) => {
    await window.electronAPI.openProject(projectRoot);
    await window.electronAPI.addOpenProject(id, projectRoot);
    await window.electronAPI.setLastActiveProject(id);
  }, { id: project.projectId, projectRoot: project.root });
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
  await mockChatServer(page, port, (parsed, send, tools) => {
    if (parsed.type === "message") {
      tools.runTurn(String(parsed.content), parsed.intentId as string | undefined, events);
    } else if (parsed.type === "abort") {
      send({ type: "agent_end", messages: [] });
      send({ type: "run_status", active: false });
    }
  });
}

export async function mockStreamingWithoutEnd(page: Page, port: number, eventsBeforeEnd: MockEvent[]): Promise<{ complete: () => void }> {
  let finish: (() => void) | undefined;

  await mockChatServer(page, port, (parsed, _send, tools) => {
    if (parsed.type === "message") {
      finish = tools.runTurn(String(parsed.content), parsed.intentId as string | undefined, eventsBeforeEnd, { holdEnd: true });
    } else if (parsed.type === "abort") {
      tools.endRun();
    }
  });

  return {
    complete: () => {
      finish?.();
    },
  };
}

export interface MockChatTools {
  runTurn: (userContent: string, intentId: string | undefined, events: MockEvent[], opts?: { holdEnd?: boolean }) => () => void;
  runEvents: (events: MockEvent[], opts?: { holdEnd?: boolean }) => () => void;
  endRun: () => void;
  turnRetried: () => void;
  nextSeq: () => number;
}

export async function mockChatServer(
  page: Page,
  port: number,
  handle: (parsed: Record<string, unknown>, send: (event: MockEvent) => void, tools: MockChatTools) => void,
): Promise<void> {
  await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
    let seq = -1;
    let lastAssistantSeq: number | null = null;
    const nextSeq = () => {
      seq += 1;
      return seq;
    };
    const send = (event: MockEvent) => {
      try {
        ws.send(JSON.stringify(event));
      } catch {
        // socket may already be closed between turns
      }
    };

    const endRun = () => {
      send({ type: "run_status", active: false });
    };

    const runEvents = (events: MockEvent[], opts?: { holdEnd?: boolean }) => {
      send({ type: "run_status", active: true });
      for (const event of events) {
        if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
          const message = event.message as { role?: string } | undefined;
          if (message?.role !== "assistant") continue;
        }
        if (event.type === "message_end") {
          const settleSeq = nextSeq();
          lastAssistantSeq = settleSeq;
          send({ ...event, seq: settleSeq });
          send({ type: "message_settled", seq: settleSeq, message: event.message });
          continue;
        }
        send(event);
      }
      if (!opts?.holdEnd) {
        endRun();
        return () => undefined;
      }
      return () => {
        send({ type: "agent_end", messages: [] });
        endRun();
      };
    };

    const runTurn = (userContent: string, intentId: string | undefined, events: MockEvent[], opts?: { holdEnd?: boolean }) => {
      send({
        type: "message_settled",
        seq: nextSeq(),
        message: { role: "user", content: userContent, timestamp: Date.now() },
        ...(intentId !== undefined ? { intentId } : {}),
      });
      return runEvents(events, opts);
    };

    const turnRetried = () => {
      send({
        type: "turn_retried",
        seq: nextSeq(),
        abandonedSeqs: lastAssistantSeq !== null ? [lastAssistantSeq] : [],
      });
      lastAssistantSeq = null;
    };

    send({ type: "run_status", active: false });

    ws.onMessage((message) => {
      const parsed = JSON.parse(message as string) as Record<string, unknown>;
      if (parsed.type === "ping") {
        send({ type: "pong" });
        return;
      }
      handle(parsed, send, { runTurn, runEvents, endRun, turnRetried, nextSeq });
    });
  });
}

export async function mockMultiClientBroadcastChat(page: Page, port: number): Promise<void> {
  const sockets: Array<{ send: (data: string) => void }> = [];
  let broadcastSeq = 0;

  await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
    sockets.push({ send: (data) => ws.send(data) });
    ws.send(JSON.stringify({ type: "run_status", active: false }));
    ws.onMessage((message) => {
      const parsed = JSON.parse(message as string) as Record<string, unknown>;
      if (parsed.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (parsed.type === "message") {
        broadcastSeq += 1;
        const frame = JSON.stringify({
          type: "message_settled",
          seq: broadcastSeq - 1,
          message: { role: "user", content: String(parsed.content), timestamp: Date.now() },
          ...(parsed.intentId !== undefined ? { intentId: parsed.intentId } : {}),
        });
        for (const socket of sockets) {
          socket.send(frame);
        }
      }
    });
  });
}

export async function sendAsSecondClient(page: Page, port: number, text: string): Promise<void> {
  await page.evaluate(({ port: wsPort, text: clientText }) => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws/projects/e2e/chat/assistant-1/second-client`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "message", content: clientText }));
    };
    return new Promise<void>((resolve) => {
      ws.onmessage = () => {
        setTimeout(() => {
          ws.close();
          resolve();
        }, 100);
      };
    });
  }, { port, text });
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
