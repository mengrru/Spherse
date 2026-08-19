import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { compactLog, type MessageLog } from "../../kernel/message-log.js";
import {
  planCompaction,
  sanitizeToolCallPairs,
  wrapDigestContent,
} from "../../context/compaction.js";
import { estimateTokens } from "../../context/token-estimate.js";
import { readCurrentTokens } from "../../context/token-estimate.js";
import type { SessionStore } from "../../store/session.js";
import type { Logger } from "../../logger.js";

export async function maybeCompactLog(
  log: MessageLog,
  agent: Agent,
  sessionStore: SessionStore,
  sessionId: string,
  logger: Logger,
): Promise<MessageLog> {
  const currentTokens = readCurrentTokens(
    [...log.entries.map((e) => e.message)],
    agent.state.systemPrompt,
  );
  const contextWindow = (agent.state.model as { contextWindow?: number } | undefined)?.contextWindow ?? 32768;

  const plan = planCompaction(
    log.entries.map((e) => e.message) as Message[],
    { currentTokens, contextWindow },
  );

  if (!plan.shouldCompact || !plan.digest) return log;

  const anchorEntry = log.entries[plan.anchorIndex];
  if (!anchorEntry || anchorEntry.dbId === null) return log;

  try {
    const { messages: sanitizedTail, keptIndices } = sanitizeToolCallPairs(plan.tail);

    const digestMessage: AgentMessage = {
      role: "user",
      content: wrapDigestContent(plan.digest),
      timestamp: Date.now(),
    } as unknown as AgentMessage;
    const next = compactLog(log, {
      anchorIndex: plan.anchorIndex,
      digestMessage,
      tail: keptIndices.map((index, i) => ({ index, message: sanitizedTail[i] })),
    });

    const postEstimate =
      estimateTokens(agent.state.systemPrompt) +
      estimateTokens(next.entries.map((e) => e.message) as Message[]);

    sessionStore.recordCompaction(sessionId, {
      anchorMessageId: anchorEntry.dbId,
      digestContent: plan.digest,
      tokenEstimate: postEstimate,
    });

    logger.info(
      {
        sessionId,
        anchorMessageId: anchorEntry.dbId,
        compactedMessages: plan.anchorIndex + 1,
        tokensBefore: currentTokens,
        tokensAfter: postEstimate,
      },
      "compaction applied",
    );
    return next;
  } catch (err) {
    logger.error({ err, sessionId }, "compaction failed, keeping live buffer");
    return log;
  }
}
