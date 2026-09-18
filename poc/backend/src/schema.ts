/**
 * M0-07 / M1-02 – Drizzle schema for the content lifecycle.
 *
 * The SQL migrations under `migrations/` are the applied source of truth; this
 * module is the typed representation the repository layer queries through.
 * Every business constraint that PostgreSQL can enforce is declared here so a
 * broken application path cannot persist an invalid row.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgSequence, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const CONTENT_STATUSES = ['draft', 'published', 'withdrawn'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_CATEGORIES = ['film', 'sorozat', 'hir', 'sport', 'szorakozas', 'egyeb'] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const AUDIT_ACTIONS = ['created', 'updated', 'published', 'withdrawn'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const EVENT_TYPES = ['content.published', 'content.withdrawn'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * M5 – durable reindex lifecycle. The values live here, beside the other
 * database-enforced vocabularies, so the CHECK constraint and the TypeScript
 * union are generated from one list.
 */
export const REINDEX_PHASES = [
  'ready', 'draining', 'importing', 'swapping', 'catching_up', 'verifying', 'failed',
] as const;
export type ReindexPhase = (typeof REINDEX_PHASES)[number];

export const WORKER_DESIRED_STATES = ['running', 'paused'] as const;
export type WorkerDesiredState = (typeof WORKER_DESIRED_STATES)[number];

export const OPERATOR_ACTION_KINDS = ['reindex', 'quarantine_replay', 'content_repair'] as const;
export type OperatorActionKind = (typeof OPERATOR_ACTION_KINDS)[number];

export const OPERATOR_ACTION_STATES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type OperatorActionState = (typeof OPERATOR_ACTION_STATES)[number];

/** The two logical index aliases, as persisted operational rows. */
export const SEARCH_INDEX_CONTROL_ALIASES = ['a', 'b'] as const;

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
  outboxSequenceUnique: 'outbox_event_outbox_sequence_unique',
} as const;

/**
 * The PostgreSQL sequence behind `outbox_event.outbox_sequence` (M5 §3.2). It
 * is a *monotonic allocation order*, not an event version and not a JetStream
 * sequence: a rolled-back transaction leaves a permanent gap, so nothing may
 * assume the values are contiguous.
 */
export const OUTBOX_SEQUENCE_NAME = 'outbox_event_outbox_sequence_seq';
export const outboxSequenceAllocation = pgSequence(OUTBOX_SEQUENCE_NAME, { startWith: 1, increment: 1 });


// Schema constants only: never pass runtime input to this raw SQL helper.
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
    // PostgreSQL scans this ascending btree backwards for the required
    // `updated_at DESC, id DESC` order. Both columns are NOT NULL.
    index('content_admin_updated_id_idx').on(table.updatedAt, table.id),
    // Admin substring search uses ILIKE on title OR slug. Separate trigram GIN
    // indexes let PostgreSQL combine selective predicates with a BitmapOr.
    index('content_admin_title_trgm_idx').using('gin', table.title.op('gin_trgm_ops')),
    index('content_admin_slug_trgm_idx').using('gin', table.slug.op('gin_trgm_ops')),
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
    /**
     * M5 §3.2 – monotonic allocation order used to pin a reproducible outbox
     * high-water mark for a reindex snapshot. Assigned by a database sequence
     * so two concurrent transactions cannot receive the same value.
     */
    outboxSequence: bigint('outbox_sequence', { mode: 'number' })
      .notNull()
      .default(sql`nextval('${sql.raw(OUTBOX_SEQUENCE_NAME)}')`),
    /**
     * M5 §3.2 – the JetStream sequence the relay's PubAck reported. Written in
     * the same statement as `delivered_at`, so a delivered row always carries
     * the position its message occupies in the stream.
     */
    streamSequence: bigint('stream_sequence', { mode: 'number' }),
  },
  table => [
    unique(CONSTRAINTS.outboxAggregateVersionUnique).on(table.aggregateId, table.aggregateVersion),
    unique(CONSTRAINTS.outboxSequenceUnique).on(table.outboxSequence),
    index('outbox_event_pending_idx')
      .on(table.occurredAt, table.eventId)
      .where(sql`${table.deliveredAt} is null`),
    check('outbox_event_schema_version', sql`${table.schemaVersion} = 1`),
    check('outbox_event_type_allowed', inList('event_type', EVENT_TYPES)),
    check('outbox_event_version_positive', sql`${table.aggregateVersion} >= 1`),
    check('outbox_event_correlation_shape', sql`${table.correlationId} ~ '^[A-Za-z0-9._-]{1,128}$'`),
    check('outbox_event_outbox_sequence_positive', sql`${table.outboxSequence} >= 1`),
    // A stream sequence exists only for a row the relay has proved delivered.
    check(
      'outbox_event_stream_sequence_pair',
      sql`${table.streamSequence} is null or (${table.streamSequence} >= 1 and ${table.deliveredAt} is not null)`,
    ),
    index('outbox_event_outbox_sequence_idx').on(table.outboxSequence),
    // The envelope type and the payload status are one decision, stored once.
    check(
      'outbox_event_payload_pair',
      sql`(${table.eventType} = 'content.published' and ${table.payload} ->> 'status' = 'published') or (${table.eventType} = 'content.withdrawn' and ${table.payload} ->> 'status' = 'withdrawn')`,
    ),
  ],
);

