/**
 * R10 – machine-readable OpenAPI request and response schemas.
 *
 * The runtime contract is Zod (`http.ts`, `errors.ts`) and stays the single
 * validator; this module only *projects* those same schemas into OpenAPI so the
 * published document describes the bodies the API actually accepts and returns.
 * No second validation rule set is introduced: request schemas are generated
 * from the very objects `normalize*Command` parses with, so the document cannot
 * drift from the enforced contract without the generation changing too.
 *
 * Response shapes have no Zod source today (the views are TypeScript types), so
 * they are declared here as Zod objects and are kept in step with the view
 * types by `satisfies`-checked builders in `http.ts` consumers plus the
 * contract tests that compare a real response against these schemas.
 */
import { z } from 'zod';
import { AUDIT_ACTIONS, CONTENT_CATEGORIES, CONTENT_STATUSES, REINDEX_PHASES, WORKER_DESIRED_STATES } from '../schema.js';
import { ERROR_CODES } from './errors.js';
import { PERMISSIONS, ROLES } from './permissions.js';
import {
  CHANGED_FIELD_ORDER, createContentBodySchema, patchContentBodySchema, versionedBodySchema,
} from './http.js';
import { SEARCH_QUERY_LIMITS, searchQuarantineV1Schema } from './search.js';
import {
  contentRepairResultSchema,
  operatorActionKindSchema,
  operatorActionStateSchema,
  quarantineReplayResultSchema,
  repairBodySchema,
  replayBodySchema,
  reindexResultSchema,
  startReindexBodySchema,
} from './operator-actions.js';

// `toISOString()` output: UTC, `Z` suffix. Declared so a generated client
// gets a real date-time type instead of an opaque string.
const isoDateTime = z.iso.datetime().describe('ISO 8601 timestamp in UTC (Z suffix).');
const category = z.enum(CONTENT_CATEGORIES);

/** Editorial view: every stored field, including actor and media asset id. */
export const adminContentViewSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  slug: z.string().nullable(),
  summary: z.string().nullable(),
  category: category.nullable(),
  mediaAssetId: z.string().nullable(),
  tags: z.array(z.string()),
  status: z.enum(CONTENT_STATUSES),
  version: z.number().int().positive().describe('Optimistic-concurrency token; echo it back as expectedVersion.'),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  publishedAt: isoDateTime.nullable(),
  withdrawnAt: isoDateTime.nullable(),
  createdBy: z.string(),
  updatedBy: z.string(),
});

export const adminContentListItemSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  slug: z.string().nullable(),
  category: category.nullable(),
  status: z.enum(CONTENT_STATUSES),
  version: z.number().int().positive(),
  updatedAt: isoDateTime,
  updatedBy: z.string(),
  publishedAt: isoDateTime.nullable(),
});

export const adminContentListViewSchema = z.strictObject({
  items: z.array(adminContentListItemSchema),
  nextCursor: z.string().nullable().describe('Opaque cursor for the next page.'),
});

export const contentAuditViewSchema = z.strictObject({
  id: z.uuid(),
  contentVersion: z.number().int().positive(),
  action: z.enum(AUDIT_ACTIONS),
  actorSub: z.string(),
  actorRoles: z.array(z.enum(ROLES)),
  occurredAt: isoDateTime,
  correlationId: z.string(),
  changedFields: z.array(z.enum(CHANGED_FIELD_ORDER)),
});

export const contentAuditListViewSchema = z.strictObject({
  items: z.array(contentAuditViewSchema),
  nextCursor: z.string().nullable().describe('Opaque cursor for older audit entries.'),
});

/** D-M0-04b: no actor, no media asset id, no audit or outbox data. */
export const publicContentViewSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  slug: z.string().nullable(),
  summary: z.string().nullable(),
  category: category.nullable(),
  tags: z.array(z.string()),
  publishedAt: isoDateTime.nullable(),
});

export const meViewSchema = z.strictObject({
  sub: z.string(),
  roles: z.array(z.enum(ROLES)),
  permissions: z.array(z.enum(PERMISSIONS)),
  expiresAt: isoDateTime,
});

/** D-M0-09 problem+json. Values never travel back, only names and codes. */
export const problemDocumentSchema = z.strictObject({
  type: z.string().describe('urn:indaplay:poc:error:<code>'),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(Object.keys(ERROR_CODES) as [string, ...string[]]),
  detail: z.string(),
  instance: z.string(),
  correlationId: z.string(),
  fields: z.array(z.string()).optional().describe('Offending field names on validation_failed.'),
  expectedVersion: z.number().int().optional(),
  actualVersion: z.number().int().optional(),
});

