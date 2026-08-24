import { describe, it, expect, beforeEach, afterEach } from "vitest";
import matter from "gray-matter";
import { createManageAgentTool, isManageAgentWriteAction } from "../../tools/manage-agent.js";
import { ProjectStore } from "../../store/project.js";
import { createSilentLogger } from "../../logger.js";
import { createTempProject, cleanupDir } from "../helpers.js";

const KNOWN_TOOLS = { names: ["read_file", "write_file", "manage_agent"] };

const EXISTING_PROFILE = `---
name: World Builder
alias: WB
model: gemini-2.5-pro
tools:
  - read_file
custom_field: keep-me
---

You are a world building assistant.`;

const PROFILE_WITH_TP_OFF = `---
name: Time Keeper
timePerception:
  enabled: false
  epochMs: 1704067200000
  startMs: 1704067200000
  flowRate: 60
  timeZone: Asia/Shanghai
---

You keep time.`;

const PROFILE_WITH_TP_ON = `---
name: Time Keeper
timePerception:
  enabled: true
  epochMs: 1704067200000
  startMs: 1704067200000
  flowRate: 60
---

You keep time.`;

describe("createManageAgentTool", () => {
  let projectRoot: string;
  let store: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    store = new ProjectStore(projectRoot, createSilentLogger());
    await store.create("TestProject");
  });

  afterEach(async () => {
    store.close();
    await cleanupDir(projectRoot);
  });

  function makeTool(currentAgentId?: string) {
    return createManageAgentTool(store, KNOWN_TOOLS, currentAgentId);
  }

  async function seedAgent() {
    const agentStore = await store.createAgent(undefined, EXISTING_PROFILE);
    return agentStore.getProfile();
  }

  async function seedProfileContent(content: string) {
    const agentStore = await store.createAgent(undefined, content);
    return agentStore.getProfile();
  }

  async function readFrontmatter(agentId: string): Promise<Record<string, unknown>> {
    const raw = await store.getAgent(agentId)!.profile.getRawContent();
    return matter(raw).data as Record<string, unknown>;
  }

  it("lists agents", async () => {
    const profile = await seedAgent();
    const result = await makeTool().execute("tc", { action: "list" }, undefined as any);
    expect(result.content[0].text).toContain(profile.id);
    expect(result.content[0].text).toContain("World Builder");
  });

  it("reports an empty project", async () => {
    const result = await makeTool().execute("tc", { action: "list" }, undefined as any);
    expect(result.content[0].text).toContain("No agents");
  });

  it("gets a single agent including its system prompt", async () => {
    const profile = await seedAgent();
    const result = await makeTool().execute(
      "tc",
      { action: "get", agent_id: profile.id },
      undefined as any,
    );
    expect(result.content[0].text).toContain("world building assistant");
    expect(result.details).toMatchObject({ agentId: profile.id });
  });

  it("falls back to the current agent id for get", async () => {
    const profile = await seedAgent();
    const result = await makeTool(profile.id).execute("tc", { action: "get" }, undefined as any);
    expect(result.details).toMatchObject({ agentId: profile.id });
  });

  it("creates an agent with a generated id and slug", async () => {
    const result = await makeTool().execute(
      "tc",
      {
        action: "create",
        name: "Chapter Reviewer",
        system_prompt: "Review chapters.",
        alias: "CR",
        tools: ["read_file", "read_file"],
        context: ["notes/outline.md"],
      },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    const agentId = result.details.agentId!;
    const profile = store.getAgent(agentId)!.getProfile();
    expect(profile.name).toBe("Chapter Reviewer");
    expect(profile.alias).toBe("CR");
    expect(profile.tools).toEqual(["read_file"]);
    expect(profile.context).toEqual(["notes/outline.md"]);
    expect(profile.systemPrompt).toBe("Review chapters.");
    expect(profile.slug).toMatch(/^chapter-reviewer-[0-9a-f]{6}$/);
  });

  it("ignores an LLM-supplied id and derives the slug from the name", async () => {
    const result = await makeTool().execute(
      "tc",
      { action: "create", name: "世界观 助手", system_prompt: "帮忙设定世界观。" },
      undefined as any,
    );
    const profile = store.getAgent(result.details.agentId!)!.getProfile();
    expect(profile.id).not.toBe("世界观 助手");
    expect(profile.slug.startsWith("世界观-助手-")).toBe(true);
  });

  it("rejects create without name or system prompt", async () => {
    const noName = await makeTool().execute(
      "tc",
      { action: "create", system_prompt: "x" },
      undefined as any,
    );
    expect(noName.details.error).toBe(true);
    const noPrompt = await makeTool().execute(
      "tc",
      { action: "create", name: "X" },
      undefined as any,
    );
    expect(noPrompt.details.error).toBe(true);
  });

  it("rejects unknown tool names", async () => {
    const result = await makeTool().execute(
      "tc",
      { action: "create", name: "X", system_prompt: "y", tools: ["nope"] },
      undefined as any,
    );
    expect(result.details.error).toBe(true);
    expect(result.content[0].text).toContain("unknown tool name");
  });

  it("patches only the supplied fields on update and keeps id/slug/extra frontmatter", async () => {
    const profile = await seedAgent();
    const result = await makeTool().execute(
      "tc",
      { action: "update", agent_id: profile.id, name: "Renamed", tools: ["write_file"] },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    const updated = store.getAgent(profile.id)!.getProfile();
    expect(updated.id).toBe(profile.id);
    expect(updated.slug).toBe(profile.slug);
    expect(updated.name).toBe("Renamed");
    expect(updated.alias).toBe("WB");
    expect(updated.model).toBe("gemini-2.5-pro");
    expect(updated.tools).toEqual(["write_file"]);
    expect(updated.systemPrompt).toBe("You are a world building assistant.");
    const raw = await store.getAgent(profile.id)!.profile.getRawContent();
    expect(matter(raw).data.custom_field).toBe("keep-me");
  });

  it("clears optional fields when given an empty string", async () => {
    const profile = await seedAgent();
    await makeTool().execute(
      "tc",
      { action: "update", agent_id: profile.id, alias: "", model: "" },
      undefined as any,
    );
    const updated = store.getAgent(profile.id)!.getProfile();
    expect(updated.alias).toBeUndefined();
    expect(updated.model).toBeUndefined();
  });

  it("reports a missing agent id", async () => {
    const result = await makeTool().execute(
      "tc",
      { action: "update", agent_id: "nope", name: "x" },
      undefined as any,
    );
    expect(result.details.error).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("emits agent_updated for create and update", async () => {
    const seen: string[] = [];
    store.on("agent_updated", (payload) => seen.push(payload.action));
    const created = await makeTool().execute(
      "tc",
      { action: "create", name: "Ev", system_prompt: "p" },
      undefined as any,
    );
    await makeTool().execute(
      "tc",
      { action: "update", agent_id: created.details.agentId, name: "Ev2" },
      undefined as any,
    );
    expect(seen).toEqual(["created", "updated"]);
  });

  it("materializes a full timePerception config when create enables it", async () => {
    const before = Date.now();
    const result = await makeTool().execute(
      "tc",
      { action: "create", name: "TP", system_prompt: "p", time_perception: { enabled: true } },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    const tp = (await readFrontmatter(result.details.agentId!)).timePerception as Record<string, unknown>;
    expect(tp.enabled).toBe(true);
    expect(tp.flowRate).toBe(1);
    expect(tp.epochMs).toBeGreaterThanOrEqual(before);
    expect(tp.startMs).toBe(tp.epochMs);
    expect(tp.timeZone).toBeUndefined();
  });

  it("omits timePerception when create disables it", async () => {
    const result = await makeTool().execute(
      "tc",
      { action: "create", name: "TP", system_prompt: "p", time_perception: { enabled: false } },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    expect((await readFrontmatter(result.details.agentId!)).timePerception).toBeUndefined();
  });

  it("enables timePerception without existing config by materializing defaults", async () => {
    const before = Date.now();
    const profile = await seedAgent();
    const result = await makeTool().execute(
      "tc",
      { action: "update", agent_id: profile.id, time_perception: { enabled: true } },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    const tp = (await readFrontmatter(profile.id)).timePerception as Record<string, unknown>;
    expect(tp.enabled).toBe(true);
    expect(tp.flowRate).toBe(1);
    expect(tp.epochMs).toBeGreaterThanOrEqual(before);
    expect(tp.startMs).toBe(tp.epochMs);
  });

  it("enables timePerception while keeping existing anchor, start, flowRate and timeZone", async () => {
    const profile = await seedProfileContent(PROFILE_WITH_TP_OFF);
    const result = await makeTool().execute(
      "tc",
      { action: "update", agent_id: profile.id, time_perception: { enabled: true } },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    expect(await readFrontmatter(profile.id)).toMatchObject({
      timePerception: {
        enabled: true,
        epochMs: 1704067200000,
        startMs: 1704067200000,
        flowRate: 60,
        timeZone: "Asia/Shanghai",
      },
    });
  });

  it("removes timePerception from frontmatter when disabled on update", async () => {
    const profile = await seedProfileContent(PROFILE_WITH_TP_ON);
    const result = await makeTool().execute(
      "tc",
      { action: "update", agent_id: profile.id, time_perception: { enabled: false } },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    expect((await readFrontmatter(profile.id)).timePerception).toBeUndefined();
  });

  it("surfaces timePerception state in list and get output", async () => {
    await seedProfileContent(PROFILE_WITH_TP_OFF);
    const listed = await makeTool().execute("tc", { action: "list" }, undefined as any);
    expect(listed.content[0].text).toContain("timePerception");
    expect(listed.content[0].text).toContain("2024-01-01T00:00:00.000Z");
    expect(listed.content[0].text).toContain("Asia/Shanghai");
  });

  it("keeps timePerception untouched on update when the param is omitted", async () => {
    const profile = await seedProfileContent(PROFILE_WITH_TP_ON);
    await makeTool().execute(
      "tc",
      { action: "update", agent_id: profile.id, name: "Renamed" },
      undefined as any,
    );
    expect(await readFrontmatter(profile.id)).toMatchObject({
      name: "Renamed",
      timePerception: { enabled: true, flowRate: 60 },
    });
  });
});

describe("isManageAgentWriteAction", () => {
  it("only treats create/update as write actions", () => {
    expect(isManageAgentWriteAction({ action: "create" })).toBe(true);
    expect(isManageAgentWriteAction({ action: "update" })).toBe(true);
    expect(isManageAgentWriteAction({ action: "list" })).toBe(false);
    expect(isManageAgentWriteAction({ action: "get" })).toBe(false);
    expect(isManageAgentWriteAction(null)).toBe(false);
  });
});
