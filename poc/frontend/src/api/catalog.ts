import { apiRequest } from './client';
import type { PublicContentView } from './types';

export async function fetchPublishedContent(id: string) {
  return apiRequest<PublicContentView>(`/catalog/contents/${encodeURIComponent(id)}`, {
    auth: false,
    retryAuth: false,
  });
}
