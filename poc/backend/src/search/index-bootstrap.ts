/**
 * Index bootstrap (M4-02).
 *
 * Creating an index and changing its settings are both asynchronous tasks, so
 * this module waits for every one of them to reach `succeeded` and then reads
 * the result back. Until that read-back matches, the instance is not routable
 * and its worker asks for no messages.
 *
 * The one judgement call here is telling "index exists but was never
 * provisioned" apart from "index exists with different settings". A freshly
 * created Meilisearch index reports the documented defaults (`['*']` for
 * searchable and displayed attributes, empty filterable and sortable lists);
 * that state is provisioned. Anything else that differs from the M4 contract is
 * an operator's decision we must not silently overwrite — changing
 * `searchableAttributes` re-indexes every document, which is an M5 concern.
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

/** The documented state of an index whose settings were never touched. */
function isUnprovisioned(settings: ManagedSettings): boolean {
  return sameSequence(settings.searchableAttributes, ['*'])
    && sameSequence(settings.displayedAttributes, ['*'])
    && settings.filterableAttributes.length === 0
    && settings.sortableAttributes.length === 0;
}

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
export async function bootstrapIndex(adapter: MeiliIndexAdapter): Promise<BootstrapOutcome> {
  const outcome: BootstrapOutcome = { created: false, settingsApplied: false, primaryKeyApplied: false };

  if (!(await adapter.indexExists())) {
    await awaitSucceeded(adapter, await adapter.createIndex());
    outcome.created = true;
  }

  const primaryKey = await adapter.primaryKey();
  if (primaryKey === null) {
    // An index created without a primary key and still empty can take ours.
    await awaitSucceeded(adapter, await adapter.setPrimaryKey());
    outcome.primaryKeyApplied = true;
  } else if (primaryKey !== SEARCH_PRIMARY_KEY) {
    throw new IndexConfigMismatchError(adapter.alias, ['primaryKey']);
  }

  const settings = await adapter.managedSettings();
  const fields = differences(settings);
  if (fields.length > 0) {
    if (!outcome.created && !isUnprovisioned(settings)) {
      throw new IndexConfigMismatchError(adapter.alias, fields);
    }
    await awaitSucceeded(adapter, await adapter.applyManagedSettings());
    outcome.settingsApplied = true;
    // Read back: the task succeeding is not by itself proof of the end state.
    const applied = differences(await adapter.managedSettings());
    if (applied.length > 0) throw new IndexConfigMismatchError(adapter.alias, applied);
  }

  return outcome;
}
