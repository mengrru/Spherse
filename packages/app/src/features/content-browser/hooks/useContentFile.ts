import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";

export function useContentFile(client: ApiClient, filePath: string) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
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
      .finally(() => setLoading(false));
  }, [filePath, client]);

  return {
    content,
    setContent,
    loading,
    setLoading,
    error,
    setError,
  };
}
