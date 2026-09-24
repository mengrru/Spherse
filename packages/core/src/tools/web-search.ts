import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { providerEnvKey } from "../model-providers/catalog.js";

export const WEB_SEARCH_TOOL_NAME = "web_search";

const DEEPSEEK_MESSAGES_URL = "https://api.deepseek.com/anthropic/v1/messages";
const SEARCH_MODEL = "deepseek-v4-flash";
const MAX_USES = 5;
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 90_000;
const ERROR_BODY_LIMIT = 500;

const WebSearchParams = Type.Object({
  query: Type.String({ minLength: 2, description: "The search query" }),
});

export interface WebSearchSource {
  title: string;
  url: string;
}

export interface WebSearchResult {
  summary: string;
  queries: string[];
  sources: WebSearchSource[];
  errors: string[];
  searchCount: number;
}

export interface WebSearchDetails {
  query: string;
  queries: string[];
  sources: WebSearchSource[];
  searchCount: number;
}

export interface WebSearchDeps {
  fetch?: typeof fetch;
  getApiKey?: () => string | undefined;
  now?: () => Date;
  timeoutMs?: number;
}

export function readDeepSeekApiKey(): string | undefined {
  const envName = providerEnvKey("deepseek");
  const value = envName ? process.env[envName] : undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWebSearchResponse(body: unknown): WebSearchResult {
  const result: WebSearchResult = { summary: "", queries: [], sources: [], errors: [], searchCount: 0 };
  if (!isRecord(body)) return result;

  const texts: string[] = [];
  const seen = new Set<string>();
  const content = Array.isArray(body.content) ? body.content : [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      const text = block.text.trim();
      if (text.length > 0) texts.push(text);
    } else if (block.type === "server_tool_use") {
      const input = block.input;
      if (isRecord(input) && typeof input.query === "string") result.queries.push(input.query);
    } else if (block.type === "web_search_tool_result") {
      const items = block.content;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!isRecord(item) || item.type !== "web_search_result" || typeof item.url !== "string") continue;
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          result.sources.push({ title: typeof item.title === "string" ? item.title : item.url, url: item.url });
        }
      } else if (isRecord(items)) {
        result.errors.push(typeof items.error_code === "string" ? items.error_code : "unknown_error");
      }
    }
  }
  result.summary = texts.join("\n\n");

  const usage = body.usage;
  if (isRecord(usage) && isRecord(usage.server_tool_use)) {
    const count = usage.server_tool_use.web_search_requests;
    if (typeof count === "number") result.searchCount = count;
  }
  return result;
}

const NO_SEARCH_NOTE =
  "Note: no web search was actually performed; the following comes from the search model's own knowledge and may be outdated.";

function escapeLinkText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[[\]]/g, "\\$&");
}

function escapeLinkUrl(url: string): string {
  return url.replace(/[()\s]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

export function formatWebSearchResult(result: WebSearchResult): string {
  const parts: string[] = [];
  if (result.searchCount === 0 && result.sources.length === 0) parts.push(NO_SEARCH_NOTE);
  if (result.summary) parts.push(result.summary);
  if (result.sources.length > 0) {
    const lines = result.sources.map(
      (source) => `- [${escapeLinkText(source.title)}](${escapeLinkUrl(source.url)})`,
    );
    parts.push(`Sources:\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MIN_SCRUB_LENGTH = 8;

function scrub(text: string, apiKey: string): string {
  if (apiKey.length < MIN_SCRUB_LENGTH) return text;
  return text.split(apiKey).join("[redacted]");
}

async function readErrorMessage(response: Response, apiKey: string): Promise<string> {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    return "";
  }
  return scrub(extractErrorMessage(raw) ?? raw, apiKey).slice(0, ERROR_BODY_LIMIT);
}

function extractErrorMessage(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string") {
    return parsed.error.message;
  }
  return undefined;
}

export function buildWebSearchRequest(query: string, now: Date) {
  return {
    model: SEARCH_MODEL,
    max_tokens: MAX_TOKENS,
    stream: false,
    thinking: { type: "disabled" },
    system: `You are an assistant for performing a web search tool use. Today's date is ${localDate(now)}.`,
    messages: [{ role: "user", content: `Perform a web search for the query: ${query}` }],
    tools: [{ type: "web_search_20250305", name: WEB_SEARCH_TOOL_NAME, max_uses: MAX_USES }],
  };
}

export function createWebSearchTool(deps: WebSearchDeps = {}): AgentTool<typeof WebSearchParams> {
  const doFetch = deps.fetch ?? fetch;
  const getApiKey = deps.getApiKey ?? readDeepSeekApiKey;
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  return {
    name: WEB_SEARCH_TOOL_NAME,
    label: "Web Search",
    description:
      "Search the web for up-to-date information (news, recent events, current versions/prices, facts beyond your knowledge cutoff). Returns a summary of the search results and a list of source URLs. Cite the relevant sources in your answer. Each call costs extra tokens, so avoid repeating searches for the same question.",
    parameters: WebSearchParams,
    async execute(_toolCallId, params, signal) {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error("Web search is not available: DeepSeek API Key is not configured in settings.");
      }

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combined = AbortSignal.any(signal ? [timeoutSignal, signal] : [timeoutSignal]);

      const fail = (err: unknown, prefix: string): Error => {
        if (signal?.aborted) return new Error("Web search was aborted.");
        if (timeoutSignal.aborted) return new Error(`Web search timed out after ${Math.round(timeoutMs / 1000)}s.`);
        const message = err instanceof Error ? err.message : String(err);
        return new Error(scrub(`${prefix}: ${message}`, apiKey));
      };

      let response: Response;
      try {
        response = await doFetch(DEEPSEEK_MESSAGES_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(buildWebSearchRequest(params.query, now())),
          signal: combined,
        });
      } catch (err) {
        throw fail(err, "Web search request failed");
      }

      if (!response.ok) {
        const detail = await readErrorMessage(response, apiKey);
        throw new Error(`Web search failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (err) {
        throw fail(err, "Web search failed: invalid JSON response");
      }

      const result = parseWebSearchResponse(body);
      if (!result.summary && result.sources.length === 0) {
        const reason = result.errors.length > 0 ? `: ${result.errors.join(", ")}` : "";
        throw new Error(`Web search returned no results${reason}.`);
      }

      const details: WebSearchDetails = {
        query: params.query,
        queries: result.queries,
        sources: result.sources,
        searchCount: result.searchCount,
      };
      return {
        content: [{ type: "text" as const, text: formatWebSearchResult(result) }],
        details,
      };
    },
  };
}
