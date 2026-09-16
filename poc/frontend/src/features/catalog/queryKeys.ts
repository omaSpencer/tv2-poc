import type { CatalogSearchParams } from './searchParams';

export const catalogKeys = {
  all: ['catalog'] as const,
  searches: () => [...catalogKeys.all, 'search'] as const,
  search: (params: CatalogSearchParams) => [...catalogKeys.searches(), params] as const,
  details: () => [...catalogKeys.all, 'detail'] as const,
  detail: (id: string) => [...catalogKeys.details(), id] as const,
};
