import {
  SEARCH_DISPLAYED_ATTRIBUTES,
  SEARCH_FILTERABLE_ATTRIBUTES,
  SEARCH_SEARCHABLE_ATTRIBUTES,
  SEARCH_SORTABLE_ATTRIBUTES,
} from '../contracts/search.js';

export type ManagedSettings = {
  searchableAttributes: string[];
  filterableAttributes: string[];
  displayedAttributes: string[];
  sortableAttributes: string[];
};

const expectedSettings: ManagedSettings = {
  searchableAttributes: [...SEARCH_SEARCHABLE_ATTRIBUTES],
  filterableAttributes: [...SEARCH_FILTERABLE_ATTRIBUTES],
  displayedAttributes: [...SEARCH_DISPLAYED_ATTRIBUTES],
  sortableAttributes: [...SEARCH_SORTABLE_ATTRIBUTES],
};

const sameSequence = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameSet = (left: readonly string[], right: readonly string[]): boolean =>
  sameSequence([...left].sort(), [...right].sort());

/** Preserve newer object-shaped Meilisearch settings as visible mismatches. */
export function normalizeManagedAttributeNames(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map(value => typeof value === 'string' ? value : JSON.stringify(value))
    : [];
}

/** Field names only; operator-provided values never enter diagnostics. */
export function managedSettingsDifferences(
  settings: ManagedSettings,
  expected: ManagedSettings = expectedSettings,
): Array<keyof ManagedSettings> {
  const fields: Array<keyof ManagedSettings> = [];
  if (!sameSequence(settings.searchableAttributes, expected.searchableAttributes)) {
    fields.push('searchableAttributes');
  }
  if (!sameSet(settings.filterableAttributes, expected.filterableAttributes)) {
    fields.push('filterableAttributes');
  }
  if (!sameSet(settings.displayedAttributes, expected.displayedAttributes)) {
    fields.push('displayedAttributes');
  }
  if (!sameSet(settings.sortableAttributes, expected.sortableAttributes)) {
    fields.push('sortableAttributes');
  }
  return fields;
}
