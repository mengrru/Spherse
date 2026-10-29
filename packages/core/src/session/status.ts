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
  turnInputTokens: number;
  turnCacheReadTokens: number;
  turnCacheWriteTokens: number;
  turnOutputTokens: number;
  userMessageCount: number;
  messageCount: number;
}

export interface TurnStats {
  cacheHitRate: number | null;
  turnInputTokens: number;
  turnCacheReadTokens: number;
  turnCacheWriteTokens: number;
  turnOutputTokens: number;
  userMessageCount: number;
  messageCount: number;
}

interface UsageLike {
  totalTokens?: unknown;
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
    if (msg?.role !== "assistant" || typeof msg.usage?.totalTokens !== "number") continue;
    hasUsage = true;
    input += typeof msg.usage.input === "number" ? msg.usage.input : 0;
    cacheRead += typeof msg.usage.cacheRead === "number" ? msg.usage.cacheRead : 0;
    cacheWrite += typeof msg.usage.cacheWrite === "number" ? msg.usage.cacheWrite : 0;
    output += typeof msg.usage.output === "number" ? msg.usage.output : 0;
  }

  const denominator = cacheRead + input;
  return {
    cacheHitRate: hasUsage && denominator > 0 ? cacheRead / denominator : null,
    turnInputTokens: input,
    turnCacheReadTokens: cacheRead,
    turnCacheWriteTokens: cacheWrite,
    turnOutputTokens: output,
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
