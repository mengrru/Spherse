export const PROJECT_META_DIR = ".spherse";

export interface ProjectConfig {
  id: string;
  name: string;
  created: number;
  defaultModel: string;
  aiAccess?: { deniedPaths: string[] };
  welcomePage?: { path: string };
}

export interface AgentProfile {
  id: string;
  name: string;
  slug: string;
  createdAt?: number;
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
  source: "builtin" | "project";
  files: string[];
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

export interface ProviderCredentials {
  apiKey?: string;
}

export interface ModelGroupSettings {
  defaultModel: string;
  providers: Record<string, ProviderCredentials>;
  temperature?: number;
}

export interface AppSettings {
  locale: string;
  models: {
    text: ModelGroupSettings;
    image: ModelGroupSettings;
  };
  debugToolsEnabled?: boolean;
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
