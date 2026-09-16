/**
 * Event → index operation (M4-03).
 *
 * The event is a *change notification*, never the source of the projection. The
 * worker re-reads the aggregate from PostgreSQL for every message and decides
 * from the row it finds, which is what makes replay safe: a `content.published`
 * event replayed after a withdrawal converges on a delete, and a duplicate
 * event on a published row rewrites the same document. `aggregateVersion` is
 * therefore the current database version, not the version the old event carried.
 */
import type { ContentRow } from '../schema.js';
import type { ContentCategory } from '../schema.js';
import type { SearchProjectionV1 } from '../contracts/search.js';

export type ProjectionDecision =
  | { operation: 'upsert'; document: SearchProjectionV1 }
  | { operation: 'delete'; id: string }
  /** Valid event, unusable projection: quarantine rather than retry forever. */
  | { operation: 'reject'; id: string; fields: string[] };

export function projectionFor(id: string, row: ContentRow | undefined): ProjectionDecision {
  // Missing, draft and withdrawn all mean the same thing to the index.
  if (row === undefined || row.status !== 'published') return { operation: 'delete', id };

  const missing: string[] = [];
  if (row.summary === null) missing.push('summary');
  if (row.category === null) missing.push('category');
  if (typeof row.title !== 'string' || row.title.length === 0) missing.push('title');
  // The published minimum is a database check constraint, so this branch means
  // the row was written by something that bypassed it. Retrying cannot fix it.
  if (missing.length > 0) return { operation: 'reject', id, fields: missing };

  return {
    operation: 'upsert',
    document: {
      id: row.id,
      title: row.title,
      summary: row.summary as string,
      category: row.category as ContentCategory,
      tags: row.tags,
      aggregateVersion: row.version,
    },
  };
}