/** Terminus-shaped health body; deliberately not problem+json. */
const healthDetail = z.record(z.string(), z.strictObject({ status: z.enum(['up', 'down']) }));
export const healthViewSchema = z.strictObject({
  status: z.enum(['ok', 'error']),
  info: healthDetail,
  error: healthDetail,
  details: healthDetail,
});

/**
 * M4 public search result. `estimatedTotalHits` is the index's estimate and is
 * documented as such: the database filter can shorten a page below it, and M4
 * deliberately does not pull further index pages to backfill.
 */
export const catalogSearchViewSchema = z.strictObject({
  items: z.array(publicContentViewSchema),
  offset: z.number().int().min(SEARCH_QUERY_LIMITS.offsetMin).max(SEARCH_QUERY_LIMITS.offsetMax),
  limit: z.number().int().min(SEARCH_QUERY_LIMITS.limitMin).max(SEARCH_QUERY_LIMITS.limitMax),
  returned: z.number().int().nonnegative(),
  estimatedTotalHits: z.number().int().nonnegative()
    .describe('Index estimate; may exceed items.length after the database filter.'),
});

/** Per-index worker view inside processing-status (M4-07). */
export const searchIndexStatusSchema = z.strictObject({
  state: z.enum(['off', 'bootstrapping', 'idle', 'processing', 'retrying', 'paused', 'halted']),
  durable: z.string(),
  inFlightEventId: z.uuid().nullable()
    .describe('Not necessarily included in the durable pending count.'),
  inFlightTaskUid: z.number().int().nullable(),
  lastAckedAt: isoDateTime.nullable(),
  lastErrorCode: z.string().nullable(),
  reachable: z.boolean().nullable().describe('Null until the endpoint has been probed.'),
  phase: z.enum(REINDEX_PHASES).nullable(),
  desiredWorkerState: z.enum(WORKER_DESIRED_STATES).nullable(),
  runId: z.uuid().nullable(),
  snapshotStreamSequence: z.number().int().nullable(),
  outboxHighWater: z.number().int().nullable(),
  catchUpStreamSequence: z.number().int().nullable(),
  importedDocuments: z.number().int().nonnegative(),
  expectedDocuments: z.number().int().nullable(),
  startedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
  routeEligible: z.boolean()
    .describe('phase === ready AND the runtime state is routable AND the endpoint is not known to be unreachable (reachable !== false).'),
});

export const processingStatusViewSchema = z.strictObject({
  outbox: z.strictObject({
    pending: z.number().int().nonnegative(),
    oldestOccurredAt: isoDateTime.nullable(),
    oldestAgeMs: z.number().int().nonnegative().nullable(),
  }),
  relay: z.strictObject({
    enabled: z.boolean(),
    state: z.enum(['off', 'idle', 'publishing', 'retrying', 'halted']),
    lastDeliveredAt: isoDateTime.nullable(),
    lastErrorCode: z.string().nullable(),
  }),
  broker: z.strictObject({
    connected: z.boolean(),
    streamPresent: z.boolean().nullable(),
  }),
  consumers: z.array(z.strictObject({
    name: z.string(),
    pending: z.number().int().nonnegative(),
    ackPending: z.number().int().nonnegative(),
    ackFloorStreamSequence: z.number().int().nonnegative(),
    oldestUnfinishedAt: isoDateTime.nullable(),
    oldestUnfinishedAgeMs: z.number().int().nonnegative().nullable(),
  })).optional(),
  quarantine: z.strictObject({ pending: z.number().int().nonnegative() }).optional(),
  consumersUnavailable: z.boolean().optional(),
  indexes: z.strictObject({
    a: searchIndexStatusSchema,
    b: searchIndexStatusSchema,
  }).optional(),
});

const operatorTargetViewSchema = z.union([
  z.strictObject({ index: z.enum(['a', 'b']), allowSearchOutage: z.boolean() }),
  z.strictObject({ sequence: z.number().int().positive() }),
  z.strictObject({ contentId: z.uuid(), target: z.enum(['a', 'b', 'both']) }),
]);

const operatorResultViewSchema = z.union([
  reindexResultSchema,
  quarantineReplayResultSchema,
  contentRepairResultSchema,
]);

export const operatorActionViewSchema = z.strictObject({
  id: z.uuid(),
  kind: operatorActionKindSchema,
  state: operatorActionStateSchema,
  requestedBy: z.string(),
  requestedRoles: z.array(z.enum(ROLES)),
  reason: z.string().min(3).max(500),
  target: operatorTargetViewSchema,
  result: operatorResultViewSchema.nullable(),
  correlationId: z.string(),
  errorCode: z.string().nullable(),
  createdAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  heartbeatAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
});

