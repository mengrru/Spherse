import type { McpServerInfo } from "../../mcp/types.js";
import type { ContextBlock } from "../../kernel/context-block.js";
import { escapeXmlAttr } from "../../utils/xml-escape.js";

export function mcpContextBlock(servers: McpServerInfo[]): ContextBlock | null {
  const meaningful = servers.filter(
    (s) =>
      (s.instructions?.trim() ?? "") !== "" ||
      s.resources.length > 0 ||
      s.resourceTemplates.length > 0 ||
      s.prompts.length > 0,
  );
  if (meaningful.length === 0) return null;
  return {
    kind: "mcp-context",
    render: () => renderMcpServers(meaningful),
  };
}

function renderMcpServers(servers: McpServerInfo[]): string {
  const rendered = servers.map((s) => {
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
          `<resource uri="${escapeXmlAttr(r.uri)}" name="${escapeXmlAttr(r.name)}"` +
          (r.description ? ` description="${escapeXmlAttr(r.description)}"` : "") +
          (r.mimeType ? ` mimeType="${escapeXmlAttr(r.mimeType)}"` : "") +
          "/>",
      ),
      ...s.resourceTemplates.map(
        (r) =>
          `<resource-template uriTemplate="${escapeXmlAttr(r.uriTemplate)}" name="${escapeXmlAttr(r.name)}"` +
          (r.description ? ` description="${escapeXmlAttr(r.description)}"` : "") +
          (r.mimeType ? ` mimeType="${escapeXmlAttr(r.mimeType)}"` : "") +
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
                `<arg name="${escapeXmlAttr(a.name)}"` +
                (a.required ? ` required="true"` : "") +
                (a.description ? ` description="${escapeXmlAttr(a.description)}"` : "") +
                "/>",
            )
            .join("\n");
          const header =
            `<prompt name="${escapeXmlAttr(p.name)}"` +
            (p.description ? ` description="${escapeXmlAttr(p.description)}"` : "") +
            ">";
          return args ? `${header}\n${args}\n</prompt>` : `${header}</prompt>`;
        })
        .join("\n");
      parts.push(`<prompts>\n${prompts}\n</prompts>`);
    }
    return `<server name="${escapeXmlAttr(s.serverName)}"${capAttr}>\n${parts.join("\n")}\n</server>`;
  });
  return `<mcp-context>\n${rendered.join("\n")}\n</mcp-context>`;
}
