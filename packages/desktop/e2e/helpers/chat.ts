import { _electron as electron, type ElectronApplication, type Page, type WebSocketRoute } from "@playwright/test";
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

export interface V2ChatServer {
  readonly receivedMessages: number;
  sinceValues: number[];
  closeActiveSocket(): void;
  streamAssistant(text: string): void;
  finishAssistant(text: string): void;
  completeMessageWhileDisconnected(text: string): void;
  completeWhileDisconnected(text: string): void;
}

export async function mockV2ChatServer(page: Page, port: number): Promise<V2ChatServer> {
  const log: MockEvent[] = [];
  const runEvents: MockEvent[] = [];
  const sockets: WebSocketRoute[] = [];
  const sinceValues: number[] = [];
  let receivedMessages = 0;
  let lastSeq = -1;
  let messageCounter = 0;
  let currentMessageId: string | undefined;
  let running = false;

  const broadcast = (event: MockEvent): void => {
    for (const socket of sockets) socket.send(JSON.stringify(event));
  };

  const persist = (event: MockEvent): MockEvent => {
    log.push(event);
    return event;
  };

  const persistAssistant = (text: string): number => {
    const seq = ++lastSeq;
    persist({
      type: "assistant/message",
      seq,
      time: seq,
      data: { message: { role: "assistant", content: [{ type: "text", text }], timestamp: seq } },
    });
    return seq;
  };

  const persistTurnEnd = (): void => {
    const seq = ++lastSeq;
    persist({ type: "turn/end", seq, time: seq, data: { reason: "completed" } });
  };

  await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
    sockets.push(ws);
    const sinceParam = new URL(ws.url()).searchParams.get("since");
    const since = sinceParam === null ? undefined : Number(sinceParam);
    if (since !== undefined) sinceValues.push(since);

    ws.send(JSON.stringify({ type: "session_ready", lastSeq, replay: true }));
    if (since !== undefined) {
      const replay = log.filter((event) => (event.seq as number) > since);
      if (replay.length > 0) ws.send(JSON.stringify({ type: "replay_events", events: replay }));
      ws.send(JSON.stringify({ type: "replay_done" }));
    }
    for (const event of runEvents) ws.send(JSON.stringify(event));
    ws.send(JSON.stringify({ type: "run_status", active: running }));

    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (message.type !== "message") return;
      receivedMessages += 1;
      messageCounter += 1;
      currentMessageId = `m${messageCounter}`;
      running = true;
      runEvents.length = 0;
      const seq = ++lastSeq;
      const userEvent: MockEvent = {
        type: "user/message",
        seq,
        time: seq,
        data: { message: { role: "user", content: message.content, timestamp: seq } },
      };
      persist(userEvent);
      broadcast({ type: "run_status", active: true });
      broadcast({
        type: "user_message",
        seq,
        message: userEvent.data?.message,
        ...(message.clientId ? { clientId: message.clientId } : {}),
      });
    });
  });

  const recordRunEvent = (event: MockEvent): void => {
    if (event.type === "message_update") {
      for (let index = runEvents.length - 1; index >= 0; index--) {
        if (runEvents[index].type === "message_update") {
          runEvents[index] = event;
          return;
        }
        if (runEvents[index].type === "message_start") break;
      }
    }
    runEvents.push(event);
  };

  return {
    sinceValues,

    get receivedMessages() {
      return receivedMessages;
    },

    closeActiveSocket() {
      const socket = sockets.pop();
      socket?.close();
    },

    streamAssistant(text) {
      const messageId = currentMessageId;
      if (messageId === undefined) return;
      const start: MockEvent = { type: "message_start", message: { role: "assistant", content: [] }, messageId };
      const update: MockEvent = {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text }] },
        messageId,
      };
      if (!runEvents.some((event) => event.type === "message_start")) {
        runEvents.push(start);
        broadcast(start);
      }
      recordRunEvent(update);
      broadcast(update);
    },

    finishAssistant(text) {
      const messageId = currentMessageId;
      const seq = persistAssistant(text);
      persistTurnEnd();
      if (messageId !== undefined) {
        broadcast({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text }], timestamp: lastSeq },
          messageId,
          seq,
        });
      }
      broadcast({ type: "agent_end", messages: [], seq: lastSeq });
      broadcast({ type: "run_status", active: false });
      running = false;
      currentMessageId = undefined;
      runEvents.length = 0;
    },

    completeMessageWhileDisconnected(text) {
      const messageId = currentMessageId;
      if (messageId === undefined) return;
      const seq = persistAssistant(text);
      runEvents.push({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text }], timestamp: seq },
        messageId,
        seq,
      });
      messageCounter += 1;
      currentMessageId = `m${messageCounter}`;
      runEvents.push({
        type: "message_start",
        message: { role: "assistant", content: [], timestamp: lastSeq },
        messageId: currentMessageId,
      });
    },

    completeWhileDisconnected(text) {
      persistAssistant(text);
      persistTurnEnd();
      running = false;
      currentMessageId = undefined;
      runEvents.length = 0;
    },
  };
}
