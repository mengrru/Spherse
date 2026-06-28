import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy } from "../access/access-policy.js";
import { resolveProjectPath } from "../utils/path-safety.js";

type AccessPolicyProvider = () => AccessPolicy;

const RenderCardParams = Type.Object({
  type: Type.Literal("html", { description: "Card type" }),
  content: Type.Optional(Type.String({ description: "Inline HTML content to render. Only for self-contained HTML with NO relative resource references (images, CSS, etc.)" })),
  file_path: Type.Optional(Type.String({ description: "Path to HTML file relative to project root. PREFERRED when the HTML references relative resources — ensures images/CSS resolve correctly" })),
  title: Type.Optional(Type.String({ description: "Card title" })),
  width: Type.Optional(Type.Number({ description: "Card width in pixels" })),
  height: Type.Optional(Type.Number({ description: "Card height in pixels (default 400)" })),
  max_width: Type.Optional(Type.Number({ description: "Maximum width in pixels (default 800)" })),
  max_height: Type.Optional(Type.Number({ description: "Maximum height in pixels (default 600)" })),
});

export function createRenderCardTool(
  projectRoot: string,
  getPolicy: AccessPolicyProvider,
): AgentTool<typeof RenderCardParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "render_card",
    label: "Render Card",
    description:
      "Render HTML content as a visual card in the chat. Use this to display rich HTML content such as web pages, charts, diagrams, or styled documents. You can provide HTML inline via the `content` parameter or reference a project file via `file_path`. **Important: when the HTML references relative resources (images, CSS, fonts, scripts), ALWAYS use `file_path` instead of `content`** — this ensures relative paths resolve correctly. Only use `content` for self-contained HTML with no external resources. Use `width`, `height`, `max_width`, and `max_height` to control the card dimensions.",
    parameters: RenderCardParams,
    async execute(_toolCallId, params, _signal, onUpdate) {
      let html: string;

      if (params.file_path) {
        const resolved = resolveProjectPath(root, params.file_path);
        try {
          getPolicy().assertRead(params.file_path);
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: (err as Error).message }],
            details: { path: params.file_path, denied: true },
          };
        }

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
          file_path: params.file_path,
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
          file_path: params.file_path,
          width: params.width,
          height: params.height ?? 400,
          max_width: params.max_width ?? 800,
          max_height: params.max_height ?? 600,
        },
      };
    },
  };
}
