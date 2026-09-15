/**
 * M0-07 / M1-02 – Drizzle schema for the content lifecycle.
 *
 * The SQL migrations under `migrations/` are the applied source of truth; this
 * module is the typed representation the repository layer queries through.
 * Every business constraint that PostgreSQL can enforce is declared here so a
 * broken application path cannot persist an invalid row.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const CONTENT_STATUSES = ['draft', 'published', 'withdrawn'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_CATEGORIES = ['film', 'sorozat', 'hir', 'sport', 'szorakozas', 'egyeb'] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const AUDIT_ACTIONS = ['created', 'updated', 'published', 'withdrawn'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const EVENT_TYPES = ['content.published', 'content.withdrawn'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Limits shared by the application validator and the database constraints. */
export const LIMITS = {
  title: 200,
  summary: 500,
  slug: 80,
  mediaAssetId: 128,
  tagCount: 20,
  tagLength: 40,
  correlationId: 128,
  actorSub: 200,
  slugCandidates: 50,
} as const;

/** Names referenced when a unique violation has to be told apart from other SQL errors. */
export const CONSTRAINTS = {
  contentSlugUnique: 'content_slug_unique',
  auditVersionUnique: 'content_audit_content_version_unique',
  outboxAggregateVersionUnique: 'outbox_event_aggregate_version_unique',
} as const;


const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map(value => `'${value}'`).join(', ')})`);

/**
 * Editorial aggregate. `version` is the optimistic-concurrency token the client
 * echoes back as `expectedVersion`; every persisted change increments it.
 */
export const content = pgTable(
  'content',
  {
    id: uuid('id').primaryKey(),
    slug: text('slug'),
    title: text('title').notNull(),
    summary: text('summary'),
    category: text('category'),
    mediaAssetId: text('media_asset_id'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    status: text('status').notNull(),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  table => [
    // A nullable slug leaves the name free; the unique constraint is the final
    // arbiter of a concurrent publish race, not a prior existence check.
    unique(CONSTRAINTS.contentSlugUnique).on(table.slug),
    check('content_title_length', sql`char_length(${table.title}) between 1 and ${sql.raw(String(LIMITS.title))}`),
    check(
      'content_slug_shape',
      sql`${table.slug} is null or (${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= ${sql.raw(String(LIMITS.slug))})`,
    ),
    check(
      'content_summary_length',
      sql`${table.summary} is null or char_length(${table.summary}) between 1 and ${sql.raw(String(LIMITS.summary))}`,
    ),
    check('content_category_allowed', sql`${table.category} is null or ${inList('category', CONTENT_CATEGORIES)}`),
    check(
      'content_media_asset_length',
      sql`${table.mediaAssetId} is null or char_length(${table.mediaAssetId}) between 1 and ${sql.raw(String(LIMITS.mediaAssetId))}`,
    ),
    check('content_tag_count', sql`coalesce(array_length(${table.tags}, 1), 0) <= ${sql.raw(String(LIMITS.tagCount))}`),
    check('content_status_allowed', inList('status', CONTENT_STATUSES)),
    check('content_version_positive', sql`${table.version} >= 1`),
    check('content_actor_present', sql`char_length(${table.createdBy}) between 1 and ${sql.raw(String(LIMITS.actorSub))} and char_length(${table.updatedBy}) between 1 and ${sql.raw(String(LIMITS.actorSub))}`),
    // The publish minimum is a storage guarantee, not only an API rule.
    check(
      'content_published_minimum',
      sql`${table.status} <> 'published' or (${table.slug} is not null and ${table.summary} is not null and ${table.category} is not null and ${table.mediaAssetId} is not null and ${table.publishedAt} is not null)`,
    ),
  ],
);

/** Append-only trail: one row per persisted content version. */
export const contentAudit = pgTable(
  'content_audit',
  {
    id: uuid('id').primaryKey(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id),
    contentVersion: integer('content_version').notNull(),
    action: text('action').notNull(),
    actorSub: text('actor_sub').notNull(),
    actorRoles: text('actor_roles').array().notNull().default(sql`'{}'::text[]`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    correlationId: text('correlation_id').notNull(),
    changedFields: text('changed_fields').array().notNull().default(sql`'{}'::text[]`),
  },
  table => [
    unique(CONSTRAINTS.auditVersionUnique).on(table.contentId, table.contentVersion),
    check('content_audit_action_allowed', inList('action', AUDIT_ACTIONS)),
    check('content_audit_version_positive', sql`${table.contentVersion} >= 1`),
    check('content_audit_actor_present', sql`char_length(${table.actorSub}) between 1 and ${sql.raw(String(LIMITS.actorSub))}`),
    check('content_audit_correlation_shape', sql`${table.correlationId} ~ '^[A-Za-z0-9._-]{1,128}$'`),
  ],
);

/**
 * Transactional outbox. `delivered_at` stays null until the M3 relay records a
 * JetStream publish ACK; M1 never writes it.
 */
export const outboxEvent = pgTable(
  'outbox_event',
  {
    eventId: uuid('event_id').primaryKey(),
    schemaVersion: integer('schema_version').notNull(),
    eventType: text('event_type').notNull(),
    aggregateId: uuid('aggregate_id')
      .notNull()
      .references(() => content.id),
    aggregateVersion: integer('aggregate_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    correlationId: text('correlation_id').notNull(),
    payload: jsonb('payload').notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  table => [
    unique(CONSTRAINTS.outboxAggregateVersionUnique).on(table.aggregateId, table.aggregateVersion),
    index('outbox_event_pending_idx')
      .on(table.occurredAt, table.eventId)
      .where(sql`${table.deliveredAt} is null`),
    check('outbox_event_schema_version', sql`${table.schemaVersion} = 1`),
    check('outbox_event_type_allowed', inList('event_type', EVENT_TYPES)),
    check('outbox_event_version_positive', sql`${table.aggregateVersion} >= 1`),
    check('outbox_event_correlation_shape', sql`${table.correlationId} ~ '^[A-Za-z0-9._-]{1,128}$'`),
    // The envelope type and the payload status are one decision, stored once.
    check(
      'outbox_event_payload_pair',
      sql`(${table.eventType} = 'content.published' and ${table.payload} ->> 'status' = 'published') or (${table.eventType} = 'content.withdrawn' and ${table.payload} ->> 'status' = 'withdrawn')`,
    ),
  ],
);

export type ContentRow = typeof content.$inferSelect;
export type ContentAuditRow = typeof contentAudit.$inferSelect;
export type OutboxEventRow = typeof outboxEvent.$inferSelect;
