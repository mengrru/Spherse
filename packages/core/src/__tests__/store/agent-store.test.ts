import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { createSilentLogger } from "../../logger.js";
import { AgentStore } from "../../store/agent-store.js";
import { createTempProject, cleanupDir, ensureDir, writeFile } from "../helpers.js";

const VALID_PROFILE = `---
name: World Builder
model: gemini-2.5-pro
tools:
  - read_file
---

You are a world building assistant.`;

describe("AgentStore", () => {
  let tmpRoot: string;
  let agentDir: string;
  let store: AgentStore;
  const agentId = "test-agent-id";

  beforeEach(async () => {
    tmpRoot = await createTempProject();
    agentDir = path.join(tmpRoot, "agents", "test-agent-a1b2c3");
    await ensureDir(tmpRoot, "agents/test-agent-a1b2c3");
    await writeFile(agentDir, "profile.md", VALID_PROFILE);
    store = new AgentStore(agentDir, agentId, createSilentLogger());
    await store.open();
  });

  afterEach(async () => {
    store.close();
    await cleanupDir(tmpRoot);
  });

  it("opens and exposes profile", () => {
    const profile = store.getProfile();
    expect(profile.name).toBe("World Builder");
    expect(profile.id).toBeDefined();
  });

  it("returns agent dir", () => {
    expect(store.getAgentDir()).toBe(agentDir);
  });

  it("profile getter provides AgentProfileStore", async () => {
    const raw = await store.profile.getRawContent();
    expect(raw).toContain("World Builder");
  });

  it("sessions getter provides SessionStore", () => {
    const id = store.sessions.createSession("Test");
    expect(store.sessions.getSession(id)).not.toBeNull();
  });

  it("triggers getter provides TriggerStore", () => {
    store.triggers.create({
      id: "trig-1",
      enabled: true,
      type: "time",
      cron: "0 9 * * *",
      mode: "new_session",
      message: "hello",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(store.triggers.list()).toHaveLength(1);
  });

  it("skills getter provides a SkillStore scoped to the agent dir", async () => {
    await writeFile(agentDir, "skills/my-agent-skill/SKILL.md", "---\nname: my-agent-skill\ndescription: Agent-local\n---\n\nLocal instructions.");
    const skills = await store.skills.list();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-agent-skill");
  });

  it("skills getter returns empty list when no agent skills dir exists", async () => {
    const skills = await store.skills.list();
    expect(skills).toEqual([]);
  });

  it("close closes session db", () => {
    store.sessions.createSession();
    expect(() => store.close()).not.toThrow();
  });

  it("refreshes cached profile after saveProfile so getProfile returns updated tools", async () => {
    expect(store.getProfile().tools).toEqual(["read_file"]);

    const updatedProfile = `---
name: World Builder
model: gemini-2.5-pro
tools:
  - read_file
  - generate_image
---

You are a world building assistant.`;

    await store.saveProfile(updatedProfile);
    expect(store.getProfile().tools).toEqual(["read_file", "generate_image"]);
  });
});
