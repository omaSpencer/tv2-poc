/**
 * Meilisearch adapter (M4-02). One instance of this class per index endpoint.
 *
 * Two rules shape the whole file:
 *
 * 1. **A submitted task is not a finished task.** Every write returns a task
 *    UID that Meilisearch processes asynchronously; HTTP 202 and an `enqueued`
 *    status prove only that the request was accepted. Nothing here reports
 *    success until the task reaches `succeeded`, and the caller polls *the same
 *    task UID* rather than resubmitting, so a lost poll response cannot create a
 *    second write.
 * 2. **Failures are classified, never swallowed.** A wrong API key, a settings
 *    mismatch and a dropped connection need three different operator responses,
 *    so `classifyMeiliError` separates them structurally (error class, HTTP
 *    status, Meilisearch error code) instead of by matching message text.
 */
import { Meilisearch, MeilisearchApiError, type Index } from 'meilisearch';
import {
  SEARCH_DISPLAYED_ATTRIBUTES, SEARCH_FILTERABLE_ATTRIBUTES, SEARCH_PRIMARY_KEY,
  SEARCH_SEARCHABLE_ATTRIBUTES, SEARCH_SORTABLE_ATTRIBUTES,
  type SearchProjectionV1,
} from '../contracts/search.js';
import type { SearchInstanceConfig } from './search.config.js';

export type MeiliTaskState = 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export type MeiliTaskResult = {
  uid: number;
  status: MeiliTaskState;
  /** Meilisearch's own error code, e.g. `invalid_document_fields`. */
  errorCode: string | null;
};

/**
 * How a failure must be handled, not what caused it:
 *
 * - `transient`  – retry the same operation after a backoff (network, timeout, 429, 5xx).
 * - `config`     – halt the instance for an operator (401/403, settings/primary key mismatch).
 * - `not_found`  – the index is gone; re-run bootstrap rather than retrying blindly.
 * - `client_error` – a 4xx we generated ourselves; retrying cannot help.
 */
export type MeiliFailureKind = 'transient' | 'config' | 'not_found' | 'client_error';

export class IndexConfigMismatchError extends Error {
  constructor(readonly alias: string, readonly fields: string[]) {
    super(`Meilisearch index ${alias} configuration differs from the M4 contract: ${fields.join(', ')}`);
    this.name = 'IndexConfigMismatchError';
  }
}

export class MeiliTaskFailedError extends Error {
  constructor(readonly taskUid: number, readonly errorCode: string | null) {
    super(`Meilisearch task ${taskUid} did not succeed (${errorCode ?? 'no error code'}).`);
    this.name = 'MeiliTaskFailedError';
  }
}

/** A task that stayed enqueued/processing past its poll budget. Not a success. */
export class MeiliTaskTimeoutError extends Error {
  constructor(readonly taskUid: number, readonly lastStatus: MeiliTaskState) {
    super(`Meilisearch task ${taskUid} was still ${lastStatus} when the poll budget expired.`);
    this.name = 'MeiliTaskTimeoutError';
  }
}

function apiErrorStatus(error: unknown): number | null {
  if (!(error instanceof MeilisearchApiError)) return null;
  const status = (error as { response?: { status?: number } }).response?.status;
  return typeof status === 'number' ? status : null;
}

/** Meilisearch's machine-readable error code, when the response carried one. */
export function meiliErrorCode(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === 'string' ? cause.code : null;
}

/**
 * Structural classification. Note the default: anything unrecognised is
 * `transient`. A reverse proxy answering 502 with an HTML body makes the client
 * throw a plain `SyntaxError`, and treating that as a permanent client error
 * would quarantine a healthy event.
 */
export function classifyMeiliError(error: unknown): MeiliFailureKind {
  if (error instanceof IndexConfigMismatchError) return 'config';
  const status = apiErrorStatus(error);
  if (status === null) return 'transient';
  if (status === 401 || status === 403) return 'config';
  if (status === 404 && meiliErrorCode(error) === 'index_not_found') return 'not_found';
  if (status === 429 || status >= 500) return 'transient';
  if (status >= 400) return 'client_error';
  return 'transient';
}

/**
 * Document-level errors that will fail identically on every retry: the event is
 * valid but its projection cannot be indexed. These become quarantine, not an
 * endless retry loop.
 */
const PERMANENT_TASK_ERROR_CODES = new Set([
  'invalid_document_fields',
  'missing_document_id',
  'invalid_document_id',
  'invalid_document_geo_field',
  'invalid_document_format',
  'payload_too_large',
  'malformed_payload',
  'invalid_request',
]);

export function isPermanentTaskError(errorCode: string | null): boolean {
  return errorCode !== null && PERMANENT_TASK_ERROR_CODES.has(errorCode);
}

const TERMINAL: ReadonlySet<MeiliTaskState> = new Set<MeiliTaskState>(['succeeded', 'failed', 'canceled']);

