import { serverAccessPolicy } from "@spherse/core";
import { injectHeadScript, SDK_MARK, SDK_FILENAME } from "@spherse/sdk";
import { SDK_SOURCE } from "@spherse/sdk/source";

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
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/opus",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(CONTENT_TYPES));

interface RegistryFile {
  projects: Array<{ id: string; name: string; dirName: string; createdAt: string; lastOpened?: string }>;
}

function storageScope(): string {
  const base = import.meta.env.BASE_URL;
  if (base === "/" || base === "" || base === "./") return "";
  return `${base.split("/").filter(Boolean).join("-")}/`;
}

function assetBase(): string {
  const base = import.meta.env.BASE_URL;
  if (!base || base === "./") return "/";
  return base.endsWith("/") ? base : `${base}/`;
}

let registryCache: RegistryFile | null = null;
let registryLoad: Promise<RegistryFile | null> | null = null;

async function loadRegistry(): Promise<RegistryFile | null> {
  if (registryCache) return registryCache;
  if (!registryLoad) {
    registryLoad = (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const segments = `${storageScope()}spherse-registry.json`.split("/").filter((s) => s.length > 0);
        let dir = root;
        for (const segment of segments.slice(0, -1)) {
          dir = await dir.getDirectoryHandle(segment);
        }
        const handle = await dir.getFileHandle(segments[segments.length - 1]);
        const file = await handle.getFile();
        registryCache = JSON.parse(await file.text()) as RegistryFile;
        return registryCache;
      } catch {
        return null;
      }
    })();
  }
  return registryLoad;
}

function invalidateRegistry(): void {
  registryCache = null;
  registryLoad = null;
}

interface ParsedPreviewRequest {
  projectId: string;
  relPath: string;
}

function parsePreviewUrl(pathname: string): ParsedPreviewRequest | null {
  const prefix = `${assetBase()}api/projects/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const marker = "/preview/";
  const idx = rest.indexOf(marker);
  if (idx === -1) return null;
  const projectId = rest.slice(0, idx);
  if (!projectId) return null;
  let relPath = decodeURIComponent(rest.slice(idx + marker.length));
  const authPrefix = "__auth/";
  if (relPath.startsWith(authPrefix)) {
    const after = relPath.slice(authPrefix.length);
    const slash = after.indexOf("/");
    relPath = slash === -1 ? "" : after.slice(slash + 1);
  }
  if (relPath.startsWith("__auth/")) return null;
  return { projectId, relPath };
}

function parseRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;
  const [, startStr, endStr] = match;
  let start: number;
  let end: number;
  if (startStr && endStr) {
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
  } else if (startStr) {
    start = parseInt(startStr, 10);
    end = fileSize - 1;
  } else if (endStr) {
    const suffix = parseInt(endStr, 10);
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    return null;
  }
  if (start > end || start < 0 || start >= fileSize) return null;
  return { start, end: Math.min(end, fileSize - 1) };
}

async function findProjectDirName(projectId: string): Promise<string | null> {
  const registry = await loadRegistry();
  if (!registry) return null;
  const entry = registry.projects.find((project) => project.id === projectId);
  return entry?.dirName ?? null;
}

async function openProjectFile(projectId: string, relPath: string): Promise<File | null> {
  const dirName = await findProjectDirName(projectId);
  if (!dirName) return null;
  const root = await navigator.storage.getDirectory();
  let dir: FileSystemDirectoryHandle = root;
  for (const segment of `${storageScope()}projects/${dirName}`.split("/")) {
    if (!segment) continue;
    dir = await dir.getDirectoryHandle(segment);
  }
  const segments = relPath.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment === "..") return null;
  }
  const fileName = segments[segments.length - 1];
  for (const segment of segments.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment);
  }
  const handle = await dir.getFileHandle(fileName);
  return handle.getFile();
}

function textResponse(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function handlePreviewRequest(request: Request): Promise<Response> {
  const parsed = parsePreviewUrl(new URL(request.url).pathname);
  if (!parsed) return fetch(request);
  const { projectId, relPath } = parsed;

  if (relPath.split("/").pop() === SDK_FILENAME) {
    return new Response(SDK_SOURCE, {
      status: 200,
      headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" },
    });
  }

  let dirName = await findProjectDirName(projectId);
  if (!dirName) {
    invalidateRegistry();
    dirName = (await findProjectDirName(projectId)) ?? null;
  }
  const policy = serverAccessPolicy(`/${storageScope()}projects/${dirName ?? `unknown-${projectId}`}`);
  try {
    policy.assertRead(relPath);
  } catch {
    return textResponse(403, "Access denied");
  }

  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return textResponse(403, "File type not allowed");
  }

  let file: File;
  try {
    file = (await openProjectFile(projectId, relPath))!;
    if (!file) throw new Error("missing");
  } catch {
    invalidateRegistry();
    try {
      file = (await openProjectFile(projectId, relPath))!;
      if (!file) throw new Error("missing");
    } catch {
      return textResponse(404, "Not found");
    }
  }

  const etag = `"${file.size}-${file.lastModified}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { "Cache-Control": "no-cache", ETag: etag } });
  }

  const isHtml = ext === "html" || ext === "htm";
  if (isHtml) {
    const source = await file.text();
    const payload = injectHeadScript(source, `<script src="${SDK_FILENAME}" ${SDK_MARK}></script>`, SDK_MARK);
    return new Response(payload, {
      status: 200,
      headers: { "Content-Type": CONTENT_TYPES[ext], "Cache-Control": "no-cache", ETag: etag },
    });
  }

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, file.size) : null;
  if (range) {
    const { start, end } = range;
    const blob = file.slice(start, end + 1);
    return new Response(blob, {
      status: 206,
      headers: {
        "Content-Type": CONTENT_TYPES[ext],
        "Cache-Control": "no-cache",
        ETag: etag,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${file.size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new Response(file, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[ext],
      "Cache-Control": "no-cache",
      ETag: etag,
      "Accept-Ranges": "bytes",
    },
  });
}

const swScope = self as unknown as ServiceWorkerGlobalScope;

swScope.addEventListener("install", () => {
  void swScope.skipWaiting();
});

swScope.addEventListener("activate", (event) => {
  event.waitUntil(swScope.clients.claim());
});

swScope.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== swScope.location.origin) return;
  if (!url.pathname.startsWith(`${assetBase()}api/projects/`)) return;
  event.respondWith(handlePreviewRequest(event.request));
});

export {};
