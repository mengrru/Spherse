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
  | "agentProfile"
  | "agentTheme"
  | "agentSessions"
  | "agentSchedules"
  | "agentScheduleLogs"
  | "spherseOther";

const PATH_PATTERNS: Record<Exclude<PathCategory, "userFiles">, string> = {
  rootIndex: "AGENTS.md",
  changelog: "CHANGELOG.md",
  projectConfig: `${PROJECT_META_DIR}/project.yaml`,
  projectTheme: `${PROJECT_META_DIR}/theme.css`,
  generatedImages: `${PROJECT_META_DIR}/generated-images/**`,
  skills: `${PROJECT_META_DIR}/skills/**`,
  agentProfile: `${PROJECT_META_DIR}/agents/*/profile.md`,
  agentTheme: `${PROJECT_META_DIR}/agents/*/theme.css`,
  agentSessions: `${PROJECT_META_DIR}/agents/*/sessions.db`,
  agentSchedules: `${PROJECT_META_DIR}/agents/*/schedules.yml`,
  agentScheduleLogs: `${PROJECT_META_DIR}/agents/*/schedule-logs.jsonl`,
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
