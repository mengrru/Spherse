import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("AgentDialog structure", () => {
  const formSource = readFileSync(join(currentDir, "AgentDialogForm.tsx"), "utf8");
  const pickerSource = readFileSync(join(currentDir, "PromptTemplatePicker.tsx"), "utf8");

  it("imports PRESET_PROMPT_TEMPLATES from @spherse/presets", () => {
    expect(pickerSource).toContain("PRESET_PROMPT_TEMPLATES");
    expect(pickerSource).toContain("@spherse/presets");
  });

  it("renders PromptTemplatePicker inside the prompt Field", () => {
    expect(formSource).toContain("PromptTemplatePicker");
  });

  it("uses AlertDialog for overwrite confirmation", () => {
    expect(formSource).toContain("AlertDialog");
    expect(formSource).toContain("confirmTemplate");
    expect(formSource).toContain("applyTemplate");
  });

  it("fills prompt directly when empty, confirms when non-empty", () => {
    expect(formSource).toContain('systemPrompt.trim() === ""');
    expect(formSource).toContain("setConfirmTemplate(template)");
  });
});
