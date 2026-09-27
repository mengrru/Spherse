export function hasFileDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer?.types?.includes("Files"));
}

export function extractDroppedFiles(dataTransfer: DataTransfer): File[] {
  const items = Array.from(dataTransfer.items ?? []);
  const hasEntries = items.some((item) => typeof item.webkitGetAsEntry === "function");
  if (hasEntries) {
    const files: File[] = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      if (item.webkitGetAsEntry?.()?.isDirectory) continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    return files;
  }
  return Array.from(dataTransfer.files ?? []);
}
