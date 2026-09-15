import { QueryClient } from '@tanstack/react-query';
import { isApiProblemError } from '../api/types';

function shouldRetry(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false;
  if (isApiProblemError(error)) {
    const status = error.problem.status;
    // No blind retry on client/auth/business failures (FRONTEND.md §8).
    if (status >= 400 && status < 500) return false;
  }
  return true;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
