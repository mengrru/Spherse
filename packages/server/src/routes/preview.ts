import fs from "node:fs/promises";
import path from "node:path";
import type { Stats } from "node:fs";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  resolveProjectPath,
  serverAccessPolicy,
  AccessDeniedError,
} from "@spherse/core";
import { injectHeadScript, SDK_MARK, SDK_FILENAME } from "@spherse/sdk";
import { SDK_SOURCE } from "@spherse/sdk/source";
import type { ProjectRegistry } from "../registry.js";
import { forbidden, notFound } from "../errors.js";

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "application/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  eot: "application/vnd.ms-fontobject",
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(CONTENT_TYPES));

type PreviewParams = { projectId: string; "*": string };

function stripAuthPrefix(wildcard: string): string {
  if (!wildcard.startsWith("__auth/")) return wildcard;
  const afterMarker = wildcard.slice("__auth/".length);
  const slash = afterMarker.indexOf("/");
  return slash === -1 ? "" : afterMarker.slice(slash + 1);
}

async function handlePreview(req: FastifyRequest<{ Params: PreviewParams }>, reply: FastifyReply): Promise<unknown> {
  const relativePath = req.params["*"];
  const pm = req.projectCtx!.projectManager;
  const root = pm.getRootPath();

  // Reserved: serve the Spherse SDK bundle at any directory level. Every injected
  // HTML loads it via a relative `<script src="__spherse-sdk.js">`, which resolves
  // against the document URL (preview src) or the renderer-injected <base> (srcDoc).
  if (path.basename(relativePath) === SDK_FILENAME) {
    return reply
      .type("application/javascript")
      .header("Cache-Control", "no-cache")
      .send(SDK_SOURCE);
  }

  const policy = serverAccessPolicy(root);
  try {
    policy.assertRead(relativePath);
  } catch (err) {
    if (err instanceof AccessDeniedError) throw forbidden("Access denied");
    throw err;
  }
  const absolutePath = resolveProjectPath(root, relativePath);

  const ext = path.extname(absolutePath).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw forbidden("File type not allowed");
  }

  let stat: Stats;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    throw notFound("Not found");
  }

  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  if (req.headers["if-none-match"] === etag) {
    return reply
      .code(304)
      .header("Cache-Control", "no-cache")
      .header("ETag", etag)
      .send();
  }

  try {
    const buffer = await fs.readFile(absolutePath);
    const isHtml = ext === "html" || ext === "htm";
    // Inject the SDK as a same-origin relative script so the iframe keeps its real
    // origin (preview server) and the SDK can postMessage the renderer. Idempotent:
    // files that already carry the marker (e.g. hand-authored) are left untouched.
    const payload = isHtml
      ? Buffer.from(
          injectHeadScript(
            buffer.toString("utf8"),
            `<script src="${SDK_FILENAME}" ${SDK_MARK}></script>`,
            SDK_MARK,
          ),
          "utf8",
        )
      : buffer;
    return reply
      .type(CONTENT_TYPES[ext])
      .header("Cache-Control", "no-cache")
      .header("ETag", etag)
      .send(payload);
  } catch {
    throw notFound("Not found");
  }
}

export function registerPreviewRoutes(fastify: FastifyInstance, _registry: ProjectRegistry): void {
  fastify.get<{ Params: PreviewParams }>(
    "/api/projects/:projectId/preview/*",
    async (req, reply) => handlePreview(req, reply),
  );

  fastify.get<{ Params: PreviewParams & { token: string } }>(
    "/api/projects/:projectId/preview/__auth/:token/*",
    {
      async preHandler(req) {
        const wildcard = (req.params as PreviewParams)["*"];
        (req.params as PreviewParams)["*"] = stripAuthPrefix(wildcard);
      },
    },
    async (req, reply) => handlePreview(req as FastifyRequest<{ Params: PreviewParams }>, reply),
  );
}
