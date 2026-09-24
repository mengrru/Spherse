import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type ApiClient } from "../../../lib/api";
import { projectQueryKeys } from "../../../queries/keys";
import type { ContentResponse } from "../../../lib/types";

const MAX_RETRIES = 1;

class ContentNotFoundError extends Error {
  constructor() {
    super("File not found");
  }
}

export function useContentFile(projectId: string, client: ApiClient, filePath: string) {
  const queryClient = useQueryClient();
  const queryKey = projectQueryKeys.content(projectId, filePath);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        return await client.readContent(filePath);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) throw new ContentNotFoundError();
        throw err;
      }
    },
    retry: (failureCount, err) => !(err instanceof ContentNotFoundError) && failureCount < MAX_RETRIES,
  });

  return {
    content: query.data?.content ?? null,
    setContent: (content: string) => {
      queryClient.setQueryData<ContentResponse>(queryKey, (current) => ({
        path: current?.path ?? filePath,
        content,
        binary: current?.binary ?? false,
      }));
    },
    binary: query.data?.binary ?? false,
    loading: query.isPending,
    error: query.error instanceof Error ? query.error.message : null,
    notFound: query.error instanceof ContentNotFoundError,
    dataUpdatedAt: query.dataUpdatedAt,
    reload: () => {
      void query.refetch();
    },
  };
}
