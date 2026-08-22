import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "../../../lib/api";
import { projectQueryKeys } from "../../../queries/keys";
import type { ContentResponse } from "../../../lib/types";

export function useContentFile(projectId: string, client: ApiClient, filePath: string) {
  const queryClient = useQueryClient();
  const queryKey = projectQueryKeys.content(projectId, filePath);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await client.getContent(filePath);
      if (!data) throw new Error("File not found");
      return data;
    },
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
    dataUpdatedAt: query.dataUpdatedAt,
    reload: () => {
      void query.refetch();
    },
  };
}
