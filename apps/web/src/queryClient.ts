import { QueryClient } from '@tanstack/react-query';

export const SYNC_INTERVAL_MS = 20_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
