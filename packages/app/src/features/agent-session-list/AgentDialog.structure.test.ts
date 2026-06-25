import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("AgentDialog structure", () => {
  const source = readFileSync(join(currentDir, "AgentDialog.tsx"), "utf8");

  it("imports PRESET_PROMPT_TEMPLATES from @spherse/presets", () => {
    expect(source).toContain("PRESET_PROMPT_TEMPLATES");
    expect(source).toContain("@spherse/presets");
  });

  it("renders PromptTemplatePicker inside the prompt Field", () => {
    expect(source).toContain("PromptTemplatePicker");
  });

  it("uses AlertDialog for overwrite confirmation", () => {
    expect(source).toContain("AlertDialog");
    expect(source).toContain("confirmTemplate");
    expect(source).toContain("applyTemplate");
  });

  it("fills prompt directly when empty, confirms when non-empty", () => {
    expect(source).toContain('systemPrompt.trim() === ""');
    expect(source).toContain("setConfirmTemplate(template)");
  });
});
