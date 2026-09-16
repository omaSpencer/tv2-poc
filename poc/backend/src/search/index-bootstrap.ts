/**
 * Index bootstrap (M4-02).
 *
 * Creating an index and changing its settings are both asynchronous tasks, so
 * this module waits for every one of them to reach `succeeded` and then reads
 * the result back. Until that read-back matches, the instance is not routable
 * and its worker asks for no messages.
 *
 * Only an index created by this bootstrap may have its settings changed.
 * A retained session resumes accepted tasks after transient poll failures.
 */
import {
  SEARCH_DISPLAYED_ATTRIBUTES, SEARCH_FILTERABLE_ATTRIBUTES, SEARCH_PRIMARY_KEY,
  SEARCH_SEARCHABLE_ATTRIBUTES, SEARCH_SORTABLE_ATTRIBUTES,
} from '../contracts/search.js';
import {
  IndexConfigMismatchError, MeiliTaskFailedError, type MeiliIndexAdapter,
} from './meili.adapter.js';

type ManagedSettings = {
  searchableAttributes: string[];
  filterableAttributes: string[];
  displayedAttributes: string[];
  sortableAttributes: string[];
};

const sameSequence = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  sameSequence([...left].sort(), [...right].sort());

/** Field names only; the comparison never echoes an operator's own values. */
function differences(settings: ManagedSettings): string[] {
  const fields: string[] = [];
  // Searchable order is the D08 importance order, so it is compared as a sequence.
  if (!sameSequence(settings.searchableAttributes, SEARCH_SEARCHABLE_ATTRIBUTES)) {
    fields.push('searchableAttributes');
  }
  if (!sameSet(settings.filterableAttributes, SEARCH_FILTERABLE_ATTRIBUTES)) {
    fields.push('filterableAttributes');
  }
  if (!sameSet(settings.displayedAttributes, SEARCH_DISPLAYED_ATTRIBUTES)) {
    fields.push('displayedAttributes');
  }
  if (!sameSet(settings.sortableAttributes, SEARCH_SORTABLE_ATTRIBUTES)) {
    fields.push('sortableAttributes');
  }
  return fields;
}

export type BootstrapOutcome = {
  created: boolean;
  settingsApplied: boolean;
  primaryKeyApplied: boolean;
};

async function awaitSucceeded(adapter: MeiliIndexAdapter, taskUid: number): Promise<void> {
  const result = await adapter.awaitTask(taskUid);
  if (result.status !== 'succeeded') throw new MeiliTaskFailedError(result.uid, result.errorCode);
}

/**
 * Create-or-verify. Returns what it actually had to do, which is how the T02
 * "a repeated bootstrap issues no further settings task" assertion is made.
 * Throws `IndexConfigMismatchError` for a divergent existing index; every other
 * failure propagates for the caller to classify.
 */
type BootstrapSession = { created: boolean; createTask?: number; settingsTask?: number };
const sessions = new WeakMap<MeiliIndexAdapter, BootstrapSession>();

export async function bootstrapIndex(adapter: MeiliIndexAdapter): Promise<BootstrapOutcome> {
  let session = sessions.get(adapter);
  if (!session) {
    session = { created: false };
    sessions.set(adapter, session);
  }
  const outcome: BootstrapOutcome = { created: false, settingsApplied: false, primaryKeyApplied: false };
  try {
    if (session.createTask === undefined && !(await adapter.indexExists())) {
      session.created = false;
      session.settingsTask = undefined;
      session.createTask = await adapter.createIndex();
    }
    if (session.createTask !== undefined) {
      await awaitSucceeded(adapter, session.createTask);
      session.created = true;
      session.createTask = undefined;
      outcome.created = true;
    }

    // createIndex already specifies the key. Never mutate an existing index's key.
    if (await adapter.primaryKey() !== SEARCH_PRIMARY_KEY) {
      throw new IndexConfigMismatchError(adapter.alias, ['primaryKey']);
    }
    const fields = differences(await adapter.managedSettings());
    if (fields.length > 0 || session.settingsTask !== undefined) {
      if (!session.created) throw new IndexConfigMismatchError(adapter.alias, fields);
      session.settingsTask ??= await adapter.applyManagedSettings();
      await awaitSucceeded(adapter, session.settingsTask);
      outcome.settingsApplied = true;
      const applied = differences(await adapter.managedSettings());
      if (applied.length > 0) throw new IndexConfigMismatchError(adapter.alias, applied);
    }
    sessions.delete(adapter);
    return outcome;
  } catch (error) {
    if (error instanceof IndexConfigMismatchError) sessions.delete(adapter);
    if (error instanceof MeiliTaskFailedError) {
      // A failed create proves no ownership. A failed settings task is spent,
      // but this session still owns the index and may retry its provisioning.
      if (session.createTask === error.taskUid) sessions.delete(adapter);
      else if (session.settingsTask === error.taskUid) session.settingsTask = undefined;
    }
    throw error;
  }
}
