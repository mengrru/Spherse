import path from "node:path";
import { PROJECT_META_DIR } from "../types.js";
import type { PathRule } from "../kernel/ports.js";

export type PathCategory =
  | "userFiles"
  | "rootIndex"
  | "changelog"
  | "projectConfig"
  | "projectTheme"
  | "generatedImages"
  | "attachments"
  | "skills"
  | "agentsRoot"
  | "agentProfile"
  | "agentTheme"
  | "agentMcp"
  | "agentSessions"
  | "agentSkills"
  | "agentTriggers"
  | "agentTriggerLogs"
  | "spherseMetaDir"
  | "spherseOther"
  | (string & {});

const PATH_PATTERNS: Record<string, string> = {
  rootIndex: "AGENTS.md",
  changelog: "CHANGELOG.md",
  projectConfig: `${PROJECT_META_DIR}/project.yaml`,
  projectTheme: `${PROJECT_META_DIR}/theme.css`,
  generatedImages: `${PROJECT_META_DIR}/generated-images/**`,
  attachments: `${PROJECT_META_DIR}/attachments/**`,
  skills: `${PROJECT_META_DIR}/skills/**`,
  agentsRoot: `${PROJECT_META_DIR}/agents`,
  agentProfile: `${PROJECT_META_DIR}/agents/*/profile.md`,
  agentTheme: `${PROJECT_META_DIR}/agents/*/theme.css`,
  agentMcp: `${PROJECT_META_DIR}/agents/*/mcp.json`,
  agentSessions: `${PROJECT_META_DIR}/agents/*/sessions.db*`,
  agentSkills: `${PROJECT_META_DIR}/agents/*/skills/**`,
  agentTriggers: `${PROJECT_META_DIR}/agents/*/triggers/index.yml`,
  agentTriggerLogs: `${PROJECT_META_DIR}/agents/*/triggers/logs.jsonl`,
  spherseMetaDir: PROJECT_META_DIR,
  spherseOther: `${PROJECT_META_DIR}/**`,
};

const CATEGORY_ORDER = Object.keys(PATH_PATTERNS) as Exclude<PathCategory, "userFiles">[];

export function categorizePath(relativePath: string, extraRules?: ReadonlyArray<PathRule>): PathCategory {
  const p = normalizeInput(relativePath);
  if (extraRules) {
    for (const rule of extraRules) {
      if (rule.match.test(p)) return rule.category;
    }
  }
  for (const category of CATEGORY_ORDER) {
    if (globToRegex(PATH_PATTERNS[category]).test(p)) return category;
  }
  return "userFiles";
}

export function ruleForPath(relativePath: string, extraRules?: ReadonlyArray<PathRule>): PathRule | null {
  const p = normalizeInput(relativePath);
  if (!extraRules) return null;
  for (const rule of extraRules) {
    if (rule.match.test(p)) return rule;
  }
  return null;
}

const regexCache = new Map<string, RegExp>();

function globToRegex(glob: string): RegExp {
  let re = regexCache.get(glob);
  if (!re) {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\/\*\*/g, "::SUBTREE::")
      .replace(/\*/g, "[^/]*")
      .replace(/::SUBTREE::/g, "(/.*)?");
    re = new RegExp(`^${escaped}$`);
    regexCache.set(glob, re);
  }
  return re;
}

function normalizeInput(input: string): string {
  const normalized = path.posix.normalize(input.replace(/\\/g, "/"));
  return normalized.replace(/^\.\/+/, "");
}
