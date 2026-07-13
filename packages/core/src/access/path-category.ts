import path from "node:path";
import { PROJECT_META_DIR } from "../types.js";

export type PathCategory =
  | "userFiles"
  | "rootIndex"
  | "changelog"
  | "projectConfig"
  | "projectTheme"
  | "generatedImages"
  | "skills"
  | "agentsRoot"
  | "agentProfile"
  | "agentTheme"
  | "agentSessions"
  | "agentSkills"
  | "agentTriggers"
  | "agentTriggerLogs"
  | "spherseMetaDir"
  | "spherseOther";

const PATH_PATTERNS: Record<Exclude<PathCategory, "userFiles">, string> = {
  rootIndex: "AGENTS.md",
  changelog: "CHANGELOG.md",
  projectConfig: `${PROJECT_META_DIR}/project.yaml`,
  projectTheme: `${PROJECT_META_DIR}/theme.css`,
  generatedImages: `${PROJECT_META_DIR}/generated-images/**`,
  skills: `${PROJECT_META_DIR}/skills/**`,
  agentsRoot: `${PROJECT_META_DIR}/agents`,
  agentProfile: `${PROJECT_META_DIR}/agents/*/profile.md`,
  agentTheme: `${PROJECT_META_DIR}/agents/*/theme.css`,
  agentSessions: `${PROJECT_META_DIR}/agents/*/sessions.db*`,
  agentSkills: `${PROJECT_META_DIR}/agents/*/skills/**`,
  agentTriggers: `${PROJECT_META_DIR}/agents/*/triggers/index.yml`,
  agentTriggerLogs: `${PROJECT_META_DIR}/agents/*/triggers/logs.jsonl`,
  spherseMetaDir: PROJECT_META_DIR,
  spherseOther: `${PROJECT_META_DIR}/**`,
};

const CATEGORY_ORDER = Object.keys(PATH_PATTERNS) as Exclude<PathCategory, "userFiles">[];

export function categorizePath(relativePath: string): PathCategory {
  const p = normalizeInput(relativePath);
  for (const category of CATEGORY_ORDER) {
    if (globToRegex(PATH_PATTERNS[category]).test(p)) return category;
  }
  return "userFiles";
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
