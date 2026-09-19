import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import type { Static, TSchema } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import type {
  MarketplaceManifestResponse,
  MarketplaceSkillEntry,
  MarketplaceProjectManifestResponse,
  MarketplaceProjectEntry,
} from "@spherse/contracts";
import { getAppVersion } from "./server-info.js";
import { HttpError } from "./errors.js";

const OSS_BUCKET_BASE_URL =
  "https://mengru-open-source.oss-cn-beijing.aliyuncs.com/spherse";

export const MARKETPLACE_MANIFEST_URL =
  process.env.SPHERSE_MARKETPLACE_MANIFEST_URL ??
  `${OSS_BUCKET_BASE_URL}/skills/manifest.json`;

export const PROJECT_MARKETPLACE_MANIFEST_URL =
  process.env.SPHERSE_PROJECT_MARKETPLACE_MANIFEST_URL ??
  `${OSS_BUCKET_BASE_URL}/projects/manifest.json`;

const MANIFEST_CACHE_TTL_MS = 30_000;
const MANIFEST_FETCH_TIMEOUT_MS = 10_000;
const SKILL_ZIP_DOWNLOAD_TIMEOUT_MS = 60_000;
const PROJECT_ZIP_DOWNLOAD_TIMEOUT_MS = 300_000;
const MAX_SKILL_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_PROJECT_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export function marketplaceUserAgent(): string {
  const version = getAppVersion()?.trim() || "dev";
  return `spherse-marketplace/${version} (${os.platform()} ${os.release()})`;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface MarketplaceZipEntry {
  name: string;
  zipUrl: string;
}

export interface MarketplaceService<TManifest, TEntry extends MarketplaceZipEntry> {
  getManifest(): Promise<TManifest>;
  downloadZip(entry: TEntry): Promise<string>;
}

interface MarketplaceServiceImplOptions<T extends TSchema> {
  fetchFn?: FetchLike;
  manifestUrl: string;
  manifestResponseSchema: T;
  maxZipBytes: number;
  zipDownloadTimeoutMs: number;
  tmpPrefix: string;
  cacheTtlMs?: number;
}

function createMarketplaceServiceImpl<T extends TSchema, TEntry extends MarketplaceZipEntry>(
  options: MarketplaceServiceImplOptions<T>,
): MarketplaceService<Static<T>, TEntry> {
  const fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  const manifestUrl = options.manifestUrl;
  const cacheTtlMs = options.cacheTtlMs ?? MANIFEST_CACHE_TTL_MS;
  let cache: { manifest: Static<T>; expiresAt: number } | null = null;
  let inFlight: Promise<Static<T>> | null = null;

  function getManifest(): Promise<Static<T>> {
    if (cache && cache.expiresAt > Date.now()) return Promise.resolve(cache.manifest);
    if (inFlight) return inFlight;
    inFlight = fetchManifest().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function fetchManifest(): Promise<Static<T>> {
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
      const manifest = parseContract(options.manifestResponseSchema, data);
      cache = { manifest, expiresAt: Date.now() + cacheTtlMs };
      return manifest;
    } catch (err: unknown) {
      throw new HttpError(502, `Marketplace manifest is invalid: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    getManifest,

    async downloadZip(entry: TEntry): Promise<string> {
      let entryUrl: URL;
      try {
        entryUrl = new URL(entry.zipUrl);
      } catch {
        throw new HttpError(502, `Marketplace zip URL is invalid: ${entry.zipUrl}`);
      }
      const allowedOrigin = new URL(manifestUrl).origin;
      if (entryUrl.origin !== allowedOrigin) {
        throw new HttpError(502, `Marketplace zip URL origin mismatch: ${entryUrl.origin}`);
      }

      let res: Response;
      try {
        res = await fetchFn(entry.zipUrl, {
          signal: AbortSignal.timeout(options.zipDownloadTimeoutMs),
          redirect: "error",
          headers: { "User-Agent": marketplaceUserAgent() },
        });
      } catch (err: unknown) {
        throw new HttpError(502, `Marketplace zip download failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) {
        throw new HttpError(502, `Marketplace zip download failed: HTTP ${res.status}`);
      }
      const declaredLength = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declaredLength) && declaredLength > options.maxZipBytes) {
        throw new HttpError(502, `Marketplace zip exceeds size limit: ${entry.name}`);
      }
      if (!res.body) {
        throw new HttpError(502, `Marketplace zip download returned no body: ${entry.name}`);
      }
      const zipPath = path.join(os.tmpdir(), `${options.tmpPrefix}-${nanoid()}.zip`);
      try {
        await pipeline(
          res.body,
          async function* (source) {
            let received = 0;
            for await (const chunk of source) {
              received += chunk.length;
              if (received > options.maxZipBytes) {
                throw new HttpError(502, `Marketplace zip exceeds size limit: ${entry.name}`);
              }
              yield chunk;
            }
            if (received === 0) {
              throw new HttpError(502, `Marketplace zip is empty: ${entry.name}`);
            }
          },
          fs.createWriteStream(zipPath),
        );
      } catch (err: unknown) {
        await fsp.rm(zipPath, { force: true }).catch(() => {});
        if (err instanceof HttpError) throw err;
        throw new HttpError(502, `Marketplace zip download failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return zipPath;
    },
  };
}

export function createMarketplaceService(options?: {
  fetchFn?: FetchLike;
  manifestUrl?: string;
  cacheTtlMs?: number;
}): MarketplaceService<MarketplaceManifestResponse, MarketplaceSkillEntry> {
  return createMarketplaceServiceImpl<typeof schemas.marketplaceManifestResponse, MarketplaceSkillEntry>({
    fetchFn: options?.fetchFn,
    manifestUrl: options?.manifestUrl ?? MARKETPLACE_MANIFEST_URL,
    manifestResponseSchema: schemas.marketplaceManifestResponse,
    maxZipBytes: MAX_SKILL_ZIP_BYTES,
    zipDownloadTimeoutMs: SKILL_ZIP_DOWNLOAD_TIMEOUT_MS,
    tmpPrefix: "marketplace-skill",
    cacheTtlMs: options?.cacheTtlMs,
  });
}

export function createProjectMarketplaceService(options?: {
  fetchFn?: FetchLike;
  manifestUrl?: string;
  cacheTtlMs?: number;
}): MarketplaceService<MarketplaceProjectManifestResponse, MarketplaceProjectEntry> {
  return createMarketplaceServiceImpl<
    typeof schemas.marketplaceProjectManifestResponse,
    MarketplaceProjectEntry
  >({
    fetchFn: options?.fetchFn,
    manifestUrl: options?.manifestUrl ?? PROJECT_MARKETPLACE_MANIFEST_URL,
    manifestResponseSchema: schemas.marketplaceProjectManifestResponse,
    maxZipBytes: MAX_PROJECT_ZIP_BYTES,
    zipDownloadTimeoutMs: PROJECT_ZIP_DOWNLOAD_TIMEOUT_MS,
    tmpPrefix: "marketplace-project",
    cacheTtlMs: options?.cacheTtlMs,
  });
}

export const marketplaceService: MarketplaceService<MarketplaceManifestResponse, MarketplaceSkillEntry> =
  createMarketplaceService();

export const projectMarketplaceService: MarketplaceService<
  MarketplaceProjectManifestResponse,
  MarketplaceProjectEntry
> = createProjectMarketplaceService();
