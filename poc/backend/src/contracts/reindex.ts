/**
 * M5 – durable reindex state, operator error vocabulary and status contracts.
 *
 * Everything here is *operational* state, never business content. It lives in
 * `contracts/` for the same reason the event envelope does: the CLI process,
 * the worker process and the status endpoint all have to agree on the exact
 * spelling of a phase and of an error code, and a stable spelling is what makes
 * an evidence log reproducible.
 *
 * Two rules shape the file:
 *
 * 1. **Only `ready` is routable.** Every other phase — including the ones that
 *    look harmless, like `verifying` — means the index may not answer a public
 *    search. The list below is the single place that decision is written down.
 * 2. **Codes are stable and secret-free.** An operator code never carries a
 *    URL, an API key, a database name or a payload; it is a fixed identifier
 *    that a runbook entry can be keyed on.
 */
import { SEARCH_INDEX_ALIASES, type SearchIndexAlias } from './search.js';
import { REINDEX_PHASES, WORKER_DESIRED_STATES, type ReindexPhase, type WorkerDesiredState } from '../schema.js';

/**
 * Lifecycle of one index's durable reindex state. The list itself lives in
 * `schema.ts` beside the CHECK constraint it generates; it is re-exported here
 * so the CLI and the status contract never import the database schema.
 *
 * `draining` … `verifying` are the ordered steps of a single run; `failed` is
 * the terminal state of an interrupted or mismatching run. There is no
 * `cancelled`: an abandoned run is indistinguishable from a crashed one from
 * the database's point of view, and both need the same operator response.
 */
export { REINDEX_PHASES, WORKER_DESIRED_STATES };
export type { ReindexPhase, WorkerDesiredState };

/** The ordered steps a successful run passes through, for progress reporting. */
export const REINDEX_RUN_PHASES: readonly ReindexPhase[] = [
  'draining', 'importing', 'swapping', 'catching_up', 'verifying',
];

/**
 * The one place routability is decided. A `phase` that is not exactly `ready`
 * keeps the index out of the read path, whatever the in-process worker happens
 * to believe about itself.
 */
export function phaseIsRoutable(phase: ReindexPhase | null | undefined): boolean {
  return phase === 'ready';
}

/**
 * Stable operator codes. `last_error_code` and every non-zero CLI exit use one
 * of these; nothing else is ever written into that column.
 */
export const REINDEX_ERROR_CODES = [
  /** Another reindex holds the global or the per-index advisory lock. */
  'reindex_already_running',
  /** The other index is not `ready + reachable` and no outage was confirmed. */
  'other_index_unavailable',
  /** A production/outage run did not name the exact target database. */
  'target_confirmation_required',
  /** A live worker did not acknowledge the pause inside the drain budget. */
  'worker_drain_timeout',
  /** The snapshot transaction exceeded its statement or import budget. */
  'snapshot_timeout',
  /** The relay did not deliver every row up to the recorded high-water mark. */
  'relay_drain_timeout',
  /** `S0+1 … S1` is no longer fully present in the stream. */
  'stream_history_gap',
  /** A staging import task reached `failed` or `canceled`. */
  'import_task_failed',
  /** Staging document count does not match the snapshot count. */
  'import_count_mismatch',
  /** The whole import section exceeded `REINDEX_IMPORT_TIMEOUT_MS`. */
  'import_timeout',
  /** The staging/live swap task did not reach `succeeded`. */
  'swap_task_failed',
  /** The durable did not reach the recorded catch-up boundary in time. */
  'catch_up_timeout',
  /** The worker halted or stayed in retry while catching up. */
  'catch_up_worker_unhealthy',
  /** The bounded exclusive verify section ran out of budget. */
  'verify_timeout',
  /** DB and index `id + aggregateVersion` sets differ. */
  'verify_mismatch',
  /** A Meilisearch endpoint could not be reached during the run. */
  'index_unreachable',
  /** The broker could not be reached during the run. */
  'broker_unavailable',
  /** The control row for the alias is missing; the migration did not run. */
  'control_row_missing',
  /** SIGTERM/SIGINT: the run stopped without reaching `ready`. */
  'aborted',
  /** An unclassified failure. The structured log carries the detail. */
  'internal_error',
] as const;
export type ReindexErrorCode = (typeof REINDEX_ERROR_CODES)[number];

/** Quarantine CLI outcomes, kept apart from the reindex run codes. */
export const QUARANTINE_OPERATION_CODES = [
  'quarantine_not_found',
  'quarantine_original_expired',
  'quarantine_schema_invalid',
  'quarantine_aggregate_unknown',
  'quarantine_reason_required',
  'repair_target_unknown',
  'repair_task_failed',
] as const;
export type QuarantineOperationCode = (typeof QUARANTINE_OPERATION_CODES)[number];

/**
 * Staging index UID. Deliberately derived, not random: an operator who finds a
 * stray index can read the run it belongs to straight off the name, and the
 * cleanup step can refuse to touch anything that does not match this shape.
 */
export function stagingIndexUid(liveUid: string, runId: string): string {
  return `${liveUid}__rebuild__${runId.replace(/-/g, '')}`;
}

const STAGING_SUFFIX = /__rebuild__[0-9a-f]{32}$/;

/** True only for a UID this milestone created. Guards every delete. */
export function isStagingIndexUid(uid: string, liveUid: string): boolean {
  return uid.startsWith(`${liveUid}__rebuild__`) && STAGING_SUFFIX.test(uid);
}

/** Durable reindex state as the status endpoint and the CLI report it. */
export type ReindexControlView = {
  indexAlias: SearchIndexAlias;
  phase: ReindexPhase;
  desiredWorkerState: WorkerDesiredState;
  runId: string | null;
  ownerId: string | null;
  ownerHeartbeatAt: string | null;
  workerHeartbeatAt: string | null;
  workerPausedAt: string | null;
  workerInFlightEventId: string | null;
  snapshotStreamSequence: number | null;
  outboxHighWater: number | null;
  catchUpStreamSequence: number | null;
  importedDocuments: number;
  expectedDocuments: number | null;
  lastErrorCode: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  /** The merged verdict: `phase === 'ready'`, the runtime agrees, and the endpoint is not known to be unreachable. */
  routeEligible: boolean;
};

export type ReindexStatusView = Record<SearchIndexAlias, ReindexControlView>;

export const REINDEX_INDEX_ALIASES = SEARCH_INDEX_ALIASES;
export type ReindexIndexAlias = SearchIndexAlias;

/**
 * Advisory lock keys. PostgreSQL advisory locks live in one global space
 * addressed by two 32-bit integers, so the class number is what keeps the
 * reindex lock and the content write barrier from ever colliding.
 */
export const ADVISORY_LOCK_CLASS = {
  /** `reindex` scope: objid 0 is global, 1 is index `a`, 2 is index `b`. */
  reindex: 415_001,
  /** The publish/withdraw ↔ verify barrier. Objid is always 0. */
  writeBarrier: 415_002,
} as const;

export const ADVISORY_LOCK_OBJECT = {
  global: 0,
  writeBarrier: 0,
} as const;

/** 1-based so `0` stays reserved for the global reindex lock. */
export function reindexLockObject(alias: SearchIndexAlias): number {
  return SEARCH_INDEX_ALIASES.indexOf(alias) + 1;
}