/**
 * M5 §3.1 – durable reindex state, one row per logical index alias.
 *
 * This table is the *single* source of truth for two questions that must never
 * be answered from process memory: may this index answer a search, and should
 * its projection worker be asking for messages. A crashed coordinator leaves
 * the row behind exactly as it was, which is what keeps a half-imported index
 * out of the read path after a restart.
 *
 * Every column is operational. No title, summary, tag or actor ever lands here.
 */
export const searchIndexControl = pgTable(
  'search_index_control',
  {
    indexAlias: text('index_alias').primaryKey(),
    phase: text('phase').notNull(),
    desiredWorkerState: text('desired_worker_state').notNull(),
    /** The current or last full reindex run. Null before the first run. */
    runId: uuid('run_id'),
    /** Random, non-secret CLI instance id. Diagnostics only — never the lock. */
    ownerId: text('owner_id'),
    ownerHeartbeatAt: timestamp('owner_heartbeat_at', { withTimezone: true }),
    /** Liveness of the process that owns the worker, written by the watcher. */
    workerHeartbeatAt: timestamp('worker_heartbeat_at', { withTimezone: true }),
    /** The worker's own acknowledgement that it stopped requesting messages. */
    workerPausedAt: timestamp('worker_paused_at', { withTimezone: true }),
    /** Non-null while the worker holds a message; part of the drain check. */
    workerInFlightEventId: uuid('worker_in_flight_event_id'),
    /** `S0`: stream last_seq recorded before the snapshot's first read. */
    snapshotStreamSequence: bigint('snapshot_stream_sequence', { mode: 'number' }),
    /** `H`: the largest outbox_sequence visible inside the snapshot. */
    outboxHighWater: bigint('outbox_high_water', { mode: 'number' }),
    /** `S1`, later `S2`: the boundary the durable must reach before ready. */
    catchUpStreamSequence: bigint('catch_up_stream_sequence', { mode: 'number' }),
    importedDocuments: integer('imported_documents').notNull().default(0),
    expectedDocuments: integer('expected_documents'),
    lastErrorCode: text('last_error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  table => [
    check('search_index_control_alias_allowed', inList('index_alias', SEARCH_INDEX_CONTROL_ALIASES)),
    check('search_index_control_phase_allowed', inList('phase', REINDEX_PHASES)),
    check('search_index_control_desired_state_allowed', inList('desired_worker_state', WORKER_DESIRED_STATES)),
    check('search_index_control_imported_documents', sql`${table.importedDocuments} >= 0`),
    check(
      'search_index_control_expected_documents',
      sql`${table.expectedDocuments} is null or ${table.expectedDocuments} >= 0`,
    ),
    // A `ready` index has finished a run and wants its worker consuming. The
    // database refuses the combination that would let a paused worker look
    // routable, so no application bug can produce it.
    check(
      'search_index_control_ready_shape',
      sql`${table.phase} <> 'ready' or (${table.desiredWorkerState} = 'running' and ${table.completedAt} is not null and ${table.ownerId} is null)`,
    ),
  ],
);

/**
 * Fázis 5 – durable admission, audit and terminal state for operator mutations.
 * Only allowlisted target/result projections are written by the repository;
 * request bodies, credentials and exception text never belong in this table.
 */
export const operatorAction = pgTable(
  'operator_action',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    requestedBy: text('requested_by').notNull(),
    requestedRoles: text('requested_roles').array().notNull().default(sql`'{}'::text[]`),
    correlationId: text('correlation_id').notNull(),
    reason: text('reason').notNull(),
    target: jsonb('target').notNull(),
    result: jsonb('result'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  table => [
    index('operator_action_state_created_idx').on(table.state, table.createdAt),
    index('operator_action_kind_created_idx').on(table.kind, table.createdAt),
    uniqueIndex('operator_action_one_active_reindex_idx')
      .on(table.kind)
      .where(sql`${table.kind} = 'reindex' and ${table.state} in ('queued', 'running')`),
    check('operator_action_kind_allowed', inList('kind', OPERATOR_ACTION_KINDS)),
    check('operator_action_state_allowed', inList('state', OPERATOR_ACTION_STATES)),
    check('operator_action_fingerprint_shape', sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`),
    check('operator_action_actor_present', sql`char_length(${table.requestedBy}) between 1 and ${sql.raw(String(LIMITS.actorSub))}`),
    check('operator_action_correlation_shape', sql`${table.correlationId} ~ '^[A-Za-z0-9._-]{1,128}$'`),
    check('operator_action_reason_length', sql`char_length(${table.reason}) between 3 and 500`),
    check(
      'operator_action_terminal_shape',
      sql`(${table.state} in ('queued', 'running') and ${table.completedAt} is null) or (${table.state} in ('succeeded', 'failed') and ${table.completedAt} is not null)`,
    ),
  ],
);

export type ContentRow = typeof content.$inferSelect;
export type ContentAuditRow = typeof contentAudit.$inferSelect;
export type OutboxEventRow = typeof outboxEvent.$inferSelect;
export type SearchIndexControlRow = typeof searchIndexControl.$inferSelect;
export type OperatorActionRow = typeof operatorAction.$inferSelect;
