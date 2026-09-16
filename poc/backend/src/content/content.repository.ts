/**
 * M1-04 – every write takes the caller's transaction handle. The repository
 * never opens a connection of its own and never commits.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../database.js';
import { content, contentAudit, type ContentAuditRow, type ContentRow } from '../schema.js';
import type { ChangedField } from '../contracts/http.js';
import type { AuditAction, ContentCategory, ContentStatus } from '../schema.js';

export type ContentInsert = typeof content.$inferInsert;
export type ContentPatch = Partial<Omit<ContentInsert, 'id' | 'createdAt' | 'createdBy'>>;

export type AuditEntry = {
  id: string;
  contentId: string;
  contentVersion: number;
  action: AuditAction;
  actorSub: string;
  actorRoles: string[];
  occurredAt: Date;
  correlationId: string;
  changedFields: ChangedField[];
};

@Injectable()
export class ContentRepository {
  /** Serialises concurrent writers on one aggregate; readers are unaffected. */
  async lockById(tx: Transaction, id: string): Promise<ContentRow | undefined> {
    const rows = await tx.select().from(content).where(eq(content.id, id)).for('update');
    return rows[0];
  }

  async findById(executor: Executor, id: string): Promise<ContentRow | undefined> {
    const rows = await executor.select().from(content).where(eq(content.id, id)).limit(1);
    return rows[0];
  }

  /** One filtered query: there is no second, unfiltered read after a check. */
  async findPublished(executor: Executor, id: string, status: ContentStatus = 'published'): Promise<ContentRow | undefined> {
    const rows = await executor
      .select()
      .from(content)
      .where(and(eq(content.id, id), eq(content.status, status)))
      .limit(1);
    return rows[0];
  }

  async insert(tx: Transaction, row: ContentInsert): Promise<ContentRow> {
    const inserted = await tx.insert(content).values(row).returning();
    return inserted[0]!;
  }

  async update(tx: Transaction, id: string, patch: ContentPatch): Promise<ContentRow> {
    const updated = await tx.update(content).set(patch).where(eq(content.id, id)).returning();
    return updated[0]!;
  }

  /**
   * M4-03 – ordered public hydration for the search read path.
   *
   * The index returns ids only; the response fields and the published state both
   * come from here, in one query. A hit that was withdrawn, deleted or moved to
   * another category since it was indexed simply does not come back, which is
   * why a search page may be shorter than the index's estimate. The caller
   * restores the index's relevance order — SQL has no opinion about it.
   */
  async findPublishedByIds(
    executor: Executor,
    ids: readonly string[],
    category: ContentCategory | null = null,
  ): Promise<ContentRow[]> {
    if (ids.length === 0) return [];
    const conditions = [inArray(content.id, [...ids]), eq(content.status, 'published')];
    if (category !== null) conditions.push(eq(content.category, category));
    return executor.select().from(content).where(and(...conditions));
  }

  async insertAudit(tx: Transaction, entry: AuditEntry): Promise<ContentAuditRow> {
    const inserted = await tx.insert(contentAudit).values(entry).returning();
    return inserted[0]!;
  }

  async listAudit(executor: Executor, contentId: string): Promise<ContentAuditRow[]> {
    return executor
      .select()
      .from(contentAudit)
      .where(eq(contentAudit.contentId, contentId))
      .orderBy(sql`${contentAudit.contentVersion} asc`);
  }
}
