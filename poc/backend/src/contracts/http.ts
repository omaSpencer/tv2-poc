/**
 * M0-12 – HTTP request/response contract and the single normalisation path.
 *
 * The same functions run for an HTTP request and for a direct service call, so
 * a command built in a test cannot bypass a rule the API enforces (M1-03).
 */
import { z } from 'zod';
import { CONTENT_CATEGORIES, LIMITS, type ContentCategory, type ContentRow, type ContentStatus } from '../schema.js';
import { validationFailed } from './errors.js';

export const BUSINESS_FIELDS = ['title', 'slug', 'summary', 'category', 'mediaAssetId', 'tags'] as const;
export type BusinessField = (typeof BUSINESS_FIELDS)[number];

/** Deterministic audit ordering: business fields first, then the lifecycle field. */
export const CHANGED_FIELD_ORDER = [...BUSINESS_FIELDS, 'status'] as const;
export type ChangedField = (typeof CHANGED_FIELD_ORDER)[number];

export type ContentFields = {
  title: string;
  slug: string | null;
  summary: string | null;
  category: ContentCategory | null;
  mediaAssetId: string | null;
  tags: string[];
};

export type CreateContentCommand = { fields: ContentFields; provided: BusinessField[] };
export type PatchContentCommand = { expectedVersion: number; changes: Partial<ContentFields> };
export type VersionedCommand = { expectedVersion: number };

const nullableString = z.union([z.string(), z.null()]);
const expectedVersion = z.number().int().positive();

/** `strictObject` is what rejects unknown and server-owned fields with a 422. */
export const createContentBodySchema = z.strictObject({
  title: z.string(),
  slug: nullableString.optional(),
  summary: nullableString.optional(),
  category: nullableString.optional(),
  mediaAssetId: nullableString.optional(),
  tags: z.array(z.string()).optional(),
});

export const patchContentBodySchema = z.strictObject({
  expectedVersion,
  title: nullableString.optional(),
  slug: nullableString.optional(),
  summary: nullableString.optional(),
  category: nullableString.optional(),
  mediaAssetId: nullableString.optional(),
  tags: z.array(z.string()).optional(),
});

export const versionedBodySchema = z.strictObject({ expectedVersion });

const uuidSchema = z.uuid();

class FieldErrors {
  private readonly fields = new Set<string>();
  add(field: string): void {
    this.fields.add(field);
  }
  get failed(): boolean {
    return this.fields.size > 0;
  }
  throwIfAny(): void {
    if (this.fields.size > 0) throw validationFailed([...this.fields]);
  }
}

function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const fields = new Set<string>();
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') for (const key of issue.keys) fields.add(key);
    else fields.add(issue.path.length > 0 ? String(issue.path[0]) : 'body');
  }
  throw validationFailed([...fields]);
}

/** Path ids are UUIDs; a malformed one is a request-shape problem, not a 404. */
export function parseContentId(value: string): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw validationFailed(['id']);
  return result.data;
}

function normalizeTitle(raw: string | null, errors: FieldErrors): string {
  if (raw === null) {
    errors.add('title');
    return '';
  }
  const value = raw.trim();
  if (value.length < 1 || value.length > LIMITS.title) errors.add('title');
  return value;
}

function normalizeSummary(raw: string | null, errors: FieldErrors): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > LIMITS.summary) errors.add('summary');
  return value;
}

function normalizeCategory(raw: string | null, errors: FieldErrors): ContentCategory | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (!(CONTENT_CATEGORIES as readonly string[]).includes(value)) {
    errors.add('category');
    return null;
  }
  return value as ContentCategory;
}

/** Identifier for an external system: trimmed, case preserved, empty means absent. */
function normalizeMediaAssetId(raw: string | null, errors: FieldErrors): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > LIMITS.mediaAssetId) errors.add('mediaAssetId');
  return value;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A manual slug is validated, never silently transliterated. */
function normalizeSlug(raw: string | null, errors: FieldErrors): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > LIMITS.slug || !SLUG_PATTERN.test(value)) {
    errors.add('slug');
    return null;
  }
  return value;
}

