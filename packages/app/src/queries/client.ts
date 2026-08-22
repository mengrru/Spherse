import { QueryClient } from "@tanstack/react-query";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

export const queryClient = createQueryClient();
