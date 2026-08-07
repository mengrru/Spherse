const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"]);

export interface FileKind {
  isMarkdown: boolean;
  isHtml: boolean;
  isImage: boolean;
}

export function classifyFileKind(filePath: string): FileKind {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return {
    isMarkdown: ext === "md" || ext === "markdown" || filePath.endsWith(".agents.md"),
    isHtml: ext === "html" || ext === "htm",
    isImage: IMAGE_EXTENSIONS.has(ext),
  };
}
