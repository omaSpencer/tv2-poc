/**
 * M1-05 / M1-06 – the content lifecycle.
 *
 * Order for every write (M1 §4.1): request shape → record exists → expected
 * version → allowed state → normalised target / no-op. Content, audit and the
 * outbox record share one transaction; a failure anywhere rolls all of it back.
 */
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONSTRAINTS, type ContentRow, type ContentStatus } from '../schema.js';
import { DatabaseService, isConnectionFailure, uniqueViolation, type Transaction } from '../database.js';
import {
  ApiError, contentNotFound, slugConflict, validationFailed, versionConflict,
} from '../contracts/errors.js';
import {
  CHANGED_FIELD_ORDER, publishMinimumFailures, type ChangedField, type ContentFields,
  type CreateContentCommand, type PatchContentCommand, type VersionedCommand,
} from '../contracts/http.js';
import type { OperationContext } from '../identity/actor.js';
import { ContentRepository, type ContentPatch } from './content.repository.js';
import { OutboxRepository } from '../outbox/outbox.repository.js';
import { slugCandidates } from './slug.js';

const orderChangedFields = (fields: Iterable<ChangedField>): ChangedField[] => {
  const present = new Set(fields);
  return CHANGED_FIELD_ORDER.filter(field => present.has(field));
};

const currentFields = (row: ContentRow): ContentFields => ({
  title: row.title,
  slug: row.slug,
  summary: row.summary,
  category: row.category as ContentFields['category'],
  mediaAssetId: row.mediaAssetId,
  tags: row.tags,
});

const sameTags = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

function changedBusinessFields(before: ContentFields, after: ContentFields): ChangedField[] {
  const changed: ChangedField[] = [];
  if (before.title !== after.title) changed.push('title');
  if (before.slug !== after.slug) changed.push('slug');
  if (before.summary !== after.summary) changed.push('summary');
  if (before.category !== after.category) changed.push('category');
  if (before.mediaAssetId !== after.mediaAssetId) changed.push('mediaAssetId');
  if (!sameTags(before.tags, after.tags)) changed.push('tags');
  return changed;
}

