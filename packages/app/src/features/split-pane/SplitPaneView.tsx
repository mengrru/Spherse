import { useCallback } from "react";
import { ReadOnlyContentBrowser } from "../content-browser";
import { useProjectCtx } from "../../context/project-context";
import { useSplitPaneStore } from "./store";

export function SplitPaneView({ filePath }: { filePath: string }) {
  const { projectId } = useProjectCtx();
  const close = useCallback(() => useSplitPaneStore.getState().closeSplit(projectId), [projectId]);
  const openFile = useCallback(
    (path: string) => useSplitPaneStore.getState().openSplit(projectId, path),
    [projectId],
  );

  return (
    <ReadOnlyContentBrowser
      key={`${projectId}:${filePath}`}
      filePath={filePath}
      onClose={close}
      onOpenFile={openFile}
      onNotFound={close}
    />
  );
}
