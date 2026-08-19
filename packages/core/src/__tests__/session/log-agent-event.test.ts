import { describe, expect, it, vi } from "vitest";
import { logAgentEvent } from "../../session/log-agent-event.js";
import type { Logger } from "../../logger.js";
import type { AgentEvent } from "@earendil-works/pi-agent-core";

function createMockLogger(): {
  logger: Logger;
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const debug = vi.fn();
  const trace = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const logger = {
    level: "debug",
    info,
    debug,
    trace,
    warn,
    error,
    fatal: vi.fn(),
    silent: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
  return { logger, info, debug, trace, warn, error };
}

describe("logAgentEvent", () => {
  it("logs agent_start at info level", () => {
    const { logger, info } = createMockLogger();
    logAgentEvent(logger, { type: "agent_start" } as AgentEvent);
    expect(info).toHaveBeenCalledWith({ event: "agent_start" }, "agent run started");
  });

  it("logs agent_end at info level", () => {
    const { logger, info } = createMockLogger();
    logAgentEvent(logger, { type: "agent_end", messages: [] } as AgentEvent);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent_end" }),
      "agent run ended",
    );
  });

  it("logs turn_start at debug level", () => {
    const { logger, debug } = createMockLogger();
    logAgentEvent(logger, { type: "turn_start" } as AgentEvent);
    expect(debug).toHaveBeenCalledWith({ event: "turn_start" }, "turn started");
  });

  it("logs turn_end at debug level with toolCount", () => {
    const { logger, debug } = createMockLogger();
    logAgentEvent(logger, {
      type: "turn_end",
      message: {} as any,
      toolResults: [{}, {}],
    } as AgentEvent);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: "turn_end", toolCount: 2 }),
      "turn ended",
    );
  });

  it("logs message_start at debug level", () => {
    const { logger, debug } = createMockLogger();
    logAgentEvent(logger, {
      type: "message_start",
      message: { id: "msg-1" } as any,
    } as AgentEvent);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: "message_start", messageId: "msg-1" }),
      "message streaming",
    );
  });

  it("logs message_end at debug level", () => {
    const { logger, debug } = createMockLogger();
    logAgentEvent(logger, {
      type: "message_end",
      message: { id: "msg-1", usage: { totalTokens: 100 } } as any,
    } as AgentEvent);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: "message_end" }),
      "message complete",
    );
  });

  it("does not log message_update", () => {
    const { logger, info, debug, trace } = createMockLogger();
    logAgentEvent(logger, { type: "message_update" } as AgentEvent);
    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(trace).not.toHaveBeenCalled();
  });

  it("logs tool_execution_start at info level with truncated args", () => {
    const { logger, info } = createMockLogger();
    const longArgs = "x".repeat(600);
    logAgentEvent(logger, {
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "write_file",
      args: longArgs,
    } as AgentEvent);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "write_file",
        args: "x".repeat(500),
      }),
      "tool started",
    );
  });

  it("logs tool_execution_end at info level with truncated resultSummary", () => {
    const { logger, info } = createMockLogger();
    const longResult = "y".repeat(600);
    logAgentEvent(logger, {
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "read_file",
      result: longResult,
      isError: false,
    } as AgentEvent);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "read_file",
        isError: false,
        resultSummary: "y".repeat(500),
      }),
      "tool completed",
    );
  });

  it("logs tool_execution_update at trace level", () => {
    const { logger, trace } = createMockLogger();
    logAgentEvent(logger, {
      type: "tool_execution_update",
      toolCallId: "tc-1",
      toolName: "render_card",
      args: {},
      partialResult: "partial",
    } as AgentEvent);
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_execution_update",
        toolCallId: "tc-1",
        partialResult: "partial",
      }),
      "tool partial",
    );
  });
});
