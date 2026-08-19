import type { Message } from "@earendil-works/pi-ai";
import type { AgentProfile } from "../types.js";
import { estimateTokens } from "../context/token-estimate.js";

export interface SessionStatus {
  currentTokens: number;
  contextWindowLimit: number | null;
}

export function resolveEffectiveModelId(
  profile: AgentProfile,
  defaultModel?: string,
): string | undefined {
  return profile.model || defaultModel || undefined;
}

export function resolveContextWindow(
  profile: AgentProfile,
  resolveModelById: (modelId: string) => unknown,
  defaultModel?: string,
): number | null {
  const modelId = resolveEffectiveModelId(profile, defaultModel);
  if (!modelId) return null;
  try {
    return (resolveModelById(modelId) as { contextWindow?: number })?.contextWindow ?? null;
  } catch {
    return null;
  }
}

export function extractLastUsageTotalTokens(messages: unknown[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; usage?: { totalTokens?: unknown } };
    if (msg?.role === "assistant" && typeof msg?.usage?.totalTokens === "number") {
      return msg.usage.totalTokens;
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
