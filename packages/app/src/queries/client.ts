import { QueryClient } from "@tanstack/react-query";

export const DEFAULT_QUERY_RETRIES = 1;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: DEFAULT_QUERY_RETRIES,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

export const queryClient = createQueryClient();
