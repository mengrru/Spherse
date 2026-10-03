import { registerAction } from "../registry";
import { respond } from "../respond";
import { INVALID_NAME_RE } from "../../components/file-tree/tree-model";
import { invalidateProjectFileQueries } from "../../queries/content";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const ALLOWED_UPLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "ico",
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "flac",
  "aac",
  "opus",
  "mp4",
  "webm",
  "mov",
  "avi",
  "mkv",
  "txt",
  "json",
  "md",
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

type DirPathValidation =
  | { ok: true; dirPath: string }
  | { ok: false; forbidden: boolean };

function validateDirPath(value: unknown): DirPathValidation {
  if (value === undefined || value === null) return { ok: true, dirPath: "" };
  if (typeof value !== "string") return { ok: false, forbidden: false };
  const dirPath = value.trim();
  if (!dirPath) return { ok: true, dirPath: "" };
  if (dirPath.startsWith("/") || dirPath.includes("\\")) return { ok: false, forbidden: false };
  const segments = dirPath.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return { ok: false, forbidden: false };
  }
  if (segments[0].toLowerCase() === ".spherse") return { ok: false, forbidden: true };
  return { ok: true, dirPath };
}

registerAction("uploadFile", async (params, ctx) => {
  const { dirPath, name, data } = params as { dirPath?: unknown; name?: unknown; data?: unknown };
  const fail = (error: string) => respond(ctx, false, { error });

  if (!ctx.client) return fail("bad_request");
  if (!(data instanceof Blob)) return fail("bad_request");

  const dir = validateDirPath(dirPath);
  if (!dir.ok) return fail(dir.forbidden ? "forbidden" : "bad_request");

  const fallbackName = data instanceof File ? data.name : "";
  const rawName = typeof name === "string" ? name : fallbackName;
  const finalName = rawName.trim();
  if (!finalName || finalName === "." || finalName === ".." || INVALID_NAME_RE.test(finalName)) {
    return fail("bad_request");
  }
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extensionOf(finalName))) return fail("unsupported_type");
  if (data.size > MAX_UPLOAD_BYTES) return fail("file_too_large");

  const file =
    data instanceof File && data.name === finalName
      ? data
      : new File([data], finalName, { type: data.type });
  let res;
  try {
    res = await ctx.client.uploadFile(dir.dirPath, file);
  } catch {
    return fail("upload_failed");
  }
  respond(ctx, true, res);
  void invalidateProjectFileQueries(ctx.projectId, res.path);
});
