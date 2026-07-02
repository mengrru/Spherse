const ABSOLUTE_URL_RE = /^(https?:|data:|blob:|file:)/i;

export function resolveMarkdownImagePath(src: string, markdownFilePath: string): string {
  if (!src) return src;
  if (ABSOLUTE_URL_RE.test(src)) return src;

  const dirIndex = markdownFilePath.lastIndexOf("/");
  const baseDir = dirIndex >= 0 ? markdownFilePath.slice(0, dirIndex) : "";

  const relativePath = src.startsWith("/") ? src.slice(1) : joinPosix(baseDir, src);

  return normalizePosix(relativePath);
}

function joinPosix(base: string, rel: string): string {
  if (!base) return rel;
  return `${base}/${rel}`;
}

function normalizePosix(p: string): string {
  const parts = p.split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      result.pop();
    } else if (part !== "." && part !== "") {
      result.push(part);
    }
  }
  return result.join("/");
}
