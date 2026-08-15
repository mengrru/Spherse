import { describe, expect, it } from "vitest";
import type { ToolCall as AgentToolCall } from "@spherse/core";
import { buildCardFromToolResult } from "./chat-tool-projection";

function toolCall(name: string, args: Record<string, unknown> = {}): AgentToolCall {
  return { type: "toolCall", id: "tc1", name, arguments: args };
}

describe("buildCardFromToolResult", () => {
  describe("ask_user", () => {
    it("builds an answered question card when details carry an answer", () => {
      const card = buildCardFromToolResult(
        "ask_user",
        toolCall("ask_user", { question: "Deploy?" }),
        { cardType: "question", question: "Deploy?", options: ["yes", "no"], answer: "yes" },
      );

      expect(card).toEqual({
        type: "question",
        status: "answered",
        question: "Deploy?",
        options: ["yes", "no"],
        answer: "yes",
      });
    });

    it("builds an answered question card without options when options are absent", () => {
      const card = buildCardFromToolResult(
        "ask_user",
        toolCall("ask_user"),
        { cardType: "question", question: "Proceed?", answer: "go" },
      );

      expect(card).toEqual({
        type: "question",
        status: "answered",
        question: "Proceed?",
        answer: "go",
      });
    });

    it("builds a timeout question card when details carry timedOut", () => {
      const card = buildCardFromToolResult(
        "ask_user",
        toolCall("ask_user"),
        { cardType: "question", question: "Deploy?", options: ["yes", "no"], timedOut: true },
      );

      expect(card).toEqual({
        type: "question",
        status: "timeout",
        question: "Deploy?",
        options: ["yes", "no"],
      });
    });

    it("drops non-string option entries and empty option lists", () => {
      const card = buildCardFromToolResult(
        "ask_user",
        toolCall("ask_user"),
        { cardType: "question", question: "Q?", options: ["ok", 3], answer: "ok" },
      );

      expect(card).toEqual({
        type: "question",
        status: "answered",
        question: "Q?",
        options: ["ok"],
        answer: "ok",
      });

      const emptyOptions = buildCardFromToolResult(
        "ask_user",
        toolCall("ask_user"),
        { cardType: "question", question: "Q?", options: [], answer: "ok" },
      );

      expect(emptyOptions).toEqual({
        type: "question",
        status: "answered",
        question: "Q?",
        answer: "ok",
      });
    });

    it("prefers answer over timedOut when both are present", () => {
      const card = buildCardFromToolResult(
        "ask_user",
        toolCall("ask_user"),
        { cardType: "question", question: "Q?", answer: "yes", timedOut: true },
      );

      expect(card).toEqual({
        type: "question",
        status: "answered",
        question: "Q?",
        answer: "yes",
      });
    });

    it("produces no card for question details without answer or timedOut (aborted)", () => {
      expect(
        buildCardFromToolResult("ask_user", toolCall("ask_user"), {
          cardType: "question",
          question: "Deploy?",
          options: ["yes", "no"],
        }),
      ).toBeUndefined();
    });

    it("produces no card for non-question details", () => {
      expect(buildCardFromToolResult("ask_user", toolCall("ask_user"), undefined)).toBeUndefined();
      expect(buildCardFromToolResult("ask_user", toolCall("ask_user"), null)).toBeUndefined();
      expect(buildCardFromToolResult("ask_user", toolCall("ask_user"), {})).toBeUndefined();
      expect(
        buildCardFromToolResult("ask_user", toolCall("ask_user"), { cardType: "html" }),
      ).toBeUndefined();
      expect(
        buildCardFromToolResult("ask_user", toolCall("ask_user"), { question: "Deploy?" }),
      ).toBeUndefined();
    });

    it("ignores question details for other tool names", () => {
      expect(
        buildCardFromToolResult("run_command", toolCall("run_command"), {
          cardType: "question",
          question: "Deploy?",
          answer: "yes",
        }),
      ).toBeUndefined();
    });
  });

  describe("existing branches", () => {
    it("rebuilds an html card from render_card result details", () => {
      const card = buildCardFromToolResult("render_card", toolCall("render_card"), {
        cardType: "html",
        html: "<h1>Hi</h1>",
        title: "Hi",
        height: 300,
        max_width: 700,
        max_height: 500,
      });

      expect(card).toEqual({
        type: "html",
        html: "<h1>Hi</h1>",
        file_path: undefined,
        title: "Hi",
        width: undefined,
        height: 300,
        max_width: 700,
        max_height: 500,
      });
    });

    it("rebuilds an image card from generate_image result details", () => {
      const card = buildCardFromToolResult("generate_image", toolCall("generate_image"), {
        cardType: "image",
        status: "done",
        path: "/tmp/x.png",
        prompt: "a cat",
      });

      expect(card).toEqual({
        type: "image",
        status: "done",
        path: "/tmp/x.png",
        prompt: "a cat",
        model: undefined,
        mimeType: undefined,
        errorMessage: undefined,
      });
    });

    it("rebuilds a completed command card from run_command result details", () => {
      const card = buildCardFromToolResult("run_command", toolCall("run_command", { command: "echo hi" }), {
        cardType: "command",
        status: "completed",
        command: "echo hi",
        stdout: "hi\n",
        stderr: "",
        exitCode: 0,
        durationMs: 12,
      });

      expect(card).toEqual({
        type: "command",
        status: "completed",
        command: "echo hi",
        cwd: undefined,
        stdout: "hi\n",
        stderr: "",
        exitCode: 0,
        durationMs: 12,
      });
    });

    it("rebuilds a rejected command card from run_command rejected details", () => {
      const card = buildCardFromToolResult(
        "run_command",
        toolCall("run_command", { command: "rm -rf /" }),
        { rejected: true },
      );

      expect(card).toEqual({
        type: "command",
        status: "error",
        rejected: true,
        command: "rm -rf /",
        stdout: "",
        stderr: "",
      });
    });

    it("returns undefined for unknown tool names", () => {
      expect(buildCardFromToolResult("write_file", toolCall("write_file"), { path: "a" })).toBeUndefined();
    });
  });
});
