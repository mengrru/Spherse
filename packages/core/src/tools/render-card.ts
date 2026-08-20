import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicyProvider } from "../access/access-policy.js";
import { resolveProjectPath } from "../utils/path-safety.js";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "ico", "webp"]);

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export interface RenderCardDetails {
  type: "html";
  html?: string;
  file_path?: string;
  title?: string;
  width?: number;
  height?: number;
  max_width?: number;
  max_height?: number;
}

export interface RenderCardResultDetails {
  cardType: "html";
  /**
   * Backward-compat: legacy persisted toolResult.details may carry the inline
   * HTML payload here. Current tool no longer writes this field (HTML lives
   * only in onUpdate details), but consumers still read it to reconstruct
   * historical cards.
   */
  html?: string;
  title?: string;
  file_path?: string;
  width?: number;
  height?: number;
  max_width?: number;
  max_height?: number;
}

const RenderCardParams = Type.Object({
  type: Type.Literal("html", { description: "Card type" }),
  content: Type.Optional(Type.String({ description: "Inline HTML content (self-contained, no external resources)." })),
  file_path: Type.Optional(Type.String({ description: "Path to a file relative to project root. Can be an HTML file (renders as a rich HTML card) or an image file — png/jpg/jpeg/gif/webp/svg/ico — which renders the image directly. Do not pass a path returned by `generate_image`; its result is already shown as an image card, so rendering it again here is redundant." })),
  title: Type.Optional(Type.String({ description: "Card title" })),
  width: Type.Optional(Type.Number({ description: "Card width in pixels" })),
  height: Type.Optional(Type.Number({ description: "Card height in pixels (default 400)" })),
  max_width: Type.Optional(Type.Number({ description: "Reserved — no longer affects layout (card width is capped by the chat bubble)." })),
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
      "Render content as a visual card in the chat. Provide a project file via `file_path`: an HTML file renders as a rich HTML card (web pages, charts, diagrams, styled documents); an image file (png/jpg/jpeg/gif/webp/svg/ico) renders the image directly. You may also pass self-contained HTML inline via `content`, but prefer `file_path` for anything that references project resources. Use `width`, `height`, `max_width`, and `max_height` to control the card dimensions. Do NOT use this tool to display images just produced by `generate_image` — a successful `generate_image` call already renders the result as an image card in the chat, so calling `render_card` afterward only duplicates the display.",
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

        if (isImageFile(params.file_path)) {
          try {
            await fs.access(resolved, fs.constants.R_OK);
          } catch {
            return {
              content: [{ type: "text" as const, text: `Error: file not found at ${params.file_path}` }],
              details: { error: true },
            };
          }
          html = "";
        } else {
          try {
            html = await fs.readFile(resolved, "utf-8");
          } catch {
            return {
              content: [{ type: "text" as const, text: `Error: file not found at ${params.file_path}` }],
              details: { error: true },
            };
          }
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
        } satisfies RenderCardDetails,
      });

      return {
        content: [{ type: "text" as const, text: "HTML card rendered successfully" }],
        details: {
          cardType: "html" as const,
          title: params.title,
          file_path: params.file_path,
          width: params.width,
          height: params.height ?? 400,
          max_width: params.max_width ?? 800,
          max_height: params.max_height ?? 600,
        } satisfies RenderCardResultDetails,
      };
    },
  };
}
