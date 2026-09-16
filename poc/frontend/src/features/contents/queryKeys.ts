import type { AdminContentListParams } from '../../api/admin';

export const contentKeys = {
  all: ['contents'] as const,
  lists: () => [...contentKeys.all, 'list'] as const,
  list: (params: AdminContentListParams) => [...contentKeys.lists(), params] as const,
  details: () => [...contentKeys.all, 'detail'] as const,
  detail: (id: string) => [...contentKeys.details(), id] as const,
  audits: () => [...contentKeys.all, 'audit'] as const,
  auditRoot: (id: string) => [...contentKeys.audits(), id] as const,
  audit: (id: string, cursor: string | null) => [...contentKeys.audits(), id, cursor] as const,
};
