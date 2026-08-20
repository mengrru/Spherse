import { describe, expect, it } from "vitest";
import { categorizePath, ruleForPath, type PathRule } from "../../access/path-category.js";
import { llmAccessPolicy } from "../../access/access-policy.js";

const MEMORY_RULE: PathRule = {
  match: /^\.spherse\/agents\/[^/]+\/memory\.jsonl$/,
  category: "memory",
  llm: { read: true, write: true },
};

describe("PathRule registry", () => {
  it("categorizePath prefers registered rules over builtin categories", () => {
    expect(categorizePath(".spherse/agents/abc/memory.jsonl")).toBe("spherseOther");
    expect(categorizePath(".spherse/agents/abc/memory.jsonl", [MEMORY_RULE])).toBe("memory");
    expect(categorizePath("docs/chapter.md", [MEMORY_RULE])).toBe("userFiles");
  });

  it("ruleForPath returns the matched rule or null", () => {
    expect(ruleForPath(".spherse/agents/abc/memory.jsonl", [MEMORY_RULE])).toBe(MEMORY_RULE);
    expect(ruleForPath("elsewhere.txt", [MEMORY_RULE])).toBeNull();
  });

  it("policy honors rule verdicts without touching builtin allow-sets", () => {
    const policy = llmAccessPolicy("/tmp/proj", [], [MEMORY_RULE]);
    expect(policy.canRead(".spherse/agents/abc/memory.jsonl")).toBe(true);
    expect(policy.canWrite(".spherse/agents/abc/memory.jsonl")).toBe(true);
    expect(policy.canWrite(".spherse/agents/abc/profile.md")).toBe(false);
  });

  it("policy denies when the rule forbids write", () => {
    const rule: PathRule = {
      match: /^\.spherse\/agents\/[^/]+\/memory\.jsonl$/,
      category: "memory",
      llm: { read: true, write: false },
    };
    const policy = llmAccessPolicy("/tmp/proj", [], [rule]);
    expect(policy.canRead(".spherse/agents/abc/memory.jsonl")).toBe(true);
    expect(policy.canWrite(".spherse/agents/abc/memory.jsonl")).toBe(false);
    expect(() => policy.assertWrite(".spherse/agents/abc/memory.jsonl")).toThrow(
      /category "memory"/,
    );
  });
});
