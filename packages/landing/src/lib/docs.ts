import { DEFAULT_LOCALE, type Locale } from "@spherse/i18n";

export type DocId = string;

const DOC_FILENAME_PATTERN = /^(?<id>[a-z0-9-]+)\.(?<locale>zh-CN|zh-TW|en)\.md$/;

const rawDocs = import.meta.glob("../content/docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function parseDocSources(): Record<DocId, Partial<Record<Locale, string>>> {
  const docs: Record<DocId, Partial<Record<Locale, string>>> = {};
  for (const [path, content] of Object.entries(rawDocs)) {
    const match = DOC_FILENAME_PATTERN.exec(path.split("/").pop() ?? "");
    if (!match?.groups) continue;
    const { id, locale } = match.groups;
    docs[id] = { ...docs[id], [locale]: content };
  }
  return docs;
}

const docSources = parseDocSources();

export function docIds(): DocId[] {
  return Object.keys(docSources).sort();
}

export function getDoc(id: DocId, locale: Locale): string | null {
  const article = docSources[id];
  if (!article) return null;
  return article[locale] ?? article[DEFAULT_LOCALE] ?? null;
}

export function docTitle(content: string): string {
  const heading = /^#\s+(.+)$/m.exec(content);
  return heading?.[1]?.trim() ?? "";
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/(\*\*|__|\*|_)/g, "");
}

export function docExcerpt(content: string, maxLength = 120): string {
  const paragraph = content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find(
      (block) =>
        !block.startsWith("#") && !block.startsWith("```") && block.length > 0,
    );
  if (!paragraph) return "";
  const plain = stripInlineMarkdown(paragraph.split("\n").join(" ")).replace(/\s+/g, " ").trim();
  const chars = Array.from(plain);
  if (chars.length <= maxLength) return plain;
  const cut = chars.slice(0, maxLength).join("");
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > maxLength * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
