import { apiRequest } from './client';
import type {
  AdminContentView,
  CreateContentBody,
  PatchContentBody,
  VersionedBody,
} from './types';

export function createContent(body: CreateContentBody, accessToken: string) {
  return apiRequest<AdminContentView>('/admin/contents', {
    method: 'POST',
    body,
    accessToken,
  });
}

export function getAdminContent(id: string, accessToken: string) {
  return apiRequest<AdminContentView>(`/admin/contents/${encodeURIComponent(id)}`, {
    accessToken,
  });
}

export function patchContent(id: string, body: PatchContentBody, accessToken: string) {
  return apiRequest<AdminContentView>(`/admin/contents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    accessToken,
  });
}

export function publishContent(id: string, body: VersionedBody, accessToken: string) {
  return apiRequest<AdminContentView>(`/admin/contents/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body,
    accessToken,
  });
}

export function withdrawContent(id: string, body: VersionedBody, accessToken: string) {
  return apiRequest<AdminContentView>(`/admin/contents/${encodeURIComponent(id)}/withdraw`, {
    method: 'POST',
    body,
    accessToken,
  });
}
