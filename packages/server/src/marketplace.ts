import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import { schemas, parseContract } from "@spherse/contracts";
import type {
  MarketplaceManifestResponse,
  MarketplaceSkillEntry,
} from "@spherse/contracts";
import { getAppVersion } from "./server-info.js";
import { HttpError } from "./errors.js";

export const MARKETPLACE_MANIFEST_URL =
  process.env.SPHERSE_MARKETPLACE_MANIFEST_URL ??
  "https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse/skills/manifest.json";

const MANIFEST_CACHE_TTL_MS = 30_000;
const MANIFEST_FETCH_TIMEOUT_MS = 10_000;
const ZIP_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_SKILL_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export function marketplaceUserAgent(): string {
  const version = getAppVersion()?.trim() || "dev";
  return `spherse-marketplace/${version} (${os.platform()} ${os.release()})`;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface MarketplaceService {
  getManifest(): Promise<MarketplaceManifestResponse>;
  downloadSkillZip(entry: MarketplaceSkillEntry): Promise<string>;
}

export function createMarketplaceService(options?: {
  fetchFn?: FetchLike;
  manifestUrl?: string;
  cacheTtlMs?: number;
}): MarketplaceService {
  const fetchFn = options?.fetchFn ?? ((url, init) => fetch(url, init));
  const manifestUrl = options?.manifestUrl ?? MARKETPLACE_MANIFEST_URL;
  const cacheTtlMs = options?.cacheTtlMs ?? MANIFEST_CACHE_TTL_MS;
  let cache: { manifest: MarketplaceManifestResponse; expiresAt: number } | null = null;
  let inFlight: Promise<MarketplaceManifestResponse> | null = null;

  function getManifest(): Promise<MarketplaceManifestResponse> {
    if (cache && cache.expiresAt > Date.now()) return Promise.resolve(cache.manifest);
    if (inFlight) return inFlight;
    inFlight = fetchManifest().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function fetchManifest(): Promise<MarketplaceManifestResponse> {
    let res: Response;
    try {
      res = await fetchFn(manifestUrl, {
        signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
        redirect: "error",
        headers: { "User-Agent": marketplaceUserAgent() },
      });
    } catch (err: unknown) {
      throw new HttpError(502, `Marketplace manifest fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      throw new HttpError(502, `Marketplace manifest fetch failed: HTTP ${res.status}`);
    }
    const manifestLength = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(manifestLength) && manifestLength > MAX_MANIFEST_BYTES) {
      throw new HttpError(502, `Marketplace manifest exceeds size limit (${manifestLength} bytes)`);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch (err: unknown) {
      throw new HttpError(502, `Marketplace manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const manifest = parseContract(schemas.marketplaceManifestResponse, data);
      cache = { manifest, expiresAt: Date.now() + cacheTtlMs };
      return manifest;
    } catch (err: unknown) {
      throw new HttpError(502, `Marketplace manifest is invalid: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    getManifest,

    async downloadSkillZip(entry: MarketplaceSkillEntry): Promise<string> {
      let entryUrl: URL;
      try {
        entryUrl = new URL(entry.zipUrl);
      } catch {
        throw new HttpError(502, `Marketplace skill zip URL is invalid: ${entry.zipUrl}`);
      }
      const allowedOrigin = new URL(manifestUrl).origin;
      if (entryUrl.origin !== allowedOrigin) {
        throw new HttpError(502, `Marketplace skill zip URL origin mismatch: ${entryUrl.origin}`);
      }

      let res: Response;
      try {
        res = await fetchFn(entry.zipUrl, {
          signal: AbortSignal.timeout(ZIP_DOWNLOAD_TIMEOUT_MS),
          redirect: "error",
          headers: { "User-Agent": marketplaceUserAgent() },
        });
      } catch (err: unknown) {
        throw new HttpError(502, `Marketplace skill zip download failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) {
        throw new HttpError(502, `Marketplace skill zip download failed: HTTP ${res.status}`);
      }
      const declaredLength = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_SKILL_ZIP_BYTES) {
        throw new HttpError(502, `Marketplace skill zip exceeds size limit: ${entry.name}`);
      }
      if (!res.body) {
        throw new HttpError(502, `Marketplace skill zip download returned no body: ${entry.name}`);
      }
      const zipPath = path.join(os.tmpdir(), `marketplace-skill-${nanoid()}.zip`);
      try {
        await pipeline(
          res.body,
          async function* (source) {
            let received = 0;
            for await (const chunk of source) {
              received += chunk.length;
              if (received > MAX_SKILL_ZIP_BYTES) {
                throw new HttpError(502, `Marketplace skill zip exceeds size limit: ${entry.name}`);
              }
              yield chunk;
            }
            if (received === 0) {
              throw new HttpError(502, `Marketplace skill zip is empty: ${entry.name}`);
            }
          },
          fs.createWriteStream(zipPath),
        );
      } catch (err: unknown) {
        await fsp.rm(zipPath, { force: true }).catch(() => {});
        if (err instanceof HttpError) throw err;
        throw new HttpError(502, `Marketplace skill zip download failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return zipPath;
    },
  };
}

export const marketplaceService: MarketplaceService = createMarketplaceService();
