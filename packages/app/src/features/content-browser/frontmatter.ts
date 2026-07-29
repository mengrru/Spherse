import yaml from "js-yaml";

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: null, body: raw };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(match[1]);
  } catch {
    return { frontmatter: null, body: raw };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { frontmatter: null, body: raw };
  }

  return {
    frontmatter: parsed as Record<string, unknown>,
    body: raw.slice(match[0].length).replace(/^[\r\n]+/, ""),
  };
}
