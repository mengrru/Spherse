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
