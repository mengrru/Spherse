import type { ContextBlock } from "./blocks.js";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBlock(block: ContextBlock): string {
  switch (block.kind) {
    case "project-instructions":
      return `<project-instructions>\n${block.content}\n</project-instructions>`;
    case "agent-profile":
      return `<agent-profile>\n${block.content}\n</agent-profile>`;
    case "skill-catalog": {
      const items = block.skills
        .map(
          (s) =>
            `<skill-item name="${escapeAttr(s.name)}" description="${escapeAttr(s.description)}"/>`,
        )
        .join("\n");
      return `<skill-catalog>\n${items}\n</skill-catalog>`;
    }
    case "preloaded-context": {
      const files = block.files
        .map(
          (f) =>
            `<context-file path="${escapeAttr(f.path)}">\n${f.content}\n</context-file>`,
        )
        .join("\n");
      return `<preloaded-context>\n${files}\n</preloaded-context>`;
    }
  }
}

export function serializeSystemPrompt(blocks: Array<ContextBlock | null>): string {
  const rendered = blocks
    .filter((b): b is ContextBlock => b !== null)
    .map(renderBlock);
  if (rendered.length === 0) return "";
  return rendered.join("\n\n");
}
