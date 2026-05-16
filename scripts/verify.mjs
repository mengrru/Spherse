import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ProjectStore } from "../packages/core/dist/project-store.js";
import { parseAgentFile, listAgents } from "../packages/core/dist/agent-parser.js";
import { SessionStore } from "../packages/core/dist/session-store.js";
import { createReadFileTool, createWriteFileTool, createListFilesTool, createSearchContentTool, createAppendChangelogTool, createToolsForProject, getDefaultToolsForAgentType } from "../packages/core/dist/tools/index.js";

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

let tmpDir;

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wb-verify-"));
  console.log(`\n📁 Test directory: ${tmpDir}\n`);
}

async function cleanup() {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

// ── Project Store ──────────────────────────────────────────

async function testProjectStore() {
  console.log("== Project Store ==");

  const store = new ProjectStore(tmpDir);
  const config = await store.create("测试世界", "gemini-2.5-pro");

  assert(config.name === "测试世界", "create: name is correct");
  assert(config.defaultModel === "gemini-2.5-pro", "create: model is correct");
  assert(config.paths.agents === "agents", "create: default paths set");

  const spherseDir = path.join(tmpDir, ".spherse");
  const spherseStat = await fs.stat(spherseDir);
  assert(spherseStat.isDirectory(), "create: .spherse/ directory exists");

  const agentsStat = await fs.stat(path.join(spherseDir, "agents"));
  assert(agentsStat.isDirectory(), "create: .spherse/agents/ directory exists");

  const agentsMd = await fs.readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
  assert(agentsMd.length > 0, "create: AGENTS.md created");

  // Open
  const store2 = new ProjectStore(tmpDir);
  const opened = await store2.open();
  assert(opened.name === "测试世界", "open: config loaded correctly");
  assert(opened.defaultModel === "gemini-2.5-pro", "open: model preserved");

  // Read/Update index
  const index = await store2.readIndex();
  assert(index.length > 0, "readIndex: returns content");
  const newContent = "# Updated Index";
  await store2.updateIndex(newContent);
  const reloaded = await store2.readIndex();
  assert(reloaded === newContent, "updateIndex: content updated");

  // Append changelog
  await store2.appendChangelog({ agent: "test", action: "write", target: "foo.md", description: "test entry" });
  const changelog = await fs.readFile(path.join(tmpDir, "CHANGELOG.md"), "utf-8");
  assert(changelog.includes("test"), "appendChangelog: entry appended");
  assert(changelog.includes("foo.md"), "appendChangelog: target included");

  console.log("");
}

// ── Agent Parser ───────────────────────────────────────────

async function testAgentParser() {
  console.log("== Agent Parser ==");

  const agentsDir = path.join(tmpDir, ".spherse", "agents");

  // Create test agent files
  await fs.writeFile(path.join(agentsDir, "creator.md"), `---
name: 世界创作者
model: gemini-2.5-pro
type: creator
tools:
  - read_file
  - write_file
context:
  - world/
---

你是一个创作助手。
`, "utf-8");

  await fs.writeFile(path.join(agentsDir, "alice.md"), `---
name: 爱丽丝
type: roleplay
---

你是爱丽丝。
`, "utf-8");

  // Parse single file
  const parsed = await parseAgentFile(path.join(agentsDir, "creator.md"));
  assert(parsed.name === "世界创作者", "parseAgentFile: name parsed");
  assert(parsed.model === "gemini-2.5-pro", "parseAgentFile: model parsed");
  assert(parsed.type === "creator", "parseAgentFile: type parsed");
  assert(parsed.tools?.length === 2, "parseAgentFile: tools parsed");
  assert(parsed.systemPrompt.includes("创作助手"), "parseAgentFile: systemPrompt extracted");

  // List agents
  const agents = await listAgents(agentsDir);
  assert(agents.length === 2, `listAgents: found 2 agents (got ${agents.length})`);
  const names = agents.map(a => a.name);
  assert(names.includes("爱丽丝"), "listAgents: 爱丽丝 found");
  assert(names.includes("世界创作者"), "listAgents: 世界创作者 found");

  // Minimal agent
  const alice = agents.find(a => a.name === "爱丽丝");
  assert(alice?.type === "roleplay", "minimal agent: type correct");
  assert(alice?.model === undefined, "minimal agent: no model (undefined)");
  assert(alice?.tools === undefined, "minimal agent: no tools (undefined)");

  console.log("");
}

// ── Session Store ──────────────────────────────────────────

async function testSessionStore() {
  console.log("== Session Store ==");

  const store = new SessionStore();
  const dbPath = path.join(tmpDir, "test-sessions.db");
  await store.init(dbPath);

  // Create session
  const id = store.createSession("creator", "测试会话");
  assert(typeof id === "string" && id.length === 36, `createSession: returns UUID (${id})`);

  // Get session
  const session = store.getSession(id);
  assert(session?.agentName === "creator", "getSession: agentName correct");
  assert(session?.title === "测试会话", "getSession: title correct");
  assert(session?.status === "active", "getSession: status active");

  // List sessions
  store.createSession("creator", "会话2");
  store.createSession("roleplay", "会话3");
  const all = store.listSessions();
  assert(all.length === 3, `listSessions: 3 total (got ${all.length})`);
  const creatorOnly = store.listSessions("creator");
  assert(creatorOnly.length === 2, `listSessions: 2 creator (got ${creatorOnly.length})`);

  // Append and read messages
  store.appendMessage(id, { role: "user", content: "你好", timestamp: Date.now() });
  store.appendMessage(id, { role: "assistant", content: "你好！", timestamp: Date.now() });
  const msgs = store.getSessionMessages(id);
  assert(msgs.length === 2, `getSessionMessages: 2 messages (got ${msgs.length})`);
  assert(msgs[0].role === "user", "getSessionMessages: first is user");
  assert(msgs[1].role === "assistant", "getSessionMessages: second is assistant");

  // Update title
  store.updateSessionTitle(id, "新标题");
  const updated = store.getSession(id);
  assert(updated?.title === "新标题", "updateSessionTitle: title updated");

  store.close();
  console.log("");
}

// ── Agent Tools ────────────────────────────────────────────

async function testTools() {
  console.log("== Agent Tools ==");

  const toolsDir = path.join(tmpDir, "tool-test");
  await fs.mkdir(toolsDir, { recursive: true });
  await fs.writeFile(path.join(toolsDir, "hello.md"), "# Hello World", "utf-8");
  await fs.mkdir(path.join(toolsDir, "sub"), { recursive: true });
  await fs.writeFile(path.join(toolsDir, "sub", "nested.md"), "nested content here", "utf-8");
  await fs.writeFile(path.join(toolsDir, "CHANGELOG.md"), "", "utf-8");

  // read_file
  const readTool = createReadFileTool(toolsDir);
  const readResult = await readTool.execute("t1", { path: "hello.md" });
  assert(readResult.content[0].text.includes("Hello World"), "read_file: reads content correctly");

  const readNotFound = await readTool.execute("t2", { path: "nonexistent.md" });
  assert(readNotFound.content[0].text.includes("not found"), "read_file: handles missing file");

  // write_file
  const writeTool = createWriteFileTool(toolsDir);
  await writeTool.execute("t3", { path: "new.md", content: "New content" });
  const written = await fs.readFile(path.join(toolsDir, "new.md"), "utf-8");
  assert(written === "New content", "write_file: writes content");

  await writeTool.execute("t4", { path: "deep/dir/file.md", content: "deep", createDirs: true });
  const deep = await fs.readFile(path.join(toolsDir, "deep/dir/file.md"), "utf-8");
  assert(deep === "deep", "write_file: creates intermediate dirs");

  // list_files
  const listTool = createListFilesTool(toolsDir);
  const listResult = await listTool.execute("t5", { path: "." });
  assert(listResult.content[0].text.includes("hello.md"), "list_files: shows files");
  assert(listResult.content[0].text.includes("sub"), "list_files: shows directories");

  const recursiveResult = await listTool.execute("t6", { path: ".", recursive: true });
  assert(recursiveResult.content[0].text.includes("nested.md"), "list_files: recursive shows nested files");

  // search_content
  const searchTool = createSearchContentTool(toolsDir);
  const searchResult = await searchTool.execute("t7", { query: "Hello" });
  assert(searchResult.content[0].text.includes("hello.md"), "search_content: finds matches");

  const noResult = await searchTool.execute("t8", { query: "zzzznotfound" });
  assert(noResult.content[0].text.includes("No matches"), "search_content: reports no results");

  // append_changelog
  const changelogTool = createAppendChangelogTool(toolsDir);
  await changelogTool.execute("t9", { agent: "bot", action: "write", target: "new.md", description: "测试日志" });
  const log = await fs.readFile(path.join(toolsDir, "CHANGELOG.md"), "utf-8");
  assert(log.includes("bot"), "append_changelog: agent recorded");
  assert(log.includes("测试日志"), "append_changelog: description recorded");

  // Tool registry
  const allTools = createToolsForProject(toolsDir);
  assert(Object.keys(allTools).length === 5, `createToolsForProject: 5 tools created (got ${Object.keys(allTools).length})`);

  const creatorTools = getDefaultToolsForAgentType("creator");
  assert(creatorTools.length === 5, "getDefaultToolsForAgentType: creator has 5 tools");

  const roleplayTools = getDefaultToolsForAgentType("roleplay");
  assert(roleplayTools.length === 3, "getDefaultToolsForAgentType: roleplay has 3 tools");
  assert(!roleplayTools.includes("write_file"), "getDefaultToolsForAgentType: roleplay cannot write");

  console.log("");
}

// ── Run ────────────────────────────────────────────────────

async function main() {
  console.log("🧪 Spherse — Verification Script\n");

  await setup();

  try {
    await testProjectStore();
    await testAgentParser();
    await testSessionStore();
    await testTools();
  } catch (err) {
    console.error("\n💥 Unexpected error:", err);
    failed++;
  }

  await cleanup();

  console.log("─────────────────────");
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
