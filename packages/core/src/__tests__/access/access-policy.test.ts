import { describe, expect, it } from "vitest";
import {
  llmAccessPolicy,
  serverAccessPolicy,
} from "../../access/access-policy.js";
import { categorizePath } from "../../access/path-category.js";
import { AccessDeniedError } from "../../errors.js";

const PROJECT_ROOT = "/tmp/spherse-access-test";


interface MatrixRow {
  category: PathCategory;
  path: string;
  llmRead: boolean;
  llmWrite: boolean;
  srvRead: boolean;
  srvWrite: boolean;
}

const MATRIX: MatrixRow[] = [
  { category: "userFiles", path: "lore/timeline.md", llmRead: true, llmWrite: true, srvRead: true, srvWrite: true },
  { category: "rootIndex", path: "AGENTS.md", llmRead: true, llmWrite: false, srvRead: true, srvWrite: true },
  { category: "changelog", path: "CHANGELOG.md", llmRead: true, llmWrite: false, srvRead: true, srvWrite: true },
  { category: "projectConfig", path: ".spherse/project.yaml", llmRead: true, llmWrite: false, srvRead: false, srvWrite: false },
  { category: "projectTheme", path: ".spherse/theme.css", llmRead: true, llmWrite: true, srvRead: true, srvWrite: true },
  { category: "generatedImages", path: ".spherse/generated-images/img.png", llmRead: true, llmWrite: false, srvRead: true, srvWrite: false },
  { category: "skills", path: ".spherse/skills/my-skill/SKILL.md", llmRead: true, llmWrite: false, srvRead: false, srvWrite: false },
  { category: "agentProfile", path: ".spherse/agents/bot-abc123/profile.md", llmRead: true, llmWrite: false, srvRead: false, srvWrite: false },
  { category: "agentTheme", path: ".spherse/agents/bot-abc123/theme.css", llmRead: true, llmWrite: true, srvRead: true, srvWrite: false },
  { category: "agentSessions", path: ".spherse/agents/bot-abc123/sessions.db", llmRead: false, llmWrite: false, srvRead: false, srvWrite: false },
  { category: "agentSchedules", path: ".spherse/agents/bot-abc123/schedules.yml", llmRead: true, llmWrite: false, srvRead: false, srvWrite: false },
  { category: "spherseOther", path: ".spherse/unknown.txt", llmRead: true, llmWrite: false, srvRead: false, srvWrite: false },
];

describe("access policy matrix", () => {
  const llm = llmAccessPolicy(PROJECT_ROOT, []);
  const srv = serverAccessPolicy(PROJECT_ROOT);

  it.each(MATRIX)(
    "$category ($path) is categorized correctly and matches the policy matrix",
    (row) => {
      expect(categorizePath(row.path)).toBe(row.category);

      expect(llm.canRead(row.path)).toBe(row.llmRead);
      expect(llm.canWrite(row.path)).toBe(row.llmWrite);
      expect(srv.canRead(row.path)).toBe(row.srvRead);
      expect(srv.canWrite(row.path)).toBe(row.srvWrite);
    },
  );
});

describe("llmAccessPolicy denied paths", () => {
  const llm = llmAccessPolicy(PROJECT_ROOT, ["secrets"]);

  it("blocks both read and write of a file under a denied directory", () => {
    expect(llm.canRead("secrets/key.md")).toBe(false);
    expect(llm.canWrite("secrets/key.md")).toBe(false);
  });

  it("blocks nested files under a denied directory (recursive)", () => {
    expect(llm.canRead("secrets/sub/deeper/key.md")).toBe(false);
    expect(llm.canWrite("secrets/sub/deeper/key.md")).toBe(false);
  });

  it("blocks the denied directory entry itself", () => {
    expect(llm.canRead("secrets")).toBe(false);
  });

  it("does not affect sibling paths outside the denied directory", () => {
    expect(llm.canRead("lore/timeline.md")).toBe(true);
    expect(llm.canWrite("lore/timeline.md")).toBe(true);
  });

  it("does not block a path that merely starts with the denied prefix string", () => {
    expect(llm.canRead("secrets-vault/note.md")).toBe(true);
  });
});

describe("serverAccessPolicy is not affected by denied paths", () => {
  const srv = serverAccessPolicy(PROJECT_ROOT);

  it("allows reading and writing user files that LLM would deny", () => {
    expect(srv.canRead("secrets/key.md")).toBe(true);
    expect(srv.canWrite("secrets/key.md")).toBe(true);
  });
});

describe("path traversal protection", () => {
  it("llmAccessPolicy.read throws AccessDeniedError for escaping paths", () => {
    const llm = llmAccessPolicy(PROJECT_ROOT, []);
    expect(() => llm.assertRead("../outside.md")).toThrow(AccessDeniedError);
    expect(() => llm.assertWrite("../outside.md")).toThrow(AccessDeniedError);
  });

  it("serverAccessPolicy.read throws AccessDeniedError for escaping paths", () => {
    const srv = serverAccessPolicy(PROJECT_ROOT);
    expect(() => srv.assertRead("../outside.md")).toThrow(AccessDeniedError);
    expect(() => srv.assertWrite("../outside.md")).toThrow(AccessDeniedError);
  });

  it("canRead returns false for escaping paths", () => {
    const llm = llmAccessPolicy(PROJECT_ROOT, []);
    expect(llm.canRead("../outside.md")).toBe(false);
  });
});

describe("throwing vs non-throwing behavior", () => {
  const llm = llmAccessPolicy(PROJECT_ROOT, ["secrets"]);

  it("read() throws AccessDeniedError on a denied path while canRead() returns false", () => {
    expect(() => llm.assertRead("secrets/key.md")).toThrow(AccessDeniedError);
    expect(llm.canRead("secrets/key.md")).toBe(false);
  });

  it("write() throws AccessDeniedError on a category not permitted for write", () => {
    expect(() => llm.assertWrite("AGENTS.md")).toThrow(AccessDeniedError);
    expect(llm.canWrite("AGENTS.md")).toBe(false);
  });

  it("read() does not throw for an allowed path", () => {
    expect(() => llm.assertRead("lore/timeline.md")).not.toThrow();
  });
});