@Injectable()
export class ContentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ContentRepository) private readonly repository: ContentRepository,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository,
  ) {}

  async create(command: CreateContentCommand, context: OperationContext): Promise<ContentRow> {
    const id = randomUUID();
    const occurredAt = new Date();
    return this.database.transaction(async tx => {
      let row: ContentRow;
      try {
        row = await this.repository.insert(tx, {
          id,
          ...command.fields,
          status: 'draft',
          version: 1,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          publishedAt: null,
          withdrawnAt: null,
          createdBy: context.actor.sub,
          updatedBy: context.actor.sub,
        });
      } catch (error) {
        // A manual slug collision is a client-visible conflict, not a 500.
        if (uniqueViolation(error) === CONSTRAINTS.contentSlugUnique) throw slugConflict();
        throw error;
      }
      await this.writeAudit(tx, row, 'created', orderChangedFields([...command.provided, 'status']), occurredAt, context);
      return row;
    });
  }

  async patch(id: string, command: PatchContentCommand, context: OperationContext): Promise<ContentRow> {
    return this.database.transaction(async tx => {
      const current = await this.requireLocked(tx, id, command.expectedVersion);
      if (current.status === 'published') {
        throw new ApiError('content_not_editable', 'A published content cannot be edited.');
      }
      const before = currentFields(current);
      const after: ContentFields = { ...before, ...command.changes };
      const changed = changedBusinessFields(before, after);
      // No-op: same normalised values on the current version of an editable
      // record. Nothing is written, not even updatedAt or updatedBy.
      if (changed.length === 0) return current;

      const occurredAt = new Date();
      let row: ContentRow;
      try {
        row = await this.repository.update(tx, id, {
          ...after,
          version: current.version + 1,
          updatedAt: occurredAt,
          updatedBy: context.actor.sub,
        });
      } catch (error) {
        if (uniqueViolation(error) === CONSTRAINTS.contentSlugUnique) throw slugConflict();
        throw error;
      }
      await this.writeAudit(tx, row, 'updated', orderChangedFields(changed), occurredAt, context);
      return row;
    });
  }

  async publish(id: string, command: VersionedCommand, context: OperationContext): Promise<ContentRow> {
    return this.database.transaction(async tx => {
      const current = await this.requireLocked(tx, id, command.expectedVersion);
      if (current.status === 'published') {
        throw new ApiError('content_already_published', 'The content is already published.');
      }
      const missing = publishMinimumFailures(currentFields(current));
      if (missing.length > 0) throw validationFailed(missing);

      const occurredAt = new Date();
      const patch: ContentPatch = {
        status: 'published',
        version: current.version + 1,
        updatedAt: occurredAt,
        updatedBy: context.actor.sub,
        publishedAt: occurredAt,
      };
      const changed: ChangedField[] = ['status'];
      let row: ContentRow;
      if (current.slug === null) {
        row = await this.saveWithGeneratedSlug(tx, id, current.title, patch);
        changed.push('slug');
      } else {
        row = await this.repository.update(tx, id, patch);
      }
      await this.writeAudit(tx, row, 'published', orderChangedFields(changed), occurredAt, context);
      await this.outbox.append(tx, {
        eventId: randomUUID(),
        eventType: 'content.published',
        aggregateId: row.id,
        aggregateVersion: row.version,
        occurredAt,
        correlationId: context.correlationId,
      });
      return row;
    });
  }

  async withdraw(id: string, command: VersionedCommand, context: OperationContext): Promise<ContentRow> {
    return this.database.transaction(async tx => {
      const current = await this.requireLocked(tx, id, command.expectedVersion);
      if (current.status !== 'published') {
        throw new ApiError('content_not_published', 'Only a published content can be withdrawn.');
      }
      const occurredAt = new Date();
      // Withdrawal keeps the slug reserved; releasing it is an explicit edit.
      const row = await this.repository.update(tx, id, {
        status: 'withdrawn',
        version: current.version + 1,
        updatedAt: occurredAt,
        updatedBy: context.actor.sub,
        withdrawnAt: occurredAt,
      });
      await this.writeAudit(tx, row, 'withdrawn', ['status'], occurredAt, context);
      await this.outbox.append(tx, {
        eventId: randomUUID(),
        eventType: 'content.withdrawn',
        aggregateId: row.id,
        aggregateVersion: row.version,
        occurredAt,
        correlationId: context.correlationId,
      });
      return row;
    });
  }

  async findForAdmin(id: string): Promise<ContentRow> {
    const row = await this.read(() => this.repository.findById(this.database.db, id));
    if (!row) throw contentNotFound();
    return row;
  }

  /** The public read filters in SQL; a withdrawn record is simply not found. */
  async findPublished(id: string): Promise<ContentRow> {
    const row = await this.read(() => this.repository.findPublished(this.database.db, id));
    if (!row) throw contentNotFound();
    return row;
  }

  private async read<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isConnectionFailure(error)) {
        throw new ApiError('dependency_unavailable', 'The database is currently unavailable.');
      }
      throw error;
    }
  }

  private async requireLocked(tx: Transaction, id: string, expectedVersion: number): Promise<ContentRow> {
    const current = await this.repository.lockById(tx, id);
    if (!current) throw contentNotFound();
    // The version check precedes every state rule, so a stale client never
    // receives a silent success.
    if (current.version !== expectedVersion) throw versionConflict(expectedVersion, current.version);
    return current;
  }

  /**
   * M1 §4.2 – each candidate is written inside a savepoint. Only a slug unique
   * violation is retried; any other SQL error fails the whole transaction.
   * Audit and outbox rows are written after the winning candidate is stored.
   */
  private async saveWithGeneratedSlug(
    tx: Transaction,
    id: string,
    title: string,
    patch: ContentPatch,
  ): Promise<ContentRow> {
    const candidates = slugCandidates(title);
    if (candidates.length === 0) throw validationFailed(['slug']);
    for (const slug of candidates) {
      try {
        return await tx.transaction(sp => this.repository.update(sp, id, { ...patch, slug }));
      } catch (error) {
        if (uniqueViolation(error) === CONSTRAINTS.contentSlugUnique) continue;
        throw error;
      }
    }
    throw slugConflict();
  }

  private async writeAudit(
    tx: Transaction,
    row: ContentRow,
    action: 'created' | 'updated' | 'published' | 'withdrawn',
    changedFields: ChangedField[],
    occurredAt: Date,
    context: OperationContext,
  ): Promise<void> {
    await this.repository.insertAudit(tx, {
      id: randomUUID(),
      contentId: row.id,
      contentVersion: row.version,
      action,
      actorSub: context.actor.sub,
      actorRoles: [...context.actor.roles],
      occurredAt,
      correlationId: context.correlationId,
      changedFields,
    });
  }
}

export type { ContentStatus };
