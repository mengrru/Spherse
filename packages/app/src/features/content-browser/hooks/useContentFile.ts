import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../../lib/api";

export function useContentFile(client: ApiClient, filePath: string) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const loadedPath = useRef<string | null>(null);

  useEffect(() => {
    // 区分首次加载和刷新：首次加载显示 loading 状态；刷新时跳过 setLoading 以保留滚动位置
    const isFirstLoad = loadedPath.current !== filePath;
    if (isFirstLoad) {
      loadedPath.current = filePath;
      setLoading(true);
    }
    setError(null);
    client
      .getContent(filePath)
      .then((data) => {
        if (data) {
          setContent(data.content);
        } else {
          setError("File not found");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        if (isFirstLoad) setLoading(false);
      });
  }, [filePath, client, reloadNonce]);

  return {
    content,
    setContent,
    loading,
    setLoading,
    error,
    setError,
    reload: () => setReloadNonce((n) => n + 1),
  };
}
