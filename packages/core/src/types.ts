export const PROJECT_META_DIR = ".spherse";

export interface ProjectConfig {
  id: string;
  name: string;
  created: number;
  defaultModel: string;
  paths: {
    agents: string;
    index: string;
    changelog: string;
  };
  aiAccess?: { deniedPaths: string[] };
  welcomePage?: { path: string };
}

export interface AgentProfile {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  model?: string;
  schedule?: boolean;
  tools?: string[];
  context?: string[];
  output?: {
    path: string;
    naming: string;
    frontmatter?: Record<string, string>;
  };
  systemPrompt: string;
  filePath: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  filePath: string;
}

export interface ScheduleEntry {
  id: string;
  name?: string;
  enabled: boolean;
  cron: string;
  mode: "new_session" | "existing_session";
  targetSessionId?: string;
  message: string;
  notify: boolean;
  notificationMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleLogEntry {
  scheduleId: string;
  scheduleName?: string;
  agentName?: string;
  sessionId: string;
  triggeredAt: number;
  completedAt?: number;
  status: "running" | "success" | "failed";
  error?: string;
}

export interface SessionInfo {
  id: string;
  agentId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "archived";
  source?: "manual" | "scheduled";
}

export interface AppSettings {
  providers: Record<string, { apiKey: string } | undefined>;
  defaultModel: string;
  locale: string;
}

export interface ProviderCatalogItem {
  id: string;
  name: string;
  auth: {
    type: "apiKey" | "external" | "unknown";
    envKeys: string[];
  };
  models: ProviderModelItem[];
}

export interface ProviderModelItem {
  id: string;
  name: string;
  provider: string;
  api: string;
  reasoning: boolean;
  input: readonly string[];
  contextWindow?: number;
  maxTokens?: number;
}

export type ProviderCatalog = Record<string, ProviderCatalogItem>;
