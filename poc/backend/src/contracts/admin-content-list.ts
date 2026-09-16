import { z } from 'zod';
import {
  AUDIT_ACTIONS,
  CONTENT_CATEGORIES,
  CONTENT_STATUSES,
  type ContentAuditRow,
  type ContentCategory,
  type ContentStatus,
} from '../schema.js';
import { validationFailed } from './errors.js';
import { CHANGED_FIELD_ORDER, type ChangedField } from './http.js';
import { ROLES, type Role } from './permissions.js';

export const ADMIN_CONTENT_LIST_LIMITS = {
  default: 20,
  min: 1,
  max: 100,
  queryMax: 200,
} as const;

export const CONTENT_AUDIT_LIMITS = {
  default: 50,
  min: 1,
  max: 100,
} as const;

const uuid = z.uuid();
const listCursorSchema = z.strictObject({
  v: z.literal(1),
  updatedAt: z.iso.datetime({ offset: false }),
  id: uuid,
});
const auditCursorSchema = z.strictObject({
  v: z.literal(1),
  contentVersion: z.number().int().positive(),
});

export type AdminContentListCursor = z.infer<typeof listCursorSchema>;
export type ContentAuditCursor = z.infer<typeof auditCursorSchema>;

export type AdminContentListQuery = {
  q: string | null;
  status: ContentStatus | null;
  category: ContentCategory | null;
  limit: number;
  cursor: AdminContentListCursor | null;
};

export type ContentAuditQuery = {
  limit: number;
  cursor: ContentAuditCursor | null;
};

export type AdminContentListItem = {
  id: string;
  title: string;
  slug: string | null;
  category: ContentCategory | null;
  status: ContentStatus;
  version: number;
  updatedAt: string;
  updatedBy: string;
  publishedAt: string | null;
};

export type AdminContentListView = {
  items: AdminContentListItem[];
  nextCursor: string | null;
};

export type ContentAuditView = {
  id: string;
  contentVersion: number;
  action: (typeof AUDIT_ACTIONS)[number];
  actorSub: string;
  actorRoles: Role[];
  occurredAt: string;
  correlationId: string;
  changedFields: ChangedField[];
};

export type ContentAuditListView = {
  items: ContentAuditView[];
  nextCursor: string | null;
};

function singleValues(params: URLSearchParams, allowed: readonly string[]): Record<string, string | undefined> {
  const invalid = new Set<string>();
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalid.add(key);
  }
  if (invalid.size > 0) throw validationFailed([...invalid]);
  return Object.fromEntries(allowed.map(key => [key, params.get(key) ?? undefined]));
}

function parseLimit(raw: string | undefined, field: string, limits: { default: number; min: number; max: number }): number {
  if (raw === undefined) return limits.default;
  if (!/^\d+$/.test(raw)) throw validationFailed([field]);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < limits.min || value > limits.max) throw validationFailed([field]);
  return value;
}

function decodeCursor<T>(raw: string | undefined, field: string, schema: z.ZodType<T>): T | null {
  if (raw === undefined) return null;
  try {
    if (raw.length < 1 || raw.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('shape');
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    const result = schema.safeParse(parsed);
    if (!result.success) throw new Error('schema');
    return result.data;
  } catch {
    throw validationFailed([field]);
  }
}

function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function parseAdminContentListQuery(params: URLSearchParams): AdminContentListQuery {
  const values = singleValues(params, ['q', 'status', 'category', 'limit', 'cursor']);
  const fields = new Set<string>();
  const q = values.q?.trim() ?? null;
  if (q !== null && (q.length < 1 || q.length > ADMIN_CONTENT_LIST_LIMITS.queryMax)) fields.add('q');
  const status = values.status ?? null;
  if (status !== null && !(CONTENT_STATUSES as readonly string[]).includes(status)) fields.add('status');
  const category = values.category ?? null;
  if (category !== null && !(CONTENT_CATEGORIES as readonly string[]).includes(category)) fields.add('category');
  if (fields.size > 0) throw validationFailed([...fields]);
  return {
    q,
    status: status as ContentStatus | null,
    category: category as ContentCategory | null,
    limit: parseLimit(values.limit, 'limit', ADMIN_CONTENT_LIST_LIMITS),
    cursor: decodeCursor(values.cursor, 'cursor', listCursorSchema),
  };
}

export function parseContentAuditQuery(params: URLSearchParams): ContentAuditQuery {
  const values = singleValues(params, ['limit', 'cursor']);
  return {
    limit: parseLimit(values.limit, 'limit', CONTENT_AUDIT_LIMITS),
    cursor: decodeCursor(values.cursor, 'cursor', auditCursorSchema),
  };
}

export function toAdminContentListView(
  rows: Array<{
    id: string;
    title: string;
    slug: string | null;
    category: string | null;
    status: string;
    version: number;
    updatedAt: Date;
    updatedBy: string;
    publishedAt: Date | null;
  }>,
  limit: number,
): AdminContentListView {
  const hasNext = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      category: row.category as ContentCategory | null,
      status: row.status as ContentStatus,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    })),
    nextCursor: hasNext && last
      ? encodeCursor({ v: 1, updatedAt: last.updatedAt.toISOString(), id: last.id })
      : null,
  };
}

export function toContentAuditListView(rows: ContentAuditRow[], limit: number): ContentAuditListView {
  const hasNext = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  const validRoles = new Set<string>(ROLES);
  const validFields = new Set<string>(CHANGED_FIELD_ORDER);
  const validActions = new Set<string>(AUDIT_ACTIONS);
  return {
    items: visible.map(row => ({
      id: row.id,
      contentVersion: row.contentVersion,
      action: validActions.has(row.action) ? row.action as ContentAuditView['action'] : 'updated',
      actorSub: row.actorSub,
      actorRoles: row.actorRoles.filter((role): role is Role => validRoles.has(role)),
      occurredAt: row.occurredAt.toISOString(),
      correlationId: row.correlationId,
      changedFields: row.changedFields.filter((field): field is ChangedField => validFields.has(field)),
    })),
    nextCursor: hasNext && last
      ? encodeCursor({ v: 1, contentVersion: last.contentVersion })
      : null,
  };
}
