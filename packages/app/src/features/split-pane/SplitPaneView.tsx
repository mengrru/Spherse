import { useCallback } from "react";
import { ReadOnlyContentBrowser } from "../content-browser";
import { useProjectCtx } from "../../context/project-context";
import { tabKey } from "../../lib/tab-target";
import { useSplitPaneStore } from "./store";
import type { SplitTarget } from "./target";

export function SplitPaneView({ target }: { target: SplitTarget }) {
  const { projectId } = useProjectCtx();
  const close = useCallback(() => useSplitPaneStore.getState().closeSplit(projectId), [projectId]);
  const openFile = useCallback(
    (path: string) => useSplitPaneStore.getState().openSplit(projectId, { kind: "file", path }),
    [projectId],
  );
  const key = `${projectId}:${tabKey(target)}`;

  switch (target.kind) {
    case "file":
      return (
        <ReadOnlyContentBrowser
          key={key}
          filePath={target.path}
          onClose={close}
          onOpenFile={openFile}
          onNotFound={close}
        />
      );
    default:
      return null;
  }
}
