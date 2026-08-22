import type { Agent, StreamFn } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { isDegenerateDigest, sanitizeDigestContent } from "../../context/compaction.js";
import type { Logger } from "../../logger.js";

const SUMMARIZE_TIMEOUT_MS = 60_000;

export const SUMMARY_INSTRUCTION = `Summarize this conversation to compact the context window.

- Focus on the earlier conversation; recent messages will be kept verbatim in the context.
- If the conversation already starts with a <compaction-digest> summary, integrate it as prior history instead of repeating it.
- First identify the nature of this conversation (task-oriented, emotional companionship, roleplay, or mixed), then apply matching priorities:
  - Task-oriented: preserve the user's goals, preferences and explicit instructions; key decisions and their rationale; involved file paths, data files (*.data.json) and generated artifacts (HTML pages, images); unfinished work and user expectations.
  - Emotional companionship / roleplay: preserve the relationship trajectory and how it evolved; the user's emotional context and recurring themes; key personal facts the user shared; shared jokes, nicknames and promises; unresolved emotional threads (things the user said they would follow up on). Do NOT strip these as "irrelevant exploration" — in this mode they are the substance of the conversation.
- Drop: greetings, raw tool output details, and exploration irrelevant to the conversation's purpose.
- Do not call any tool. Output the summary directly.
- Output structured Markdown, at most 3000 tokens.
- Write the summary in the dominant language of the user's messages.`;

export interface SummarizeDeps {
  getChatStreamFn: (sampling?: { temperature?: number }) => StreamFn;
  logger: Logger;
}

export interface SummarizeResult {
  digest: string;
}

export async function summarizeForCompaction(
  agent: Agent,
  foldMessages: Message[],
  sessionId: string,
  deps: SummarizeDeps,
): Promise<SummarizeResult | null> {
  const model = agent.state.model;
  if (!model) return null;

  const streamFn = deps.getChatStreamFn({ temperature: 0.2 });
  const context = {
    systemPrompt: agent.state.systemPrompt,
    tools: agent.state.tools,
    messages: [...foldMessages, { role: "user", content: SUMMARY_INSTRUCTION } as Message],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARIZE_TIMEOUT_MS);

  try {
    const stream = await streamFn(model, context, {
      sessionId,
      signal: controller.signal,
    });
    const finalMessage = (await stream.result()) as {
      stopReason?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    if (finalMessage.stopReason !== "completed") return null;

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

