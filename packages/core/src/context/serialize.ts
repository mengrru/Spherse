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
    case "session-context": {
      const lines = [`agent-name: ${block.meta.name}`];
      if (block.meta.alias) {
        lines.push(`agent-alias: ${block.meta.alias}`);
      }
      lines.push(`agent-slug: ${block.meta.slug}`);
      lines.push(`session-id: ${block.meta.sessionId}`);
      if (block.meta.timePerceptionEnabled) {
        lines.push("time-perception: enabled");
        lines.push("Do not output <time> tags in your replies; they are metadata for your awareness only.");
      }
      return `<session-context>\n${lines.join("\n")}\n</session-context>`;
    }
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
    case "mcp-context": {
      const servers = block.servers.map((s) => {
        const parts: string[] = [];
        const caps: string[] = [];
        if (s.capabilities?.resources) caps.push("resources");
        if (s.capabilities?.prompts) caps.push("prompts");
        const capAttr = caps.length > 0 ? ` capabilities="${caps.join(",")}"` : "";
        if (s.instructions && s.instructions.trim() !== "") {
          parts.push(`<instructions>\n${s.instructions}\n</instructions>`);
        }
        const allResources = [
          ...s.resources.map(
            (r) =>
              `<resource uri="${escapeAttr(r.uri)}" name="${escapeAttr(r.name)}"` +
              (r.description ? ` description="${escapeAttr(r.description)}"` : "") +
              (r.mimeType ? ` mimeType="${escapeAttr(r.mimeType)}"` : "") +
              "/>",
          ),
          ...s.resourceTemplates.map(
            (r) =>
              `<resource-template uriTemplate="${escapeAttr(r.uriTemplate)}" name="${escapeAttr(r.name)}"` +
              (r.description ? ` description="${escapeAttr(r.description)}"` : "") +
              (r.mimeType ? ` mimeType="${escapeAttr(r.mimeType)}"` : "") +
              "/>",
          ),
        ];
        if (allResources.length > 0) {
          parts.push(`<resources>\n${allResources.join("\n")}\n</resources>`);
        }
        if (s.prompts.length > 0) {
          const prompts = s.prompts
            .map((p) => {
              const args = (p.arguments ?? [])
                .map(
                  (a) =>
                    `<arg name="${escapeAttr(a.name)}"` +
                    (a.required ? " required=\"true\"" : "") +
                    (a.description ? ` description="${escapeAttr(a.description)}"` : "") +
                    "/>",
                )
                .join("\n");
              const header =
                `<prompt name="${escapeAttr(p.name)}"` +
                (p.description ? ` description="${escapeAttr(p.description)}"` : "") +
                ">";
              return args
                ? `${header}\n${args}\n</prompt>`
                : `${header}</prompt>`;
            })
            .join("\n");
          parts.push(`<prompts>\n${prompts}\n</prompts>`);
        }
        return `<server name="${escapeAttr(s.serverName)}"${capAttr}>\n${parts.join("\n")}\n</server>`;
      });
      return `<mcp-context>\n${servers.join("\n")}\n</mcp-context>`;
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
