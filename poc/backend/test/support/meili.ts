/**
 * Meilisearch helpers for the M4 integration suite.
 *
 * Isolation rule for the whole milestone: every run gets its own database, its
 * own JetStream stream and durables, and its own index UID **on both
 * instances**. Cleanup touches only those. Nothing here ever deletes an index
 * the run did not create, so a developer's `contents` index survives a suite
 * that is killed mid-way.
 */
import { randomUUID } from 'node:crypto';
import { Meilisearch } from 'meilisearch';

export type MeiliEndpoint = { url: string; key: string };

export function meiliEndpoints(): { a: MeiliEndpoint; b: MeiliEndpoint } | null {
  const aUrl = process.env.MEILI_A_URL;
  const aKey = process.env.MEILI_A_KEY;
  const bUrl = process.env.MEILI_B_URL;
  const bKey = process.env.MEILI_B_KEY;
  if (!aUrl || !aKey || !bUrl || !bKey) return null;
  return { a: { url: aUrl, key: aKey }, b: { url: bUrl, key: bKey } };
}

export function hasMeili(): boolean {
  return meiliEndpoints() !== null;
}

/** `contents_m4_<runId>`; the plan's naming, so a stray index is identifiable. */
export function isolatedIndexUid(runId = randomUUID().replace(/-/g, '').slice(0, 10)): string {
  return `contents_m4_${runId}`;
}

export function meiliClient(endpoint: MeiliEndpoint): Meilisearch {
  return new Meilisearch({ host: endpoint.url, apiKey: endpoint.key, timeout: 5000 });
}

/** Deletes one index on both instances; absent is success, not an error. */
export async function dropIndex(indexUid: string): Promise<void> {
  const endpoints = meiliEndpoints();
  if (!endpoints) return;
  await Promise.all([endpoints.a, endpoints.b].map(async endpoint => {
    try {
      const client = meiliClient(endpoint);
      const task = await client.deleteIndex(indexUid);
      await client.tasks.waitForTask(task.taskUid, { timeout: 10_000, interval: 50 });
    } catch { /* never created, already gone */ }
  }));
}

export type IndexedDocument = {
  id: string;
  title?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  aggregateVersion?: number;
};

/**
 * Reads the stored document directly, bypassing `displayedAttributes` — the
 * projection assertions need the whole document, while the application must
 * never see more than the id.
 */
export async function storedDocument(
  endpoint: MeiliEndpoint,
  indexUid: string,
  id: string,
): Promise<IndexedDocument | null> {
  try {
    return await meiliClient(endpoint).index(indexUid).getDocument(id, {
      fields: ['id', 'title', 'summary', 'category', 'tags', 'aggregateVersion'],
    }) as IndexedDocument;
  } catch {
    return null;
  }
}

export async function documentCount(endpoint: MeiliEndpoint, indexUid: string): Promise<number> {
  try {
    const stats = await meiliClient(endpoint).index(indexUid).getStats();
    return stats.numberOfDocuments;
  } catch {
    return 0;
  }
}

/** Writes a document straight into one instance, to stage a stale-hit case. */
export async function seedDocument(
  endpoint: MeiliEndpoint,
  indexUid: string,
  document: IndexedDocument,
): Promise<void> {
  const client = meiliClient(endpoint);
  const task = await client.index(indexUid).addDocuments([document], { primaryKey: 'id' });
  await client.tasks.waitForTask(task.taskUid, { timeout: 10_000, interval: 50 });
}

export async function applySettings(
  endpoint: MeiliEndpoint,
  indexUid: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const client = meiliClient(endpoint);
  try {
    const created = await client.createIndex(indexUid, { primaryKey: 'id' });
    await client.tasks.waitForTask(created.taskUid, { timeout: 10_000, interval: 50 });
  } catch { /* already exists */ }
  const task = await client.index(indexUid).updateSettings(settings);
  await client.tasks.waitForTask(task.taskUid, { timeout: 10_000, interval: 50 });
}

export async function readSettings(
  endpoint: MeiliEndpoint,
  indexUid: string,
): Promise<{ searchableAttributes: string[]; filterableAttributes: string[]; displayedAttributes: string[] }> {
  const settings = await meiliClient(endpoint).index(indexUid).getSettings();
  const names = (values: unknown): string[] =>
    Array.isArray(values) ? values.map(v => (typeof v === 'string' ? v : JSON.stringify(v))) : [];
  return {
    searchableAttributes: names(settings.searchableAttributes),
    filterableAttributes: names(settings.filterableAttributes),
    displayedAttributes: names(settings.displayedAttributes),
  };
}
