import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("SkillPanel structure", () => {
  it("renders the skills section with a create/install menu and a skills-rooted tree", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain('t("project-panel.skills")');
    expect(source).toContain("<DropdownMenu>");
    expect(source).toContain('t("skill-panel.create")');
    expect(source).toContain('t("skill-panel.install")');
    expect(source).toContain('rootPath=".spherse/skills"');
    expect(source).toContain("<CreateSkillDialog");
  });

  it("wires file selection and deletion to navigation like UserFilePanel", () => {
    const source = readFileSync(join(currentDir, "index.tsx"), "utf8");

    expect(source).toContain("handleSelectFile");
    expect(source).toContain("handleFileDeleted");
    expect(source).toContain("useProjectCtx");
    expect(source).toContain("useNavigate");
  });
});
