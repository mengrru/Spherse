import type { Agent } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { isDegenerateDigest, sanitizeDigestContent } from "../../context/compaction.js";
import type { Logger } from "../../logger.js";

const SUMMARIZE_TIMEOUT_MS = 60_000;

const SUMMARY_BUDGET_RATIO = 0.05;
const MIN_SUMMARY_TOKEN_BUDGET = 1500;
const MAX_SUMMARY_TOKEN_BUDGET = 16_000;

export function computeSummaryTokenBudget(currentTokens: number): number {
  if (!Number.isFinite(currentTokens)) return MAX_SUMMARY_TOKEN_BUDGET;
  const scaled = Math.round(currentTokens * SUMMARY_BUDGET_RATIO);
  return Math.min(MAX_SUMMARY_TOKEN_BUDGET, Math.max(MIN_SUMMARY_TOKEN_BUDGET, scaled));
}

export function buildSummaryInstruction(tokenBudget: number): string {
  return `Summarize this conversation to compact the context window.

- Focus on the earlier conversation; recent messages will be kept verbatim in the context.
- If the conversation already starts with a <compaction-digest> summary, integrate it as prior history instead of repeating it.
- First identify the nature of this conversation (task-oriented, emotional companionship, roleplay, or mixed), then apply matching priorities:
  - Task-oriented: preserve the user's goals, preferences and explicit instructions; key decisions and their rationale; involved file paths, data files (*.data.json) and generated artifacts (HTML pages, images); unfinished work and user expectations.
  - Emotional companionship / roleplay: preserve the relationship trajectory and how it evolved; the user's emotional context and recurring themes; key personal facts the user shared; shared jokes, nicknames and promises; unresolved emotional threads (things the user said they would follow up on). Do NOT strip these as "irrelevant exploration" — in this mode they are the substance of the conversation.
- Drop: greetings, raw tool output details, and exploration irrelevant to the conversation's purpose.
- Do not call any tool. Output the summary directly.
- Output structured Markdown, at most ${tokenBudget} tokens.
- Write the summary in the dominant language of the user's messages.`;
}

export interface SummarizeDeps {
  logger: Logger;
}

export interface SummarizeResult {
  digest: string;
}

export interface SummarizeOptions {
  currentTokens?: number;
}

export async function summarizeForCompaction(
  agent: Agent,
  foldMessages: Message[],
  sessionId: string,
  deps: SummarizeDeps,
  options: SummarizeOptions = {},
): Promise<SummarizeResult | null> {
  const model = agent.state.model;
  const streamFn = agent.streamFunction;
  if (!model || !streamFn) return null;

  const tokenBudget =
    options.currentTokens === undefined
      ? MAX_SUMMARY_TOKEN_BUDGET
      : computeSummaryTokenBudget(options.currentTokens);
  const modelMaxTokens = (model as { maxTokens?: number }).maxTokens;
  const maxTokens =
    modelMaxTokens === undefined ? tokenBudget : Math.min(tokenBudget, modelMaxTokens);
  const instruction = buildSummaryInstruction(maxTokens);

  const llmMessages = await agent.convertToLlm(foldMessages as never);
  const context = {
    systemPrompt: agent.state.systemPrompt,
    tools: agent.state.tools,
    messages: [...llmMessages, { role: "user", content: instruction } as Message],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARIZE_TIMEOUT_MS);

  try {
    const stream = await streamFn(model, context, {
      sessionId,
      maxTokens,
      signal: controller.signal,
    });
    const finalMessage = (await stream.result()) as {
      stopReason?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    if (finalMessage.stopReason === "error" || finalMessage.stopReason === "aborted") {
      return null;
    }
    if (finalMessage.stopReason === "length") {
      deps.logger.warn(
        { sessionId, maxTokens },
        "compaction summary hit the token budget, digest may be truncated",
      );
    }

    const text = (finalMessage.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("")
      .trim();
    if (isDegenerateDigest(text)) return null;

    return { digest: sanitizeDigestContent(text) };
  } catch (err) {
    deps.logger.warn({ err, sessionId }, "llm compaction summary failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
