import type { Dispatch, DragEvent, SetStateAction } from "react";

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

export function dropTargetHandlers(params: {
  targetDir: string;
  dropFiles: (dirPath: string, files: File[]) => void;
  setDropTargetDir: Dispatch<SetStateAction<string | null>>;
}): {
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
} {
  const { targetDir, dropFiles, setDropTargetDir } = params;
  return {
    onDragOver: (e: DragEvent) => {
      if (!hasFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setDropTargetDir(targetDir);
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFileDrag(e.dataTransfer)) return;
      e.stopPropagation();
      const related = e.relatedTarget;
      if (related instanceof Node && e.currentTarget.contains(related)) return;
      setDropTargetDir((prev) => (prev === targetDir ? null : prev));
    },
    onDrop: (e: DragEvent) => {
      if (!hasFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTargetDir(null);
      dropFiles(targetDir, extractDroppedFiles(e.dataTransfer));
    },
  };
}
