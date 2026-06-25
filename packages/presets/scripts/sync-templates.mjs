import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "..", "templates");
const generatedDir = join(__dirname, "..", "src", "generated");

mkdirSync(generatedDir, { recursive: true });

const mapping = [
  ["agent-template.md", "AGENT_TEMPLATE", "agent-template.ts"],
  ["agent-theme-template.css", "AGENT_THEME_TEMPLATE", "agent-theme-template.ts"],
];

for (const [sourceFile, constName, outFile] of mapping) {
  const content = readFileSync(join(templatesDir, sourceFile), "utf-8");
  const tsContent = `export const ${constName} = ${JSON.stringify(content)};\n`;
  writeFileSync(join(generatedDir, outFile), tsContent, "utf-8");
  console.log(`synced: templates/${sourceFile} → src/generated/${outFile} (${constName})`);
}

const presetsConfig = JSON.parse(readFileSync(join(__dirname, "..", "presets.json"), "utf-8"));
const skillsDir = join(__dirname, "..", "skills");

for (const skill of presetsConfig.presetSkills) {
  const skillPath = join(skillsDir, skill.dir);
  if (!existsSync(skillPath)) {
    console.error(`preset skill directory not found: ${skill.dir}`);
    process.exit(1);
  }
}

const presetsTsContent = `export const PRESET_SKILLS = ${JSON.stringify(presetsConfig.presetSkills, null, 2)} as const;

export const PRESET_AGENTS = ${JSON.stringify(presetsConfig.presetAgents, null, 2)} as const;
`;
writeFileSync(join(generatedDir, "presets.ts"), presetsTsContent, "utf-8");
console.log("synced: presets.json → src/generated/presets.ts (PRESET_SKILLS, PRESET_AGENTS)");

const promptTemplatesDir = join(templatesDir, "prompt-templates");
const presetPromptTemplates = presetsConfig.presetPromptTemplates.map((tpl) => {
  const filePath = join(promptTemplatesDir, `${tpl.id}.md`);
  if (!existsSync(filePath)) {
    console.error(`preset prompt template not found: ${tpl.id}.md`);
    process.exit(1);
  }
  return { id: tpl.id, name: tpl.name, prompt: readFileSync(filePath, "utf-8") };
});

const promptTemplatesTsContent = `export const PRESET_PROMPT_TEMPLATES = ${JSON.stringify(presetPromptTemplates, null, 2)} as const;\n`;
writeFileSync(join(generatedDir, "prompt-templates.ts"), promptTemplatesTsContent, "utf-8");
console.log("synced: prompt templates → src/generated/prompt-templates.ts (PRESET_PROMPT_TEMPLATES)");

function readDirRecursive(dir, base) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readDirRecursive(fullPath, base));
    } else {
      files.push({
        relativePath: relative(base, fullPath),
        content: readFileSync(fullPath, "utf-8"),
      });
    }
  }
  return files;
}

const presetSkillSources = presetsConfig.presetSkills.map((skill) => {
  const skillPath = join(skillsDir, skill.dir);
  return {
    dir: skill.dir,
    files: readDirRecursive(skillPath, skillPath),
  };
});

const presetSkillsTsContent = `export const PRESET_SKILL_SOURCES: { dir: string; files: { relativePath: string; content: string }[] }[] = ${JSON.stringify(presetSkillSources, null, 2)};
`;
writeFileSync(join(generatedDir, "preset-skills.ts"), presetSkillsTsContent, "utf-8");
console.log("synced: preset skills → src/generated/preset-skills.ts (PRESET_SKILL_SOURCES)");
