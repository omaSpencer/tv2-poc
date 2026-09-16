/**
 * Outbox recording (M1) and delivery marking (M3). `delivered_at` stays null
 * until the relay writes it after a JetStream publish ACK; nothing here
 * contacts a broker.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../database.js';
import { outboxEvent, type OutboxEventRow } from '../schema.js';
import { contentEventV1Schema, EVENT_SCHEMA_VERSION, type ContentEventV1 } from '../contracts/events.js';
import { ApiError } from '../contracts/errors.js';

export type OutboxAppend = {
  eventId: string;
  eventType: ContentEventV1['eventType'];
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: Date;
  correlationId: string;
};

const PAYLOAD_STATUS = {
  'content.published': 'published',
  'content.withdrawn': 'withdrawn',
} as const;

/** Rebuild the wire envelope from stored columns — same mapping as `append`. */
export function envelopeFromRow(row: OutboxEventRow): unknown {
  return {
    eventId: row.eventId,
    schemaVersion: row.schemaVersion,
    eventType: row.eventType,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    occurredAt: row.occurredAt.toISOString(),
    correlationId: row.correlationId,
    payload: row.payload,
  };
}


/**
 * Driver-independent decoders for aggregate columns. Drizzle's `sql<T>` does
 * not decode anything at runtime, so a `min(timestamptz)` may arrive as a
 * string, a Date or null depending on the driver and the parser settings.
 */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new ApiError('internal_error', 'The outbox aggregate returned an undecodable timestamp.');
}

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === 'bigint') return Number(value);
  throw new ApiError('internal_error', 'The outbox aggregate returned an undecodable count.');
}


@Injectable()
export class OutboxRepository {
  /**
   * The stored columns and the wire envelope are one mapping. The envelope is
   * validated against the published v1 contract before it can be persisted.
   */
  async append(tx: Transaction, event: OutboxAppend): Promise<OutboxEventRow> {
    const envelope = {
      eventId: event.eventId,
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
      occurredAt: event.occurredAt.toISOString(),
      correlationId: event.correlationId,
      payload: { status: PAYLOAD_STATUS[event.eventType] },
    };
    const validated = contentEventV1Schema.safeParse(envelope);
    if (!validated.success) {
      throw new ApiError('internal_error', 'The generated event does not match the v1 contract.');
    }
    const inserted = await tx
      .insert(outboxEvent)
      .values({
        eventId: envelope.eventId,
        schemaVersion: envelope.schemaVersion,
        eventType: envelope.eventType,
        aggregateId: envelope.aggregateId,
        aggregateVersion: envelope.aggregateVersion,
        occurredAt: event.occurredAt,
        correlationId: envelope.correlationId,
        payload: envelope.payload,
      })
      .returning();
    return inserted[0]!;
  }

  /**
   * Ordered pending read for the relay. Sort is occurred_at, then
   * aggregate_version, then event_id so a published → withdrawn pair on the
   * same timestamp stays deterministic.
   */
  async pending(executor: Executor, limit = 100): Promise<OutboxEventRow[]> {
    return executor
      .select()
      .from(outboxEvent)
      .where(isNull(outboxEvent.deliveredAt))
      .orderBy(asc(outboxEvent.occurredAt), asc(outboxEvent.aggregateVersion), asc(outboxEvent.eventId))
      .limit(limit);
  }

  /**
   * Aggregate read for the operator status endpoint. `sql<T>` is a TypeScript
   * annotation only: the pg driver hands back `min(occurred_at)` as a string
   * and `count(*)` can arrive as a string too, so both are converted here, at
   * the repository boundary. The declared return type describes the runtime
   * value, never the raw driver output.
   */
  async pendingStats(executor: Executor): Promise<{ pending: number; oldestOccurredAt: Date | null }> {
    const rows = await executor
      .select({
        pending: sql<unknown>`count(*)::int`,
        oldestOccurredAt: sql<unknown>`min(${outboxEvent.occurredAt})`,
      })
      .from(outboxEvent)
      .where(isNull(outboxEvent.deliveredAt));
    const row = rows[0];
    if (!row) return { pending: 0, oldestOccurredAt: null };
    return {
      pending: toCount(row.pending),
      oldestOccurredAt: toDate(row.oldestOccurredAt),
    };
  }

  /**
   * Marks delivery only after a publish ACK. The `delivered_at IS NULL` guard
   * makes a second mark a no-op so the timestamp does not move.
   */
  async markDelivered(
    executor: Executor,
    eventId: string,
    deliveredAt = new Date(),
    streamSequence?: number,
  ): Promise<boolean> {
    const updated = await executor
      .update(outboxEvent)
      .set({ deliveredAt, ...(streamSequence === undefined ? {} : { streamSequence }) })
      .where(and(eq(outboxEvent.eventId, eventId), isNull(outboxEvent.deliveredAt)))
      .returning({ eventId: outboxEvent.eventId });
    return updated.length > 0;
  }
}
