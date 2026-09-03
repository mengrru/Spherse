import { describe, expect, it } from "vitest";
import type { InteractionState } from "../types";
import { projectChatCard } from "./tool-card";

function interaction(overrides: Partial<InteractionState> & Pick<InteractionState, "kind" | "requestId" | "status">): InteractionState {
  return {
    toolCallId: "tc1",
    toolName: "ask_user",
    ...overrides,
  };
}

describe("projectChatCard", () => {
  describe("ask_user", () => {
    it("builds an answered question card when details carry an answer", () => {
      const card = projectChatCard(
        "ask_user",
        { question: "Deploy?" },
        { resultDetails: { cardType: "question", question: "Deploy?", options: ["yes", "no"], answer: "yes" } },
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
      const card = projectChatCard(
        "ask_user",
        {},
        { resultDetails: { cardType: "question", question: "Proceed?", answer: "go" } },
      );

      expect(card).toEqual({
        type: "question",
        status: "answered",
        question: "Proceed?",
        answer: "go",
      });
    });

    it("builds a timeout question card when details carry timedOut", () => {
      const card = projectChatCard(
        "ask_user",
        {},
        { resultDetails: { cardType: "question", question: "Deploy?", options: ["yes", "no"], timedOut: true } },
      );

      expect(card).toEqual({
        type: "question",
        status: "timeout",
        question: "Deploy?",
        options: ["yes", "no"],
      });
    });

    it("drops non-string option entries and empty option lists", () => {
      const card = projectChatCard(
        "ask_user",
        {},
        { resultDetails: { cardType: "question", question: "Q?", options: ["ok", 3], answer: "ok" } },
      );

      expect(card).toEqual({
        type: "question",
        status: "answered",
        question: "Q?",
        options: ["ok"],
        answer: "ok",
      });

      const emptyOptions = projectChatCard(
        "ask_user",
        {},
        { resultDetails: { cardType: "question", question: "Q?", options: [], answer: "ok" } },
      );

      expect(emptyOptions).toEqual({
        type: "question",
        status: "answered",
        question: "Q?",
        answer: "ok",
      });
    });

    it("prefers answer over timedOut when both are present", () => {
      const card = projectChatCard(
        "ask_user",
        {},
        { resultDetails: { cardType: "question", question: "Q?", answer: "yes", timedOut: true } },
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
        projectChatCard(
          "ask_user",
          {},
          { resultDetails: { cardType: "question", question: "Deploy?", options: ["yes", "no"] } },
        ),
      ).toBeUndefined();
    });

    it("produces no card for non-question details", () => {
      expect(projectChatCard("ask_user", {}, {})).toBeUndefined();
      expect(projectChatCard("ask_user", {}, { resultDetails: null })).toBeUndefined();
      expect(projectChatCard("ask_user", {}, { resultDetails: {} })).toBeUndefined();
      expect(projectChatCard("ask_user", {}, { resultDetails: { cardType: "html" } })).toBeUndefined();
      expect(projectChatCard("ask_user", {}, { resultDetails: { question: "Deploy?" } })).toBeUndefined();
    });

    it("ignores question details for other tool names", () => {
      expect(
        projectChatCard(
          "run_command",
          {},
          { resultDetails: { cardType: "question", question: "Deploy?", answer: "yes" } },
        ),
      ).toBeUndefined();
    });
  });

  describe("existing branches", () => {
    it("rebuilds an html card from render_card result details", () => {
      const card = projectChatCard(
        "render_card",
        {},
        {
          resultDetails: {
            cardType: "html",
            html: "<h1>Hi</h1>",
            title: "Hi",
            height: 300,
            max_width: 700,
            max_height: 500,
          },
        },
      );

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

    it("reconstructs inline html from arguments when details lack html and file_path", () => {
      const card = projectChatCard(
        "render_card",
        { type: "html", content: "<h1>Hi</h1>" },
        {
          resultDetails: { cardType: "html", title: "Test", width: 500, height: 400, max_width: 800, max_height: 600 },
        },
      );

      expect(card).toEqual({
        type: "html",
        html: "<h1>Hi</h1>",
        file_path: undefined,
        title: "Test",
        width: 500,
        height: 400,
        max_width: 800,
        max_height: 600,
      });
    });

    it("recovers render_card file_path card without html in details", () => {
      const card = projectChatCard(
        "render_card",
        { type: "html", file_path: "card.html" },
        {
          resultDetails: { cardType: "html", file_path: "card.html", height: 400, max_width: 800, max_height: 600 },
        },
      );

      expect(card).toEqual({
        type: "html",
        html: undefined,
        file_path: "card.html",
        title: undefined,
        width: undefined,
        height: 400,
        max_width: 800,
        max_height: 600,
      });
    });

    it("prefers legacy details.html over arguments content (backward compat)", () => {
      const card = projectChatCard(
        "render_card",
        { type: "html", content: "<h1>New</h1>" },
        {
          resultDetails: { cardType: "html", html: "<h1>Legacy</h1>", height: 400, max_width: 800, max_height: 600 },
        },
      );

      expect(card?.type === "html" ? card.html : undefined).toBe("<h1>Legacy</h1>");
    });

    it("ignores arguments.content when file_path is present (both-args edge case)", () => {
      const card = projectChatCard(
        "render_card",
        { type: "html", content: "<h1>Inline</h1>", file_path: "card.html" },
        {
          resultDetails: { cardType: "html", file_path: "card.html", height: 400, max_width: 800, max_height: 600 },
        },
      );

      expect(card?.type === "html" ? card.html : undefined).toBeUndefined();
      expect(card?.type === "html" ? card.file_path : undefined).toBe("card.html");
    });

    it("rebuilds an image card from generate_image result details", () => {
      const card = projectChatCard(
        "generate_image",
        {},
        {
          resultDetails: {
            cardType: "image",
            status: "done",
            path: "/tmp/x.png",
            prompt: "a cat",
          },
        },
      );

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
      const card = projectChatCard(
        "run_command",
        { command: "echo hi" },
        {
          resultDetails: {
            cardType: "command",
            status: "completed",
            command: "echo hi",
            stdout: "hi\n",
            stderr: "",
            exitCode: 0,
            durationMs: 12,
          },
        },
      );

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
      const card = projectChatCard(
        "run_command",
        { command: "rm -rf /" },
        { resultDetails: { rejected: true } },
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
      expect(projectChatCard("write_file", { path: "a" }, { resultDetails: { path: "a" } })).toBeUndefined();
    });
  });

  describe("interaction path", () => {
    it("builds a pending_approval command card with requestId for a pending run_command approval", () => {
      const card = projectChatCard(
        "run_command",
        { command: "echo hi" },
        {
          interaction: interaction({
            kind: "approval",
            requestId: "r1",
            toolName: "run_command",
            status: { type: "pending" },
          }),
        },
      );

      expect(card).toMatchObject({
        type: "command",
        status: "pending_approval",
        requestId: "r1",
        command: "echo hi",
      });
    });

    it("builds a rejected approval card without requestId for a rejected approval interaction", () => {
      const card = projectChatCard(
        "manage_agent",
        { name: "x" },
        {
          interaction: interaction({
            kind: "approval",
            requestId: "r2",
            toolName: "manage_agent",
            status: { type: "rejected" },
          }),
        },
      );

      expect(card).toEqual({
        type: "approval",
        status: "rejected",
        toolName: "manage_agent",
        args: { name: "x" },
      });
    });

    it("builds an answered question card with answer for an answered ask_user interaction", () => {
      const card = projectChatCard(
        "ask_user",
        { question: "Deploy?", options: ["yes", "no"] },
        {
          interaction: interaction({
            kind: "question",
            requestId: "r3",
            toolName: "ask_user",
            status: { type: "answered", answer: "yes" },
          }),
        },
      );

      expect(card).toEqual({
        type: "question",
        status: "answered",
        question: "Deploy?",
        options: ["yes", "no"],
        answer: "yes",
      });
    });
  });
});
