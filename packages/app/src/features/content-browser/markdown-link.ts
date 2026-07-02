const ABSOLUTE_URL_RE = /^(https?:|mailto:|tel:|data:|blob:|file:)/i;

export type MarkdownLinkKind = "external" | "anchor" | "internal";

export interface ResolvedMarkdownLink {
  kind: MarkdownLinkKind;
  path?: string;
  anchor?: string;
}

export function isExternalUrl(href: string): boolean {
  return ABSOLUTE_URL_RE.test(href);
}

export function resolveMarkdownLink(href: string, markdownFilePath: string): ResolvedMarkdownLink {
  if (!href) return { kind: "internal", path: "" };

  if (isExternalUrl(href)) return { kind: "external" };

  const hashIndex = href.indexOf("#");
  const anchor = hashIndex >= 0 ? safeDecode(href.slice(hashIndex + 1)) : undefined;
  const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;

  if (!pathPart) return { kind: "anchor", anchor };

  const decodedPath = safeDecode(pathPart);
  const dirIndex = markdownFilePath.lastIndexOf("/");
  const baseDir = dirIndex >= 0 ? markdownFilePath.slice(0, dirIndex) : "";
  const relativePath = decodedPath.startsWith("/") ? decodedPath.slice(1) : joinPosix(baseDir, decodedPath);
  const resolved = normalizePosix(relativePath);

  return { kind: "internal", path: resolved, anchor };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
