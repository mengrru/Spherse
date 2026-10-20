import type { Agent } from "@earendil-works/pi-agent-core";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export function isLeadingSystem(messages: readonly AgentMessage[]): boolean {
  return messages[0]?.role === "system";
}

export function retainLeadingSystem(
  current: readonly AgentMessage[],
  next: readonly AgentMessage[],
): AgentMessage[] {
  if (isLeadingSystem(next)) return [...next];
  if (isLeadingSystem(current)) return [current[0], ...next];
  return [...next];
}

export function withoutLeadingSystem(messages: readonly AgentMessage[]): AgentMessage[] {
  return isLeadingSystem(messages) ? messages.slice(1) : [...messages];
}

export function updateLeadingSystemContent(
  agent: Agent,
  update: (content: string) => string,
): void {
  const messages = agent.state.messages;
  if (isLeadingSystem(messages)) {
    const leading = messages[0] as { role: "system"; content: string | { type: "text"; text: string }[] };
    const text = typeof leading.content === "string"
      ? leading.content
      : leading.content
          .map((block) => block.text)
          .join("");
    const next = update(text);
    if (next === text) return;
    agent.state.messages = [
      { ...leading, content: next } as AgentMessage,
      ...messages.slice(1),
    ];
    return;
  }
  agent.state.messages = [
    { role: "system", content: update(""), timestamp: Date.now() } as AgentMessage,
    ...messages,
  ];
}
