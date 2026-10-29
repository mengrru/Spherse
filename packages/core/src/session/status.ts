import type { Message } from "@earendil-works/pi-ai";
import type { AgentProfile } from "../types.js";
import { estimateTokens } from "../context/token-estimate.js";
import { extractLastUsageTotalTokens } from "../context/token-estimate.js";
import { isDigestMessage } from "../context/compaction.js";
export { extractLastUsageTotalTokens } from "../context/token-estimate.js";

export interface SessionStatus {
  currentTokens: number;
  contextWindowLimit: number | null;
  cacheHitRate: number | null;
  turnInputTokens: number | null;
  turnCacheReadTokens: number | null;
  turnCacheWriteTokens: number | null;
  turnOutputTokens: number | null;
  userMessageCount: number;
  messageCount: number;
}

export interface TurnStats {
  cacheHitRate: number | null;
  turnInputTokens: number | null;
  turnCacheReadTokens: number | null;
  turnCacheWriteTokens: number | null;
  turnOutputTokens: number | null;
  userMessageCount: number;
  messageCount: number;
}

interface UsageLike {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
}

export function resolveModelWithFallback<T>(
  profile: AgentProfile,
  resolveModelById: (modelId: string) => T,
  defaultModel?: string,
): T | undefined {
  const candidates = profile.model ? [profile.model, defaultModel] : [defaultModel];
  for (const modelId of candidates) {
    if (!modelId) continue;
    try {
      return resolveModelById(modelId);
    } catch {
      continue;
    }
  }
  return undefined;
}

export function resolveContextWindow(
  profile: AgentProfile,
  resolveModelById: (modelId: string) => unknown,
  defaultModel?: string,
): number | null {
  const model = resolveModelWithFallback(profile, resolveModelById, defaultModel) as
    | { contextWindow?: number }
    | undefined;
  return model?.contextWindow ?? null;
}

export function computeTurnStats(messages: unknown[]): TurnStats {
  let turnStart = 0;
  let userMessageCount = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as { role?: string };
    if (msg?.role !== "user") continue;
    turnStart = i;
    if (!isDigestMessage(msg as Message)) userMessageCount++;
  }

  let hasUsage = false;
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let output = 0;
  for (let i = turnStart; i < messages.length; i++) {
    const msg = messages[i] as { role?: string; usage?: UsageLike };
    if (msg?.role !== "assistant" || typeof msg.usage !== "object" || msg.usage === null) continue;
    const usage = msg.usage;
    const carriesBreakdown =
      typeof usage.input === "number" ||
      typeof usage.output === "number" ||
      typeof usage.cacheRead === "number" ||
      typeof usage.cacheWrite === "number";
    if (!carriesBreakdown) continue;
    hasUsage = true;
    input += typeof usage.input === "number" ? usage.input : 0;
    cacheRead += typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
    cacheWrite += typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
    output += typeof usage.output === "number" ? usage.output : 0;
  }

  const denominator = cacheRead + input;
  return {
    cacheHitRate: hasUsage && denominator > 0 ? cacheRead / denominator : null,
    turnInputTokens: hasUsage ? input : null,
    turnCacheReadTokens: hasUsage ? cacheRead : null,
    turnCacheWriteTokens: hasUsage ? cacheWrite : null,
    turnOutputTokens: hasUsage ? output : null,
    userMessageCount,
    messageCount: messages.length,
  };
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
    ...computeTurnStats(messages),
  };
}
