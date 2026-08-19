import type { ContextBlock } from "../kernel/context-block.js";
import { serializeBlocks } from "../kernel/context-block.js";

export interface ContextFile {
  path: string;
  content: string;
}

export interface SessionMeta {
  name: string;
  alias?: string;
  slug: string;
  sessionId: string;
  timePerceptionEnabled?: boolean;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildProjectInstructions(content: string): ContextBlock | null {
  if (content.trim() === "") return null;
  return {
    kind: "project-instructions",
    render: () => `<project-instructions>\n${content}\n</project-instructions>`,
  };
}

export function buildAgentProfile(content: string): ContextBlock | null {
  if (content.trim() === "") return null;
  return {
    kind: "agent-profile",
    render: () => `<agent-profile>\n${content}\n</agent-profile>`,
  };
}

export function buildSessionContext(meta: SessionMeta): ContextBlock {
  return {
    kind: "session-context",
    render: () => {
      const lines = [`agent-name: ${meta.name}`];
      if (meta.alias) {
        lines.push(`agent-alias: ${meta.alias}`);
      }
      lines.push(`agent-slug: ${meta.slug}`);
      lines.push(`session-id: ${meta.sessionId}`);
      if (meta.timePerceptionEnabled) {
        lines.push("time-perception: enabled");
        lines.push("Do not output <time> tags in your replies; they are metadata for your awareness only.");
      }
      return `<session-context>\n${lines.join("\n")}\n</session-context>`;
    },
  };
}

export interface SkillItem {
  name: string;
  description: string;
}

export function buildSkillCatalog(skills: SkillItem[]): ContextBlock | null {
  if (skills.length === 0) return null;
  return {
    kind: "skill-catalog",
    render: () => {
      const items = skills
        .map((s) => `<skill-item name="${escapeAttr(s.name)}" description="${escapeAttr(s.description)}"/>`)
        .join("\n");
      return `<skill-catalog>\n${items}\n</skill-catalog>`;
    },
  };
}

export function buildPreloadedContext(files: ContextFile[]): ContextBlock | null {
  if (files.length === 0) return null;
  return {
    kind: "preloaded-context",
    render: () => {
      const rendered = files
        .map((f) => `<context-file path="${escapeAttr(f.path)}">\n${f.content}\n</context-file>`)
        .join("\n");
      return `<preloaded-context>\n${rendered}\n</preloaded-context>`;
    },
  };
}

export function serializeSystemPrompt(blocks: ReadonlyArray<ContextBlock | null>): string {
  return serializeBlocks(blocks);
}
