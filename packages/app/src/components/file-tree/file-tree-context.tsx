import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { CreatingState, CreateAction, TreeNode } from "./tree-model";

export interface FileTreeContextValue {
  selectedFilePath?: string;
  creating: CreatingState | null;
  toggleNode: (node: TreeNode) => void;
  requestCreate: (node: TreeNode, action: CreateAction) => void;
  submitCreate: (parentPath: string, action: CreateAction, name: string) => void;
  cancelCreate: () => void;
  requestDelete: (node: TreeNode) => void;
  onFloatFile?: (filePath: string) => void;
  floatedFilePaths?: Set<string>;
  readOnly?: boolean;
}

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export function FileTreeProvider({
  value,
  children,
}: {
  value: FileTreeContextValue;
  children: ReactNode;
}) {
  return <FileTreeContext.Provider value={value}>{children}</FileTreeContext.Provider>;
}

export function useFileTreeCtx(): FileTreeContextValue {
  const ctx = useContext(FileTreeContext);
  if (!ctx) {
    throw new Error("useFileTreeCtx must be used within FileTreeProvider");
  }
  return ctx;
}