export function isValidSlug(value: string): boolean {
  return value.length > 0 && value.length <= LIMITS.slug && SLUG_PATTERN.test(value);
}

function normalizeTags(raw: string[], errors: FieldErrors): string[] {
  if (raw.length > LIMITS.tagCount) errors.add('tags');
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of raw) {
    const value = entry.trim().toLowerCase();
    if (value.length === 0) continue;
    if (value.length > LIMITS.tagLength) {
      errors.add('tags');
      continue;
    }
    if (seen.has(value)) continue;
    seen.add(value);
    tags.push(value);
  }
  return tags;
}

export function normalizeCreateCommand(body: unknown): CreateContentCommand {
  const input = parseBody(createContentBodySchema, body);
  const errors = new FieldErrors();
  const fields: ContentFields = {
    title: normalizeTitle(input.title, errors),
    slug: normalizeSlug(input.slug ?? null, errors),
    summary: normalizeSummary(input.summary ?? null, errors),
    category: normalizeCategory(input.category ?? null, errors),
    mediaAssetId: normalizeMediaAssetId(input.mediaAssetId ?? null, errors),
    tags: normalizeTags(input.tags ?? [], errors),
  };
  errors.throwIfAny();
  // Only fields the request actually carried a value for reach the audit trail.
  const provided = BUSINESS_FIELDS.filter(field => {
    if (input[field] === undefined) return false;
    const value = fields[field];
    return Array.isArray(value) ? value.length > 0 : value !== null;
  });
  return { fields, provided };
}

export function normalizePatchCommand(body: unknown): PatchContentCommand {
  const input = parseBody(patchContentBodySchema, body);
  const errors = new FieldErrors();
  const changes: Partial<ContentFields> = {};
  if (input.title !== undefined) changes.title = normalizeTitle(input.title, errors);
  if (input.slug !== undefined) changes.slug = normalizeSlug(input.slug, errors);
  if (input.summary !== undefined) changes.summary = normalizeSummary(input.summary, errors);
  if (input.category !== undefined) changes.category = normalizeCategory(input.category, errors);
  if (input.mediaAssetId !== undefined) changes.mediaAssetId = normalizeMediaAssetId(input.mediaAssetId, errors);
  if (input.tags !== undefined) changes.tags = normalizeTags(input.tags, errors);
  errors.throwIfAny();
  return { expectedVersion: input.expectedVersion, changes };
}

export function normalizeVersionedCommand(body: unknown): VersionedCommand {
  return parseBody(versionedBodySchema, body);
}

/** Publish minimum (D-M0-04). Slug is checked separately: it may be generated. */
export function publishMinimumFailures(fields: ContentFields): string[] {
  const missing: string[] = [];
  if (fields.title.trim().length === 0) missing.push('title');
  if (fields.summary === null) missing.push('summary');
  if (fields.category === null) missing.push('category');
  if (fields.mediaAssetId === null) missing.push('mediaAssetId');
  return missing;
}

export type AdminContentView = {
  id: string;
  title: string;
  slug: string | null;
  summary: string | null;
  category: ContentCategory | null;
  mediaAssetId: string | null;
  tags: string[];
  status: ContentStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  withdrawnAt: string | null;
  createdBy: string;
  updatedBy: string;
};

/** D-M0-04b: no actor, no media asset id, no audit or outbox data. */
export type PublicContentView = {
  id: string;
  title: string;
  slug: string | null;
  summary: string | null;
  category: ContentCategory | null;
  tags: string[];
  publishedAt: string | null;
};

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function toAdminView(row: ContentRow): AdminContentView {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    category: row.category as ContentCategory | null,
    mediaAssetId: row.mediaAssetId,
    tags: row.tags,
    status: row.status as ContentStatus,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: iso(row.publishedAt),
    withdrawnAt: iso(row.withdrawnAt),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

export function toPublicView(row: ContentRow): PublicContentView {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    category: row.category as ContentCategory | null,
    tags: row.tags,
    publishedAt: iso(row.publishedAt),
  };
}
