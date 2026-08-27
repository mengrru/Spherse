import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { ApiClient } from "../../lib/api";
import type { CreatingState, CreateAction, TreeItem } from "./tree-model";

export interface FileTreeContextValue {
  projectId: string;
  client: ApiClient;
  selectedFilePath?: string;
  expandedPaths: ReadonlySet<string>;
  creating: CreatingState | null;
  selectFile: (filePath: string) => void;
  toggleDir: (path: string) => void;
  requestCreate: (item: TreeItem, action: CreateAction) => void;
  submitCreate: (parentPath: string, action: CreateAction, name: string) => void;
  cancelCreate: () => void;
  requestDelete: (item: TreeItem) => void;
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
