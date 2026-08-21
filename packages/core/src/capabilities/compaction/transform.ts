import type { Agent } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { planCompaction } from "../../context/compaction.js";
import { estimateTokens, readCurrentTokens } from "../../context/token-estimate.js";
import type { TurnEventAppender } from "../../kernel/turn-hooks.js";
import type { Logger } from "../../logger.js";
import { deriveMessageEntries } from "../../session/fold.js";

export async function maybeCompactLog(
  eventLog: TurnEventAppender,
  agent: Agent,
  logger: Logger,
): Promise<void> {
  const projected = deriveMessageEntries(eventLog.events as never);
  const messages = projected.map((entry) => entry.message as Message);

  const currentTokens = readCurrentTokens(messages, agent.state.systemPrompt);
  const contextWindow =
    (agent.state.model as { contextWindow?: number } | undefined)?.contextWindow ?? 32768;

  const plan = planCompaction(messages, { currentTokens, contextWindow });
  if (!plan.shouldCompact || !plan.digest) return;

  const anchorSeq = projected[plan.anchorIndex]?.seq;
  if (anchorSeq === undefined) return;

  try {
    const postEstimate =
      estimateTokens(agent.state.systemPrompt) + estimateTokens(plan.tail);

    eventLog.append("compaction/applied", {
      anchorSeq,
      digestContent: plan.digest,
    });

    logger.info(
      {
        anchorSeq,
        compactedMessages: plan.anchorIndex + 1,
        tokensBefore: currentTokens,
        tokensAfter: postEstimate,
      },
      "compaction applied",
    );
  } catch (err) {
    logger.error({ err }, "compaction failed, keeping live buffer");
  }
}
