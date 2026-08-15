import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const MIN_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 3600;
const DEFAULT_TIMEOUT_S = 600;

export interface AskOutcome {
  answer?: string;
  timedOut: boolean;
}

export interface AskGate {
  ask(
    req: { requestId: string; toolCallId: string; toolName: string; args: unknown },
    timeoutMs: number,
  ): Promise<AskOutcome>;
}

export interface AskUserDetails {
  cardType: "question";
  question: string;
  options?: string[];
  answer?: string;
  timedOut?: boolean;
}

const AskUserParams = Type.Object({
  question: Type.String({
    description:
      "The question to ask the user. One focused, self-contained question phrased so the user can answer without extra context.",
  }),
  options: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 2,
      maxItems: 6,
      description:
        "Optional 2-6 candidate answers for the user to pick from. Omit for a free-form answer. Do not preselect or mark defaults.",
    }),
  ),
  timeout_s: Type.Optional(
    Type.Number({
      description: `How long to wait for the answer, in seconds. Default ${DEFAULT_TIMEOUT_S}, min ${MIN_TIMEOUT_S}, max ${MAX_TIMEOUT_S}.`,
    }),
  ),
});

function clampTimeoutS(v: number | undefined): number {
  const n = v ?? DEFAULT_TIMEOUT_S;
  return Math.min(Math.max(Math.trunc(n), MIN_TIMEOUT_S), MAX_TIMEOUT_S);
}

function sanitizeOptions(options: unknown): string[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const kept = options.filter((o): o is string => typeof o === "string");
  return kept.length >= 2 ? kept : undefined;
}

function formatMinutes(timeoutS: number): string {
  const minutes = timeoutS / 60;
  const value = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return `${value} minute${value === "1" ? "" : "s"}`;
}

export function createAskUserTool(askGate?: AskGate): AgentTool<typeof AskUserParams, AskUserDetails> {
  return {
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user a question and wait for their answer. Only use this tool when you are truly blocked and only the user can provide the needed information. Do not use it to confirm actions or plans — just proceed. Do not ask about anything you can find out yourself with tools. In background or automated runs, do not ask. If the user does not answer within the timeout, continue with your best judgment instead of re-asking.",
    parameters: AskUserParams,
    executionMode: "sequential",
    async execute(toolCallId, params, signal) {
      const question = params.question;
      const options = sanitizeOptions(params.options);
      const timeoutS = clampTimeoutS(params.timeout_s);

      if (signal?.aborted) {
        return abortedResult(question, options);
      }

      if (!askGate) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Asking the user is unavailable in this session. Continue with your best judgment.",
            },
          ],
          details: { cardType: "question", question, options },
        };
      }

      let outcome: AskOutcome;
      try {
        outcome = await askGate.ask(
          {
            requestId: crypto.randomUUID(),
            toolCallId,
            toolName: "ask_user",
            args: params,
          },
          timeoutS * 1000,
        );
      } catch {
        return abortedResult(question, options);
      }

      if (outcome.timedOut || outcome.answer === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: `User did not answer within ${formatMinutes(timeoutS)}. Continue with your best judgment; do not call ask_user again for this question in this run.`,
            },
          ],
          details: { cardType: "question", question, options, timedOut: true },
        };
      }

      return {
        content: [{ type: "text" as const, text: `User's answer:\n${outcome.answer}` }],
        details: { cardType: "question", question, options, answer: outcome.answer },
      };
    },
  };
}

function abortedResult(
  question: string,
  options?: string[],
): { content: { type: "text"; text: string }[]; details: AskUserDetails } {
  return {
    content: [{ type: "text" as const, text: "Question cancelled: the session was aborted before the user answered." }],
    details: { cardType: "question", question, options },
  };
}
