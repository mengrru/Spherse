import type { Agent } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { generateDigest, planCompaction, sanitizeDigestContent, sanitizeToolCallPairs } from "../../context/compaction.js";
import { estimateTokens, readCurrentTokens } from "../../context/token-estimate.js";
import type { TurnEventAppender } from "../../kernel/turn-hooks.js";
import { deriveMessageEntries } from "../../session/fold.js";
import { summarizeForCompaction, type SummarizeDeps } from "./summarize.js";

const HARD_LIMIT_RATIO = 0.9;

export type MaybeCompactDeps = SummarizeDeps;

export async function maybeCompactLog(
  eventLog: TurnEventAppender,
  agent: Agent,
  sessionId: string,
  deps: MaybeCompactDeps,
): Promise<void> {
  const logger = deps.logger;
  const projected = deriveMessageEntries(eventLog.events as never);
  const messages = projected.map((entry) => entry.message as Message);

  const currentTokens = readCurrentTokens(messages, agent.state.systemPrompt);
  const contextWindow =
    (agent.state.model as { contextWindow?: number } | undefined)?.contextWindow ?? 32768;

  const plan = planCompaction(messages, { currentTokens, contextWindow });
  if (!plan.shouldCompact) return;

  const anchorSeq = projected[plan.anchorIndex]?.seq;
  if (anchorSeq === undefined) return;

  try {
    const sanitized = sanitizeToolCallPairs(plan.tail);
    const keptIndices = new Set(sanitized.keptIndices);
    const excludedSeqs = plan.tail.flatMap((_, index) => {
      if (keptIndices.has(index)) return [];
      const seq = projected[plan.anchorIndex + 1 + index]?.seq;
      return seq === undefined ? [] : [seq];
    });

    const summary = await summarizeForCompaction(agent, messages, sessionId, deps);
    let digestContent: string;
    let digestSource: "llm" | "mechanical";
    if (summary) {
      digestContent = summary.digest;
      digestSource = "llm";
    } else if (currentTokens > contextWindow * HARD_LIMIT_RATIO) {
      digestContent = sanitizeDigestContent(generateDigest(messages.slice(0, plan.anchorIndex + 1)));
      digestSource = "mechanical";
    } else {
      logger.warn({ sessionId }, "llm summary unavailable, skipping compaction this turn");
      return;
    }

    const postEstimate =
      estimateTokens(agent.state.systemPrompt) + estimateTokens(sanitized.messages);

    eventLog.append("compaction/applied", {
      anchorSeq,
      digestContent,
      excludedSeqs,
      digestSource,
    });

    logger.info(
      {
        anchorSeq,
        compactedMessages: plan.anchorIndex + 1,
        tokensBefore: currentTokens,
        tokensAfter: postEstimate,
        digestSource,
      },
      "compaction applied",
    );
  } catch (err) {
    logger.error({ err }, "compaction failed, keeping live buffer");
  }
}
