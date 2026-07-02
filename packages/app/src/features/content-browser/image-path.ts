import { isExternalUrl, resolveMarkdownLink } from "./markdown-link";

export function resolveMarkdownImagePath(src: string, markdownFilePath: string): string {
  if (!src) return src;
  if (isExternalUrl(src)) return src;

  const { path } = resolveMarkdownLink(src, markdownFilePath);
  return path ?? "";
}
