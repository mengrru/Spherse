import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ChatProject } from "./chat";

export interface FixtureEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}

export interface HistoryFixture {
  sessionId: string;
  events: FixtureEvent[];
}

const AGENT_ID = "assistant-1";
const AGENT_DIR = "assistant";

function textContent(text: string) {
  return [{ type: "text", text }];
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return { type: "toolCall", id, name, arguments: args };
}

export function buildHistoryFixture(sessionId: string): HistoryFixture {
  const events: FixtureEvent[] = [];
  let seq = 0;
  const base = Date.now() - 60_000;

  const emit = (type: string, data: Record<string, unknown>): number => {
    const current = seq;
    events.push({ type, seq: current, time: base + current * 1000, data });
    seq += 1;
    return current;
  };

  const startTurn = () => emit("turn/start", {});
  const endTurn = (reason: "completed" | "error") => emit("turn/end", { reason });

  const user = (text: string, messageExtra: Record<string, unknown> = {}) =>
    emit("user/message", {
      message: {
        role: "user",
        content: textContent(text),
        timestamp: base + seq * 1000,
        ...messageExtra,
      },
    });

  const assistant = (content: string | unknown[], extra: Record<string, unknown> = {}) =>
    emit("assistant/message", {
      message: {
        role: "assistant",
        content: typeof content === "string" ? textContent(content) : content,
        timestamp: base + seq * 1000,
        ...extra,
      },
    });

  const toolResult = (toolCallId: string, toolName: string, details: unknown, isError = false) =>
    emit("tool/result", {
      message: {
        role: "toolResult",
        toolCallId,
        toolName,
        content: textContent(isError ? "failed" : "ok"),
        details,
        isError,
        timestamp: base + seq * 1000,
      },
    });

  startTurn();
  user("普通用户消息", {
    _attachments: [{ type: "image", path: "uploads/pic.png", mimeType: "image/png" }],
  });
  assistant("第一条助手回复");
  endTurn("completed");

  startTurn();
  user("执行一组工具");
  assistant([toolCall("tc-command", "run_command", { command: "printf history-ok" })]);
  toolResult("tc-command", "run_command", {
    cardType: "command",
    command: "printf history-ok",
    stdout: "history-ok",
    stderr: "",
    exitCode: 0,
    status: "completed",
  });
  assistant([toolCall("tc-html", "render_card", { title: "历史卡片" })]);
  toolResult("tc-html", "render_card", {
    cardType: "html",
    html: "<h2>history card</h2>",
    title: "历史卡片",
    width: 320,
    height: 200,
  });
  assistant([toolCall("tc-question", "ask_user", { question: "继续执行吗？", options: ["继续执行", "停止"] })]);
  toolResult("tc-question", "ask_user", {
    cardType: "question",
    question: "继续执行吗？",
    options: ["继续执行", "停止"],
    answer: "继续执行",
  });
  assistant([toolCall("tc-image", "generate_image", { prompt: "一只猫" })]);
  toolResult("tc-image", "generate_image", {
    cardType: "image",
    status: "done",
    path: "uploads/cat.png",
    prompt: "一只猫",
    mimeType: "image/png",
  });
  assistant("工具总结文本");
  endTurn("completed");

  emit("compaction/applied", { anchorSeq: 0, digestContent: "digest", excludedSeqs: [] });

  startTurn();
  user("历史错误轮");
  assistant([], { stopReason: "error", errorMessage: "历史错误：请求过于频繁" });
  endTurn("error");

  startTurn();
  const retriedUserSeq = user("已被重试淘汰的问题");
  const retriedAssistantSeq = assistant("淘汰回复");
  endTurn("completed");
  emit("turn/retried", { abandonedSeqs: [retriedUserSeq, retriedAssistantSeq] });

  startTurn();
  user("重试后的问题");
  assistant("重试后的回复");
  endTurn("completed");

  startTurn();
  emit("user/message", {
    message: { role: "user", content: textContent("触发器消息"), timestamp: base + seq * 1000 },
    source: "triggered",
    triggerName: "每日汇总",
  });
  assistant("触发器回复");
  endTurn("completed");

  startTurn();
  const withdrawnUserSeq = user("被撤回的问题");
  assistant("撤回回复");
  endTurn("completed");
  emit("turn/withdrawn", { seq: withdrawnUserSeq });

  return { sessionId, events };
}

export function seedHistorySession(project: ChatProject, fixture: HistoryFixture): string {
  const agentDir = path.join(project.root, ".spherse", "agents", AGENT_DIR);
  mkdirSync(agentDir, { recursive: true });
  const db = new DatabaseSync(path.join(agentDir, "sessions.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      source TEXT DEFAULT 'manual'
    );
    CREATE TABLE IF NOT EXISTS events (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      time INTEGER NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (session_id, seq)
    );
  `);
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id, agent_id, title, created_at, updated_at, status, source) VALUES (?, ?, ?, ?, ?, 'active', 'manual')",
  ).run(fixture.sessionId, AGENT_ID, "History Fixture", now, now);
  const insert = db.prepare(
    "INSERT INTO events (session_id, seq, type, data, time, schema_version) VALUES (?, ?, ?, ?, ?, 1)",
  );
  for (const event of fixture.events) {
    insert.run(fixture.sessionId, event.seq, event.type, JSON.stringify(event.data), event.time);
  }
  db.close();
  return fixture.sessionId;
}

export function newHistoryFixture(): HistoryFixture {
  return buildHistoryFixture(randomUUID());
}