export type MeiliAdapterOptions = {
  indexUid: string;
  searchTimeoutMs: number;
  taskTimeoutMs: number;
  taskPollMs: number;
};

export type MeiliSearchHits = {
  ids: string[];
  estimatedTotalHits: number;
};

export class MeiliIndexAdapter {
  private readonly client: Meilisearch;

  constructor(
    readonly instance: SearchInstanceConfig,
    private readonly options: MeiliAdapterOptions,
  ) {
    this.client = new Meilisearch({
      host: instance.url,
      apiKey: instance.apiKey,
      // Per-request ceiling. The worker adds its own budget on top for tasks.
      timeout: options.searchTimeoutMs,
    });
  }

  get alias(): string {
    return this.instance.alias;
  }

  get indexUid(): string {
    return this.options.indexUid;
  }

  private index(uid = this.options.indexUid): Index {
    return this.client.index(uid);
  }

  /** Cheap reachability probe for processing-status. Never throws. */
  async reachable(): Promise<boolean> {
    try {
      await this.client.health();
      return true;
    } catch {
      return false;
    }
  }

  async version(): Promise<string> {
    return (await this.client.getVersion()).pkgVersion;
  }

  async indexExists(): Promise<boolean> {
    try {
      await this.index().getRawInfo();
      return true;
    } catch (error) {
      if (classifyMeiliError(error) === 'not_found') return false;
      throw error;
    }
  }

  async primaryKey(): Promise<string | null> {
    const info = await this.index().getRawInfo();
    return info.primaryKey ?? null;
  }

  async managedSettings(): Promise<{
    searchableAttributes: string[];
    filterableAttributes: string[];
    displayedAttributes: string[];
    sortableAttributes: string[];
  }> {
    const settings = await this.index().getSettings();
    // `filterableAttributes` can carry object entries in newer Meilisearch
    // versions; M4 only ever sets plain names, so anything else is recorded as
    // a difference rather than coerced into looking equal.
    const names = (values: unknown): string[] =>
      Array.isArray(values) ? values.map(value => (typeof value === 'string' ? value : JSON.stringify(value))) : [];
    return {
      searchableAttributes: names(settings.searchableAttributes),
      filterableAttributes: names(settings.filterableAttributes),
      displayedAttributes: names(settings.displayedAttributes),
      sortableAttributes: names(settings.sortableAttributes),
    };
  }

  async createIndex(): Promise<number> {
    const task = await this.client.createIndex(this.options.indexUid, { primaryKey: SEARCH_PRIMARY_KEY });
    return task.taskUid;
  }

  async setPrimaryKey(): Promise<number> {
    const task = await this.index().update({ primaryKey: SEARCH_PRIMARY_KEY });
    return task.taskUid;
  }

  async applyManagedSettings(): Promise<number> {
    const task = await this.index().updateSettings({
      searchableAttributes: [...SEARCH_SEARCHABLE_ATTRIBUTES],
      filterableAttributes: [...SEARCH_FILTERABLE_ATTRIBUTES],
      displayedAttributes: [...SEARCH_DISPLAYED_ATTRIBUTES],
      sortableAttributes: [...SEARCH_SORTABLE_ATTRIBUTES],
    });
    return task.taskUid;
  }

  async createNamedIndex(uid: string): Promise<number> {
    const task = await this.client.createIndex(uid, { primaryKey: SEARCH_PRIMARY_KEY });
    return task.taskUid;
  }

  async namedIndexExists(uid: string): Promise<boolean> {
    try {
      await this.index(uid).getRawInfo();
      return true;
    } catch (error) {
      if (classifyMeiliError(error) === 'not_found') return false;
      throw error;
    }
  }

  async deleteNamedIndex(uid: string): Promise<number | null> {
    if (!(await this.namedIndexExists(uid))) return null;
    const task = await this.client.deleteIndex(uid);
    return task.taskUid;
  }

  async applyManagedSettingsTo(uid: string): Promise<number> {
    const task = await this.index(uid).updateSettings({
      searchableAttributes: [...SEARCH_SEARCHABLE_ATTRIBUTES],
      filterableAttributes: [...SEARCH_FILTERABLE_ATTRIBUTES],
      displayedAttributes: [...SEARCH_DISPLAYED_ATTRIBUTES],
      sortableAttributes: [...SEARCH_SORTABLE_ATTRIBUTES],
    });
    return task.taskUid;
  }

  async managedSettingsOf(uid: string): ReturnType<MeiliIndexAdapter['managedSettings']> {
    const settings = await this.index(uid).getSettings();
    const names = (values: unknown): string[] =>
      Array.isArray(values) ? values.map(value => (typeof value === 'string' ? value : JSON.stringify(value))) : [];
    return {
      searchableAttributes: names(settings.searchableAttributes),
      filterableAttributes: names(settings.filterableAttributes),
      displayedAttributes: names(settings.displayedAttributes),
      sortableAttributes: names(settings.sortableAttributes),
    };
  }