export const reindexPreflightViewSchema = z.strictObject({
  index: z.enum(['a', 'b']),
  otherIndex: z.enum(['a', 'b']),
  otherIndexReady: z.boolean(),
  otherIndexReachable: z.boolean().nullable(),
  activeRunId: z.uuid().nullable(),
  canStartNormally: z.boolean(),
  confirmationRequired: z.boolean(),
  confirmationTarget: z.string().nullable(),
  blockers: z.array(z.enum(['active_run', 'other_index_unavailable', 'search_disabled'])),
});

export const reindexProgressViewSchema = z.strictObject({
  phase: z.enum(REINDEX_PHASES),
  snapshotStreamSequence: z.number().int().nullable(),
  outboxHighWater: z.number().int().nullable(),
  catchUpStreamSequence: z.number().int().nullable(),
  importedDocuments: z.number().int().nonnegative(),
  expectedDocuments: z.number().int().nullable(),
  startedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
  errorCode: z.string().nullable(),
});

export const reindexRunViewSchema = operatorActionViewSchema.extend({
  progress: reindexProgressViewSchema.nullable(),
});

export const quarantineItemViewSchema = z.strictObject({
  sequence: z.number().int().positive(),
  schemaValid: z.boolean(),
  quarantineId: z.uuid().nullable(),
  failedAt: isoDateTime.nullable(),
  errorCode: z.string().nullable(),
  originalEventId: z.uuid().nullable(),
  originalStream: z.string().nullable(),
  originalSequence: z.number().int().positive().nullable(),
  subject: z.string().nullable(),
  durable: z.string().nullable(),
});

export const quarantineListViewSchema = z.strictObject({
  items: z.array(quarantineItemViewSchema),
  nextCursor: z.string().nullable(),
});

type JsonSchema = Record<string, unknown>;

function toOpenApi(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as JsonSchema;
}

/**
 * Named schemas merged into `components.schemas`. Request bodies are generated
 * with `io: 'input'` so an optional field is documented as optional, not as a
 * field the server fills in.
 */
export const OPENAPI_SCHEMAS: Readonly<Record<string, JsonSchema>> = {
  CreateContentBody: toOpenApi(createContentBodySchema, 'input'),
  PatchContentBody: toOpenApi(patchContentBodySchema, 'input'),
  VersionedCommandBody: toOpenApi(versionedBodySchema, 'input'),
  AdminContentView: toOpenApi(adminContentViewSchema, 'output'),
  AdminContentListItem: toOpenApi(adminContentListItemSchema, 'output'),
  AdminContentListView: toOpenApi(adminContentListViewSchema, 'output'),
  ContentAuditView: toOpenApi(contentAuditViewSchema, 'output'),
  ContentAuditListView: toOpenApi(contentAuditListViewSchema, 'output'),
  PublicContentView: toOpenApi(publicContentViewSchema, 'output'),
  MeView: toOpenApi(meViewSchema, 'output'),
  ProblemDocument: toOpenApi(problemDocumentSchema, 'output'),
  HealthView: toOpenApi(healthViewSchema, 'output'),
  ProcessingStatusView: toOpenApi(processingStatusViewSchema, 'output'),
  CatalogSearchView: toOpenApi(catalogSearchViewSchema, 'output'),
  SearchIndexStatus: toOpenApi(searchIndexStatusSchema, 'output'),
  SearchQuarantineV1: toOpenApi(searchQuarantineV1Schema, 'output'),
  StartReindexBody: toOpenApi(startReindexBodySchema, 'input'),
  ReplayQuarantineBody: toOpenApi(replayBodySchema, 'input'),
  StartContentRepairBody: toOpenApi(repairBodySchema, 'input'),
  OperatorActionView: toOpenApi(operatorActionViewSchema, 'output'),
  ReindexPreflightView: toOpenApi(reindexPreflightViewSchema, 'output'),
  ReindexRunView: toOpenApi(reindexRunViewSchema, 'output'),
  QuarantineItemView: toOpenApi(quarantineItemViewSchema, 'output'),
  QuarantineListView: toOpenApi(quarantineListViewSchema, 'output'),
};

export type OpenApiSchemaName = keyof typeof OPENAPI_SCHEMAS;

/** `$ref` to a named component schema; the only way routes reference a schema. */
export function schemaRef(name: OpenApiSchemaName): { $ref: string } {
  return { $ref: `#/components/schemas/${String(name)}` };
}

/** problem+json response descriptor for an `@ApiResponse` decorator. */
export function problemResponse(description: string): {
  description: string;
  content: Record<string, { schema: { $ref: string } }>;
} {
  return {
    description,
    content: { 'application/problem+json': { schema: schemaRef('ProblemDocument') } },
  };
}

/** application/json response descriptor for an `@ApiResponse` decorator. */
export function jsonResponse(name: OpenApiSchemaName, description: string): {
  description: string;
  content: Record<string, { schema: { $ref: string } }>;
} {
  return {
    description,
    content: { 'application/json': { schema: schemaRef(name) } },
  };
}
