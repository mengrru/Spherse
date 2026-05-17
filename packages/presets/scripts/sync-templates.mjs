import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "..", "templates");
const generatedDir = join(__dirname, "..", "src", "generated");

mkdirSync(generatedDir, { recursive: true });

const mapping = [
  ["agent-template.md", "AGENT_TEMPLATE", "agent-template.ts"],
];

for (const [sourceFile, constName, outFile] of mapping) {
  const content = readFileSync(join(templatesDir, sourceFile), "utf-8");
  const tsContent = `export const ${constName} = ${JSON.stringify(content)};\n`;
  writeFileSync(join(generatedDir, outFile), tsContent, "utf-8");
  console.log(`synced: templates/${sourceFile} → src/generated/${outFile} (${constName})`);
}
