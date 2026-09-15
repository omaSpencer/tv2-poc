/**
 * M1-04 – outbox recording only. `delivered_at` stays null until the M3 relay
 * writes it after a JetStream publish ACK; nothing here contacts a broker.
 */
import { Injectable } from '@nestjs/common';
import { asc, isNull, sql } from 'drizzle-orm';
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

  /** M3 relay and the later processing-status endpoint read through here. */
  async pending(executor: Executor, limit = 100): Promise<OutboxEventRow[]> {
    return executor
      .select()
      .from(outboxEvent)
      .where(isNull(outboxEvent.deliveredAt))
      .orderBy(asc(outboxEvent.occurredAt), asc(outboxEvent.eventId))
      .limit(limit);
  }

  async pendingStats(executor: Executor): Promise<{ pending: number; oldestOccurredAt: Date | null }> {
    const rows = await executor
      .select({
        pending: sql<number>`count(*)::int`,
        oldestOccurredAt: sql<Date | null>`min(${outboxEvent.occurredAt})`,
      })
      .from(outboxEvent)
      .where(isNull(outboxEvent.deliveredAt));
    return rows[0] ?? { pending: 0, oldestOccurredAt: null };
  }
}
