import { useCallback, useEffect, useState } from "react";
import { classifyFileKind } from "../file-kind";

interface ContentViewStateOptions {
  filePath: string;
  binary: boolean;
  loading: boolean;
  error: string | null;
  dataUpdatedAt: number;
  reload: () => void;
}

export function useContentViewState({ filePath, binary, loading, error, dataUpdatedAt, reload }: ContentViewStateOptions) {
  const [htmlView, setHtmlView] = useState<"preview" | "source">("preview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [findOpen, setFindOpen] = useState(false);

  const refresh = useCallback(() => {
    reload();
    setRefreshKey((k) => k + 1);
  }, [reload]);

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, [dataUpdatedAt, filePath]);

  const kind = classifyFileKind(filePath);
  const findable = !loading && !error && !binary && !kind.isImage && !(kind.isHtml && htmlView === "preview");

  return {
    ...kind,
    htmlView,
    setHtmlView,
    refreshKey,
    refresh,
    findOpen,
    setFindOpen,
    toggleFind: useCallback(() => setFindOpen((v) => !v), []),
    findable,
  };
}
