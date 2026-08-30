import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CONTEXT_TOTAL_SIZE_LIMIT_BYTES } from "@spherse/presets";
import { ProjectStore } from "../../store/project.js";
import { ValidationError } from "../../errors.js";
import { createSilentLogger } from "../../logger.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

function profileWith(context: string[]): string {
  const lines = context.map((c) => `  - ${c}`).join("\n");
  return `---
name: Refs Agent
${context.length > 0 ? `context:\n${lines}` : ""}
---

You keep references.`;
}

describe("ProjectStore context file policy gate", () => {
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

  it("creates an agent with valid text context files", async () => {
    await writeFile(projectRoot, "notes/a.md", "hello");
    const agentStore = await store.createAgent(undefined, profileWith(["notes/a.md"]));
    expect(agentStore.getProfile().context).toEqual(["notes/a.md"]);
  });

  it("rejects createAgent with non plain-text context files", async () => {
    await writeFile(projectRoot, "img/cover.png", "fakepng");
    await expect(store.createAgent(undefined, profileWith(["img/cover.png"]))).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects createAgent when total context size exceeds the limit", async () => {
    await writeFile(projectRoot, "big1.txt", "a".repeat(CONTEXT_TOTAL_SIZE_LIMIT_BYTES / 2 + 1));
    await writeFile(projectRoot, "big2.txt", "b".repeat(CONTEXT_TOTAL_SIZE_LIMIT_BYTES / 2 + 1));
    await expect(
      store.createAgent(undefined, profileWith(["big1.txt", "big2.txt"])),
    ).rejects.toThrow(/exceeds the 512\.0 kB limit/);
  });

  it("allows createAgent when context files are missing (counted as zero)", async () => {
    const agentStore = await store.createAgent(undefined, profileWith(["not-there.md"]));
    expect(agentStore.getProfile().context).toEqual(["not-there.md"]);
  });

  it("rejects updateAgent with non plain-text context files", async () => {
    await writeFile(projectRoot, "img/cover.png", "fakepng");
    const agentStore = await store.createAgent(undefined, profileWith([]));
    await expect(
      store.updateAgent(agentStore.getProfile().id, profileWith(["img/cover.png"])),
    ).rejects.toThrow(/plain-text/);
  });

  it("rejects updateAgent when total context size exceeds the limit", async () => {
    await writeFile(projectRoot, "big.txt", "a".repeat(CONTEXT_TOTAL_SIZE_LIMIT_BYTES + 1));
    const agentStore = await store.createAgent(undefined, profileWith([]));
    await expect(
      store.updateAgent(agentStore.getProfile().id, profileWith(["big.txt"])),
    ).rejects.toThrow(ValidationError);
  });

  it("accepts updateAgent that removes all context files", async () => {
    await writeFile(projectRoot, "notes/a.md", "hello");
    const agentStore = await store.createAgent(undefined, profileWith(["notes/a.md"]));
    await expect(
      store.updateAgent(agentStore.getProfile().id, profileWith([])),
    ).resolves.toBeDefined();
  });
});
