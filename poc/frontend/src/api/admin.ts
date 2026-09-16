import { apiRequest } from './client';
import type {
  AdminContentView,
  AdminContentListView,
  ContentAuditListView,
  CreateContentBody,
  PatchContentBody,
  VersionedBody,
} from './types';

export type AdminContentListParams = {
  q?: string;
  status?: string;
  category?: string;
  limit?: number;
  cursor?: string | null;
};

function queryString(params: AdminContentListParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.category) query.set('category', params.category);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const value = query.toString();
  return value ? `?${value}` : '';
}

export function listAdminContents(params: AdminContentListParams) {
  return apiRequest<AdminContentListView>(`/admin/contents${queryString(params)}`);
}

export function listContentAudit(id: string, params: { limit?: number; cursor?: string | null } = {}) {
  return apiRequest<ContentAuditListView>(
    `/admin/contents/${encodeURIComponent(id)}/audit${queryString(params)}`,
  );
}

export function createContent(body: CreateContentBody) {
  return apiRequest<AdminContentView>('/admin/contents', {
    method: 'POST',
    body,
  });
}

export function getAdminContent(id: string) {
  return apiRequest<AdminContentView>(`/admin/contents/${encodeURIComponent(id)}`);
}

export function patchContent(id: string, body: PatchContentBody) {
  return apiRequest<AdminContentView>(`/admin/contents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
  });
}

export function publishContent(id: string, body: VersionedBody) {
  return apiRequest<AdminContentView>(`/admin/contents/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body,
  });
}

export function withdrawContent(id: string, body: VersionedBody) {
  return apiRequest<AdminContentView>(`/admin/contents/${encodeURIComponent(id)}/withdraw`, {
    method: 'POST',
    body,
  });
}