  async submitBatch(uid: string, documents: SearchProjectionV1[]): Promise<number> {
    const task = await this.index(uid).addDocuments(documents, { primaryKey: SEARCH_PRIMARY_KEY });
    return task.taskUid;
  }

  async documentCount(uid: string): Promise<number> {
    return (await this.index(uid).getStats()).numberOfDocuments;
  }

  async swapWithLive(stagingUid: string): Promise<number> {
    // Meilisearch 1.15 accepts only `indexes` here. The pinned JS client also
    // models the later `rename` flag as required, so keep the runtime request
    // compatible with the server image and isolate the type-version skew.
    const swaps = ([{ indexes: [this.options.indexUid, stagingUid] }] as unknown) as Parameters<Meilisearch['swapIndexes']>[0];
    const task = await this.client.swapIndexes(swaps);
    return task.taskUid;
  }

  async projectionPage(uid: string, offset: number, limit: number): Promise<Array<{ id: string; aggregateVersion: number }>> {
    const result = await this.index(uid).getDocuments<{ id: string; aggregateVersion: number }>({
      offset,
      limit,
      fields: ['id', 'aggregateVersion'],
    });
    return result.results.map(document => ({ id: document.id, aggregateVersion: document.aggregateVersion }));
  }

  /** Bounded verifier lookup: at most the caller's keyset page is materialised. */
  async projectionsByIds(
    uid: string,
    ids: readonly string[],
  ): Promise<Array<{ id: string; aggregateVersion: number }>> {
    if (ids.length === 0) return [];
    const result = await this.index(uid).getDocuments<{ id: string; aggregateVersion: number }>({
      ids: [...ids],
      limit: ids.length,
      fields: ['id', 'aggregateVersion'],
    });
    return result.results.map(document => ({ id: document.id, aggregateVersion: document.aggregateVersion }));
  }

  async documentVersion(id: string): Promise<number | null> {
    try {
      const document = await this.index().getDocument<{ id: string; aggregateVersion: number }>(id, {
        fields: ['id', 'aggregateVersion'],
      });
      return typeof document.aggregateVersion === 'number' ? document.aggregateVersion : null;
    } catch (error) {
      if (classifyMeiliError(error) === 'not_found' || meiliErrorCode(error) === 'document_not_found') return null;
      throw error;
    }
  }

  /** Idempotent: the same document written twice leaves the same end state. */
  async submitUpsert(document: SearchProjectionV1): Promise<number> {
    const task = await this.index().addDocuments([document], { primaryKey: SEARCH_PRIMARY_KEY });
    return task.taskUid;
  }

  /** Idempotent: deleting an absent id succeeds with `deletedDocuments: 0`. */
  async submitDelete(id: string): Promise<number> {
    const task = await this.index().deleteDocument(id);
    return task.taskUid;
  }

  async taskStatus(taskUid: number): Promise<MeiliTaskResult> {
    const task = await this.client.tasks.getTask(taskUid);
    return {
      uid: task.uid,
      status: task.status as MeiliTaskState,
      errorCode: task.error?.code ?? null,
    };
  }

  /**
   * Polls one task UID to a terminal state. `onTick` runs between polls so the
   * caller can keep a JetStream delivery alive with `working()` while a long
   * indexing task runs. Exceeding the budget throws — it never counts as
   * success, and the caller keeps the same task UID to poll again.
   */
  async awaitTask(
    taskUid: number,
    onTick?: () => void,
    signal?: { aborted: boolean },
  ): Promise<MeiliTaskResult> {
    const deadline = Date.now() + this.options.taskTimeoutMs;
    let last: MeiliTaskResult = { uid: taskUid, status: 'enqueued', errorCode: null };
    for (;;) {
      last = await this.taskStatus(taskUid);
      if (TERMINAL.has(last.status)) return last;
      if (signal?.aborted) throw new MeiliTaskTimeoutError(taskUid, last.status);
      if (Date.now() >= deadline) throw new MeiliTaskTimeoutError(taskUid, last.status);
      onTick?.();
      await new Promise(resolve => setTimeout(resolve, this.options.taskPollMs));
    }
  }

  /**
   * Read path. `displayedAttributes` is `['id']`, so this genuinely cannot
   * return an editorial field even if one were indexed by mistake; the ids are
   * re-read from PostgreSQL by the caller.
   */
  async search(
    q: string,
    options: { category: string | null; limit: number; offset: number },
  ): Promise<MeiliSearchHits> {
    const response = await this.index().search(q, {
      limit: options.limit,
      offset: options.offset,
      ...(options.category === null ? {} : { filter: `category = ${JSON.stringify(options.category)}` }),
    });
    const ids: string[] = [];
    for (const hit of response.hits) {
      const id = (hit as { id?: unknown }).id;
      if (typeof id === 'string') ids.push(id);
    }
    return { ids, estimatedTotalHits: response.estimatedTotalHits ?? ids.length };
  }
}
