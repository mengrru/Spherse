import { _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "../..");
const mainEntry = path.join(appRoot, "dist", "main", "index.js");
const rendererEntry = path.join(appRoot, "dist", "renderer", "index.html");

export type StubTurn =
  | { kind: "text"; parts: string[]; partDelayMs?: number }
  | { kind: "tool"; name: string; argsJson: string };

export interface StubLlm {
  port: number;
  requests: Array<{ body: unknown }>;
  enqueue(turn: StubTurn): void;
  close(): Promise<void>;
}

export async function startStubLlm(): Promise<StubLlm> {
  const requests: Array<{ body: unknown }> = [];
  const queue: StubTurn[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      requests.push({ body: JSON.parse(raw || "{}") });
      const turn = queue.shift() ?? { kind: "text", parts: ["stub fallback"] } as StubTurn;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const send = (payload: unknown) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      if (turn.kind === "text") {
        send({ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] });
        let index = 0;
        const emit = () => {
          if (index < turn.parts.length) {
            send({ choices: [{ index: 0, delta: { content: turn.parts[index] } }] });
            index += 1;
            setTimeout(emit, turn.partDelayMs ?? 120);
          } else {
            send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
            res.write("data: [DONE]\n\n");
            res.end();
          }
        };
        emit();
        return;
      }
      send({
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call_${requests.length}`,
                  type: "function",
                  function: { name: turn.name, arguments: turn.argsJson },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    requests,
    enqueue: (turn) => queue.push(turn),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export async function createRpcProject(): Promise<{ root: string; projectId: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "spherse-e2e-rpc-"));
  const projectId = Math.random().toString(36).slice(2, 10);
  await mkdir(path.join(root, ".spherse", "agents", "assistant"), { recursive: true });
  await writeFile(
    path.join(root, ".spherse", "project.yaml"),
    `id: ${projectId}\nname: RpcE2E\ncreated: ${Date.now()}\n`,
  );
  await writeFile(path.join(root, "AGENTS.md"), "# RpcE2E\n");
  await writeFile(
    path.join(root, ".spherse", "agents", "assistant", "profile.md"),
    [
      "---",
      "id: assistant-1",
      "name: Assistant",
      "type: assistant",
      "tools:",
      "  - read_file",
      "  - run_command",
      "---",
      "You help with everything.",
      "",
    ].join("\n"),
  );
  return { root, projectId };
}

export interface RpcFrameLog {
  sent: string[];
  received: string[];
}

export async function launchRpcApp(
  project: { root: string; projectId: string },
  stub: StubLlm,
): Promise<{ app: ElectronApplication; page: Page; frames: RpcFrameLog; restRequests: string[] }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "spherse-e2e-rpc-user-"));
  await writeFile(
    path.join(userDataDir, "model-settings.json"),
    JSON.stringify({
      text: { defaultModel: "stub/stub-1", providers: { stub: { apiKey: "sk-stub" } } },
      image: { defaultModel: "", providers: {} },
      customProviders: [
        {
          id: "stub",
          name: "Stub",
          baseUrl: `http://127.0.0.1:${stub.port}/v1`,
          models: ["stub-1"],
          keyless: false,
          contextWindow: 100000,
          maxTokens: 4096,
        },
      ],
    }),
  );

  const app = await _electron.launch({
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
  await page.evaluate(() => localStorage.setItem("spherse:rpc-client", "1"));
  await page.evaluate(
    async ({ id, projectRoot }) => {
      await window.electronAPI.openProject(projectRoot);
      await window.electronAPI.addOpenProject(id, projectRoot);
      await window.electronAPI.setLastActiveProject(id);
    },
    { id: project.projectId, projectRoot: project.root },
  );

  const frames: RpcFrameLog = { sent: [], received: [] };
  const restRequests: string[] = [];
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/ws/rpc")) return;
    ws.on("framesent", (frame) => frames.sent.push(String(frame.payload)));
    ws.on("framereceived", (frame) => frames.received.push(String(frame.payload)));
  });
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/") && !url.includes("/preview/") && !url.includes("/download/")) {
      restRequests.push(url);
    }
  });

  return { app, page, frames, restRequests };
}

export async function openRpcSession(
  page: Page,
  projectId: string,
  agentId: string,
): Promise<string> {
  const port = await page.evaluate(() => window.electronAPI.getServerPort());
  const state = await page.evaluate(() => window.electronAPI.getMobileAccessState());
  const token = state.token;
  const res = await fetch(
    `http://localhost:${port}/api/projects/${projectId}/agents/${encodeURIComponent(agentId)}/sessions`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await res.json()) as { sessionId: string };
  await page.goto(
    `file://${rendererEntry}?e2e=${Date.now()}#/project/${projectId}/chat/${body.sessionId}`,
  );
  await page.waitForSelector("[data-chat-composer]");
  return body.sessionId;
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  const textarea = page.locator("[data-chat-composer] textarea");
  await textarea.fill(text);
  await textarea.press("Enter");
}
