import type { Message } from "@earendil-works/pi-ai";
import type { AgentProfile } from "../types.js";
import { estimateTokens } from "../context/token-estimate.js";
import { extractLastUsageTotalTokens } from "../context/token-estimate.js";
export { extractLastUsageTotalTokens } from "../context/token-estimate.js";

export interface SessionStatus {
  currentTokens: number;
  contextWindowLimit: number | null;
}

export function resolveContextWindow(
  profile: AgentProfile,
  resolveModelById: (modelId: string) => unknown,
  defaultModel?: string,
): number | null {
  const candidates = profile.model
    ? profile.model === defaultModel
      ? [profile.model]
      : [profile.model, defaultModel]
    : [defaultModel];
  for (const modelId of candidates) {
    if (!modelId) continue;
    try {
      const window = (resolveModelById(modelId) as { contextWindow?: number })?.contextWindow;
      if (window != null) return window;
    } catch {
      continue;
    }
  }
  return null;
}

export function computeSessionStatus(
  messages: unknown[],
  profile: AgentProfile,
  resolveModelById: (modelId: string) => unknown,
  defaultModel?: string,
): SessionStatus {
  const lastUsage = extractLastUsageTotalTokens(messages);
  const currentTokens = lastUsage ?? estimateTokens(messages as Message[]);
  return {
    currentTokens,
    contextWindowLimit: resolveContextWindow(profile, resolveModelById, defaultModel),
  };
}
