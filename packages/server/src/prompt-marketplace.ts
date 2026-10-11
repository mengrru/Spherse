import { schemas, parseContract } from "@spherse/contracts";
import type { MarketplacePromptManifestResponse } from "@spherse/contracts";
import { OSS_BUCKET_BASE_URL, marketplaceUserAgent } from "./marketplace.js";
import { HttpError } from "./errors.js";

export const PROMPTS_BASE_URL =
  process.env.SPHERSE_PROMPT_MARKETPLACE_BASE_URL ??
  `${OSS_BUCKET_BASE_URL}/prompts`;

const PROMPTS_CACHE_TTL_MS = 30_000;
const PROMPTS_FETCH_TIMEOUT_MS = 10_000;
const MAX_PROMPTS_JSON_BYTES = 5 * 1024 * 1024;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface PromptMarketplaceService {
  getPrompts(language: string): Promise<MarketplacePromptManifestResponse>;
}

export function promptFallbackChain(language: string): string[] {
  const isZhFamily = language === "zh" || language.startsWith("zh-");
  const chain = [language];
  if (isZhFamily && language !== "zh-cn") chain.push("zh-cn");
  if (!chain.includes("en-us")) chain.push("en-us");
  if (!chain.includes("zh-cn")) chain.push("zh-cn");
  return chain;
}

interface PromptMarketplaceServiceOptions {
  fetchFn?: FetchLike;
  baseUrl?: string;
  cacheTtlMs?: number;
}

export function createPromptMarketplaceService(
  options?: PromptMarketplaceServiceOptions,
): PromptMarketplaceService {
  const fetchFn = options?.fetchFn ?? ((url, init) => fetch(url, init));
  const baseUrl = (options?.baseUrl ?? PROMPTS_BASE_URL).replace(/\/+$/, "");
  const cacheTtlMs = options?.cacheTtlMs ?? PROMPTS_CACHE_TTL_MS;
  const cache = new Map<string, { manifest: MarketplacePromptManifestResponse; expiresAt: number }>();
  const inFlight = new Map<string, Promise<MarketplacePromptManifestResponse>>();

  async function fetchLanguageManifest(language: string): Promise<MarketplacePromptManifestResponse | null> {
    const url = `${baseUrl}/${language}.json`;
    let res: Response;
    try {
      res = await fetchFn(url, {
        signal: AbortSignal.timeout(PROMPTS_FETCH_TIMEOUT_MS),
        redirect: "error",
        headers: { "User-Agent": marketplaceUserAgent() },
      });
    } catch (err: unknown) {
      throw new HttpError(502, `Prompt marketplace fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new HttpError(502, `Prompt marketplace fetch failed: HTTP ${res.status}`);
    }
    const declaredLength = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROMPTS_JSON_BYTES) {
      throw new HttpError(502, `Prompt marketplace payload exceeds size limit (${declaredLength} bytes)`);
    }
    let text: string;
    try {
      text = await readBodyWithLimit(res);
    } catch (err: unknown) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Prompt marketplace fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err: unknown) {
      throw new HttpError(502, `Prompt marketplace payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      return parseContract(schemas.marketplacePromptManifestResponse, data);
    } catch (err: unknown) {
      throw new HttpError(502, `Prompt marketplace payload is invalid: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function readBodyWithLimit(res: Response): Promise<string> {
    if (!res.body) throw new HttpError(502, "Prompt marketplace fetch returned no body");
    const decoder = new TextDecoder();
    let received = 0;
    let text = "";
    for await (const chunk of res.body) {
      received += chunk.byteLength;
      if (received > MAX_PROMPTS_JSON_BYTES) {
        throw new HttpError(502, `Prompt marketplace payload exceeds size limit (${MAX_PROMPTS_JSON_BYTES} bytes)`);
      }
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    if (received === 0) throw new HttpError(502, "Prompt marketplace payload is empty");
    return text;
  }

  async function resolvePrompts(language: string): Promise<MarketplacePromptManifestResponse> {
    for (const candidate of promptFallbackChain(language)) {
      const manifest = await fetchLanguageManifest(candidate);
      if (manifest) {
        cache.set(language, { manifest, expiresAt: Date.now() + cacheTtlMs });
        return manifest;
      }
    }
    throw new HttpError(404, `No prompt templates available for language "${language}" or its fallbacks`);
  }

  return {
    getPrompts(language: string): Promise<MarketplacePromptManifestResponse> {
      const cached = cache.get(language);
      if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.manifest);
      const existing = inFlight.get(language);
      if (existing) return existing;
      const promise = resolvePrompts(language).finally(() => {
        inFlight.delete(language);
      });
      inFlight.set(language, promise);
      return promise;
    },
  };
}

export const promptMarketplaceService: PromptMarketplaceService = createPromptMarketplaceService();
