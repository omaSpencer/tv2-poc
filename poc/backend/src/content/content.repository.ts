/**
 * M1-04 – every write takes the caller's transaction handle. The repository
 * never opens a connection of its own and never commits.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Executor, Transaction } from '../database.js';
import { content, contentAudit, type ContentAuditRow, type ContentRow } from '../schema.js';
import type { ChangedField } from '../contracts/http.js';
import type { AuditAction, ContentCategory, ContentStatus } from '../schema.js';
import type { AdminContentListQuery, ContentAuditQuery } from '../contracts/admin-content-list.js';

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

export type AdminContentListRow = Pick<
  ContentRow,
  'id' | 'title' | 'slug' | 'category' | 'status' | 'version' | 'updatedAt' | 'updatedBy' | 'publishedAt'
>;

function escapedContains(value: string): string {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

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

  async listForAdmin(executor: Executor, query: AdminContentListQuery): Promise<AdminContentListRow[]> {
    const conditions: SQL[] = [];
    if (query.status !== null) conditions.push(eq(content.status, query.status));
    if (query.category !== null) conditions.push(eq(content.category, query.category));
    if (query.q !== null) {
      const pattern = escapedContains(query.q);
      const textMatch = or(
        sql`${content.title} ilike ${pattern} escape '\\'`,
        sql`${content.slug} ilike ${pattern} escape '\\'`,
      );
      const idMatch = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.q)
        ? eq(content.id, query.q)
        : undefined;
      conditions.push(idMatch ? or(textMatch, idMatch)! : textMatch!);
    }
    if (query.cursor !== null) {
      const updatedAt = new Date(query.cursor.updatedAt);
      conditions.push(or(
        lt(content.updatedAt, updatedAt),
        and(eq(content.updatedAt, updatedAt), lt(content.id, query.cursor.id)),
      )!);
    }
    return executor
      .select({
        id: content.id,
        title: content.title,
        slug: content.slug,
        category: content.category,
        status: content.status,
        version: content.version,
        updatedAt: content.updatedAt,
        updatedBy: content.updatedBy,
        publishedAt: content.publishedAt,
      })
      .from(content)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(content.updatedAt), desc(content.id))
      .limit(query.limit + 1);
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

  async listAudit(executor: Executor, contentId: string, query?: ContentAuditQuery): Promise<ContentAuditRow[]> {
    const conditions = [eq(contentAudit.contentId, contentId)];
    if (query?.cursor) conditions.push(lt(contentAudit.contentVersion, query.cursor.contentVersion));
    return executor
      .select()
      .from(contentAudit)
      .where(and(...conditions))
      .orderBy(query ? desc(contentAudit.contentVersion) : sql`${contentAudit.contentVersion} asc`)
      .limit(query ? query.limit + 1 : 2_147_483_647);
  }
}
