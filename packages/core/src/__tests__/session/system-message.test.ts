import { describe, expect, it } from "vitest";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  retainLeadingSystem,
  updateLeadingSystemContent,
  withoutLeadingSystem,
} from "../../session/system-message.js";

function makeAgent(messages: AgentMessage[]): Agent {
  return new Agent({
    initialState: { messages, model: undefined as never },
    streamFn: (() => undefined) as never,
  });
}

const system = (content: string) =>
  ({ role: "system", content, timestamp: 1 }) as AgentMessage;
const user = (content: string) =>
  ({ role: "user", content, timestamp: 2 }) as AgentMessage;

describe("retainLeadingSystem", () => {
  it("keeps next unchanged when it already starts with a system message", () => {
    const next = [system("next"), user("q")];
    expect(retainLeadingSystem([system("current")], next)).toEqual(next);
  });

  it("prepends the current leading system message when next has none", () => {
    const leading = system("prompt");
    expect(retainLeadingSystem([leading, user("old")], [user("q")])).toEqual([
      leading,
      user("q"),
    ]);
  });

  it("returns next as-is when neither side has a leading system message", () => {
    expect(retainLeadingSystem([user("old")], [user("q")])).toEqual([user("q")]);
    expect(retainLeadingSystem([], [user("q")])).toEqual([user("q")]);
  });
});

describe("withoutLeadingSystem", () => {
  it("strips the leading system message", () => {
    expect(withoutLeadingSystem([system("p"), user("q")])).toEqual([user("q")]);
  });

  it("returns a copy when there is no leading system message", () => {
    const messages = [user("q")];
    const result = withoutLeadingSystem(messages);
    expect(result).toEqual(messages);
    expect(result).not.toBe(messages);
  });
});

describe("updateLeadingSystemContent", () => {
  it("replaces the content of an existing leading system message immutably", () => {
    const q = user("q");
    const agent = makeAgent([system("old"), q]);
    updateLeadingSystemContent(agent, () => "new");
    expect(agent.state.messages[0]).toMatchObject({ role: "system", content: "new" });
    expect(agent.state.messages[1]).toBe(q);
    expect(agent.state.messages).toHaveLength(2);
    expect(agent.state.systemPrompt).toBe("new");
  });

  it("is a no-op when the update returns the same text", () => {
    const agent = makeAgent([system("same"), user("q")]);
    const before = agent.state.messages;
    updateLeadingSystemContent(agent, (c) => c);
    expect(agent.state.messages).toBe(before);
  });

  it("creates a leading system message when none exists", () => {
    const q = user("q");
    const agent = makeAgent([q]);
    updateLeadingSystemContent(agent, (c) => c + "prompt");
    expect(agent.state.messages[0]).toMatchObject({ role: "system", content: "prompt" });
    expect(agent.state.messages[1]).toBe(q);
  });

  it("flattens TextContent[] content before invoking the update", () => {
    const agent = makeAgent([
      { role: "system", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }], timestamp: 1 } as never,
      user("q"),
    ]);
    updateLeadingSystemContent(agent, (c) => c.toUpperCase());
    expect(agent.state.messages[0]).toMatchObject({ role: "system", content: "AB" });
  });
});

describe("AgentRunner system message handling", () => {
  it("agent_end events dispatched through the runner filter system messages", async () => {
    const { AgentRunner } = await import("../../session/agent-runner.js");
    const seen: AgentMessage[][] = [];
    let sink: ((event: unknown) => void) | undefined;
    const fakeAgent = {
      subscribe: (fn: (event: never) => void) => {
        sink = fn as (event: unknown) => void;
        return () => {};
      },
    };
    const runner = Object.create(AgentRunner.prototype) as never as {
      subscribeAgentEvents: (this: { agent: typeof fakeAgent }, dispatch: (event: never) => void) => () => void;
    };
    const inner = (event: unknown) => {
      const e = event as { type: string; messages?: AgentMessage[] };
      if (e.type === "agent_end" && e.messages) seen.push(e.messages);
    };
    const unsub = runner.subscribeAgentEvents.call({ agent: fakeAgent }, inner as never);
    expect(typeof unsub).toBe("function");
    expect(sink).toBeTypeOf("function");

    sink?.({
      type: "agent_end",
      messages: [system("p"), user("q")],
    });
    sink?.({
      type: "message_end",
      message: system("p"),
    });
    sink?.({
      type: "message_end",
      message: user("q"),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([user("q")]);
  });

  it("getStatus counts the prompt once on the no-usage fallback path", async () => {
    const { AgentRunner } = await import("../../session/agent-runner.js");
    const { estimateTokens } = await import("../../context/token-estimate.js");
    const prompt = "You are a worldbuilding assistant with a fairly long prompt.";
    const agent = makeAgent([system(prompt), user("hello world")]);
    const status = (
      AgentRunner.prototype as unknown as {
        getStatus: (this: { agent: Agent }) => { currentTokens: number; contextWindowLimit: number | null };
      }
    ).getStatus.call({ agent });
    const expected =
      estimateTokens(prompt) + estimateTokens([user("hello world")] as never);
    expect(status.currentTokens).toBe(expected);
  });
});
