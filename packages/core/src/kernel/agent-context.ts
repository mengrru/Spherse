import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { createInitialSystemMessage, toToolDeclaration } from "@earendil-works/pi-ai";

export function composeAgentMessages(
  messages: readonly AgentMessage[],
  systemPrompt: string,
  tools: readonly AgentTool[],
): AgentMessage[] {
  const system = createInitialSystemMessage(systemPrompt, tools.map(toToolDeclaration));
  const conversation = messages.filter((message) => message.role !== "system");
  return system ? [system, ...conversation] : conversation;
}
