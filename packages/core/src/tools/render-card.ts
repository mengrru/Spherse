import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const RenderCardParams = Type.Object({
  type: Type.Literal("html", { description: "Card type" }),
  content: Type.Optional(Type.String({ description: "Inline HTML content to render" })),
  file_path: Type.Optional(Type.String({ description: "Path to HTML file relative to project root" })),
  title: Type.Optional(Type.String({ description: "Card title" })),
  width: Type.Optional(Type.Number({ description: "Card width in pixels" })),
  height: Type.Optional(Type.Number({ description: "Card height in pixels (default 400)" })),
  max_width: Type.Optional(Type.Number({ description: "Maximum width in pixels (default 800)" })),
  max_height: Type.Optional(Type.Number({ description: "Maximum height in pixels (default 600)" })),
});

function validatePath(projectRoot: string, relativePath: string): string {
  const resolved = path.resolve(projectRoot, relativePath);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

export function createRenderCardTool(projectRoot: string): AgentTool<typeof RenderCardParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "render_card",
    label: "Render Card",
    description:
      "Render HTML content as a visual card in the chat. Use this to display rich HTML content such as web pages, charts, diagrams, or styled documents. You can provide HTML inline via the `content` parameter or reference a project file via `file_path`. Use `width`, `height`, `max_width`, and `max_height` to control the card dimensions.",
    parameters: RenderCardParams,
    async execute(_toolCallId, params, _signal, onUpdate) {
      let html: string;

      if (params.file_path) {
        const resolved = validatePath(root, params.file_path);
        try {
          html = await fs.readFile(resolved, "utf-8");
        } catch {
          return {
            content: [{ type: "text" as const, text: `Error: file not found at ${params.file_path}` }],
            details: { error: true },
          };
        }
      } else if (params.content) {
        html = params.content;
      } else {
        return {
          content: [{ type: "text" as const, text: "Error: must provide either `content` or `file_path`" }],
          details: { error: true },
        };
      }

      onUpdate?.({
        content: [{ type: "text" as const, text: "rendering..." }],
        details: {
          type: "html" as const,
          html,
          title: params.title,
          width: params.width,
          height: params.height ?? 400,
          max_width: params.max_width ?? 800,
          max_height: params.max_height ?? 600,
        },
      });

      return {
        content: [{ type: "text" as const, text: "HTML card rendered successfully" }],
        details: {
          cardType: "html",
          title: params.title,
          html,
          width: params.width,
          height: params.height ?? 400,
          max_width: params.max_width ?? 800,
          max_height: params.max_height ?? 600,
        },
      };
    },
  };
}
