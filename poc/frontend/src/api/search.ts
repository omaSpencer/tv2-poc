import { apiRequest } from './client';
import type { ContentCategory, SearchResponse } from './types';

export function searchCatalog(
  query: string,
  opts?: { category?: ContentCategory | null; limit?: number; offset?: number },
) {
  const params = new URLSearchParams();
  params.set('q', query);
  if (opts?.category) params.set('category', opts.category);
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
  return apiRequest<SearchResponse>(`/catalog/search?${params.toString()}`, {
    auth: false,
    retryAuth: false,
  });
}
