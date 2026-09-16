/**
 * M4 – search projection, quarantine and public search contracts.
 *
 * Three separate contracts live here because they are all "shape of something
 * that crosses a boundary":
 *
 * - `SearchProjectionV1` is the document written into both Meilisearch
 *   instances. It is deliberately narrower than the public content view: no
 *   slug, no mediaAssetId, no publishedAt. The index is a lookup structure, not
 *   a second copy of the aggregate.
 * - `searchQuarantineV1Schema` is the DLQ envelope. It carries a *locator*
 *   (stream + sequence) instead of the original payload, so the wrapper cannot
 *   exceed the stream's 64 KiB message limit no matter how large the original
 *   event was.
 * - `normalizeCatalogSearchQuery` is the single validator for the public search
 *   query string, in the same spirit as `normalize*Command` in `http.ts`.
 */
import { z } from 'zod';
import { CONTENT_CATEGORIES, type ContentCategory } from '../schema.js';
import { validationFailed } from './errors.js';
import type { PublicContentView } from './http.js';

/** Stable, configuration-independent names for the two index instances. */
export const SEARCH_INDEX_ALIASES = ['a', 'b'] as const;
export type SearchIndexAlias = (typeof SEARCH_INDEX_ALIASES)[number];

/** Default index UID; a test or smoke run overrides it with a unique value. */
export const DEFAULT_SEARCH_INDEX_UID = 'contents';

/** Meilisearch index UID charset. Validated at startup, never at first use. */
export const SEARCH_INDEX_UID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * The indexed document. `summary` and `category` are non-null because the
 * publish minimum (D-M0-04) guarantees them, and only currently published
 * content is ever upserted.
 */
export type SearchProjectionV1 = {
  id: string;
  title: string;
  summary: string;
  category: ContentCategory;
  tags: string[];
  aggregateVersion: number;
};

/** Index settings M4 owns. Anything else on the index is left alone. */
export const SEARCH_PRIMARY_KEY = 'id';
/** D08 importance order: order is significant and is compared as a sequence. */
export const SEARCH_SEARCHABLE_ATTRIBUTES = ['title', 'tags', 'summary'] as const;
export const SEARCH_FILTERABLE_ATTRIBUTES = ['category'] as const;
/** The public response never takes a field from the index, only the id. */
export const SEARCH_DISPLAYED_ATTRIBUTES = ['id'] as const;
export const SEARCH_SORTABLE_ATTRIBUTES = [] as const;

export const QUARANTINE_ERROR_CODES = [
  'invalid_json',
  'invalid_event_schema',
  'projection_rejected',
] as const;
export type QuarantineErrorCode = (typeof QUARANTINE_ERROR_CODES)[number];

export const QUARANTINE_SCHEMA_VERSION = 1;

/**
 * DLQ envelope. No token, API key, database URL or original content payload —
 * the original message is addressed by stream and sequence so M5 can replay it
 * from the source of truth rather than from a copy that may already be stale.
 */
export const searchQuarantineV1Schema = z.strictObject({
  quarantineId: z.uuid(),
  schemaVersion: z.literal(QUARANTINE_SCHEMA_VERSION),
  failedAt: z.iso.datetime({ offset: false }),
  errorCode: z.enum(QUARANTINE_ERROR_CODES),
  /** Null only when no valid UUID could be recovered from the raw message. */
  originalEventId: z.uuid().nullable(),
  originalStream: z.string().min(1),
  originalStreamSequence: z.number().int().positive(),
  originalSubject: z.string().min(1),
  durable: z.string().min(1),
});

export type SearchQuarantineV1 = z.infer<typeof searchQuarantineV1Schema>;

export const searchQuarantineV1JsonSchema = () =>
  z.toJSONSchema(searchQuarantineV1Schema, { io: 'output' });

/** Public query limits (D08). The same numbers drive the OpenAPI parameters. */
export const SEARCH_QUERY_LIMITS = {
  qMin: 1,
  qMax: 200,
  limitDefault: 20,
  limitMin: 1,
  limitMax: 100,
  offsetDefault: 0,
  offsetMin: 0,
  offsetMax: 1000,
} as const;

export const CATALOG_SEARCH_QUERY_KEYS = ['q', 'category', 'limit', 'offset'] as const;

export type CatalogSearchQuery = {
  q: string;
  category: ContentCategory | null;
  limit: number;
  offset: number;
};

/**
 * Meilisearch reports an estimate, so `estimatedTotalHits` may exceed the
 * number of items actually returned: the database filter removes stale hits and
 * M4 deliberately does not pull further pages to backfill a short page.
 */
export type CatalogSearchView = {
  items: PublicContentView[];
  offset: number;
  limit: number;
  returned: number;
  estimatedTotalHits: number;
};

/** A repeated query parameter arrives as an array; an object is impossible to mean. */
function scalar(value: unknown, field: string, errors: Set<string>): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  errors.add(field);
  return undefined;
}

function boundedInteger(
  raw: string | undefined,
  field: string,
  fallback: number,
  min: number,
  max: number,
  errors: Set<string>,
): number {
  if (raw === undefined) return fallback;
  const value = raw.trim();
  // `Number()` would accept '1e3', ' 12 ' and '0x10'; the contract is a plain integer.
  if (!/^\d+$/.test(value)) {
    errors.add(field);
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    errors.add(field);
    return fallback;
  }
  return parsed;
}

/**
 * The only place a search query string becomes a command. Unknown, repeated and
 * out-of-range parameters all fail with 422 and the offending field names; no
 * Meilisearch call is made for a request that never validated.
 */
export function normalizeCatalogSearchQuery(raw: unknown): CatalogSearchQuery {
  const errors = new Set<string>();
  const source = (raw ?? {}) as Record<string, unknown>;
  if (typeof source !== 'object' || Array.isArray(source)) throw validationFailed(['query']);

  for (const key of Object.keys(source)) {
    if (!(CATALOG_SEARCH_QUERY_KEYS as readonly string[]).includes(key)) errors.add(key);
  }

  const rawQ = scalar(source.q, 'q', errors);
  const rawCategory = scalar(source.category, 'category', errors);
  const rawLimit = scalar(source.limit, 'limit', errors);
  const rawOffset = scalar(source.offset, 'offset', errors);

  const q = (rawQ ?? '').trim();
  if (q.length < SEARCH_QUERY_LIMITS.qMin || q.length > SEARCH_QUERY_LIMITS.qMax) errors.add('q');

  let category: ContentCategory | null = null;
  if (rawCategory !== undefined) {
    const value = rawCategory.trim();
    if (!(CONTENT_CATEGORIES as readonly string[]).includes(value)) errors.add('category');
    else category = value as ContentCategory;
  }

  const limit = boundedInteger(
    rawLimit, 'limit', SEARCH_QUERY_LIMITS.limitDefault,
    SEARCH_QUERY_LIMITS.limitMin, SEARCH_QUERY_LIMITS.limitMax, errors,
  );
  const offset = boundedInteger(
    rawOffset, 'offset', SEARCH_QUERY_LIMITS.offsetDefault,
    SEARCH_QUERY_LIMITS.offsetMin, SEARCH_QUERY_LIMITS.offsetMax, errors,
  );

  if (errors.size > 0) throw validationFailed([...errors]);
  return { q, category, limit, offset };
}
