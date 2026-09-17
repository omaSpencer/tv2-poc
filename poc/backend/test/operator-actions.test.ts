import { describe, expect, it, vi } from 'vitest';
import {
  normalizeRepairBody,
  normalizeReplayBody,
  normalizeStartReindexBody,
  operatorRequestFingerprint,
  parseIdempotencyKey,
  parseQuarantineListQuery,
} from '../src/contracts/operator-actions.js';
import { operatorActionViewSchema, quarantineListViewSchema } from '../src/contracts/openapi.js';
import { toOperatorActionView } from '../src/ops/operator-action.view.js';
import type { OperatorActionRecord } from '../src/ops/operator-action.repository.js';
import { ContentRepairService } from '../src/search/content-repair.service.js';
import { QuarantineService } from '../src/search/quarantine.service.js';
import type { JetStreamAdapter } from '../src/messaging/jetstream.adapter.js';

const ACTION_ID = '123e4567-e89b-42d3-a456-426614174000';
const CONTENT_ID = '123e4567-e89b-42d3-a456-426614174001';

describe('operator action contracts', () => {
  it('normalizes strict mutation bodies and rejects missing idempotency', () => {
    expect(normalizeStartReindexBody({ index: 'a', reason: '  karbantartás  ' })).toEqual({
      index: 'a', reason: 'karbantartás', allowSearchOutage: false,
    });
    expect(normalizeReplayBody({ reason: ' újrapróbálás ' })).toEqual({ reason: 'újrapróbálás' });
    expect(normalizeRepairBody({ contentId: CONTENT_ID, target: 'both', reason: ' javítás ' })).toEqual({
      contentId: CONTENT_ID, target: 'both', reason: 'javítás',
    });
    expect(() => parseIdempotencyKey(undefined)).toThrow(expect.objectContaining({ code: 'validation_failed' }));
    expect(parseIdempotencyKey(ACTION_ID)).toBe(ACTION_ID);
  });

  it('fingerprints the normalized request deterministically', () => {
    const target = { index: 'a' as const, allowSearchOutage: true, confirmationTarget: 'poc' };
    expect(operatorRequestFingerprint('reindex', 'ok', target))
      .toBe(operatorRequestFingerprint('reindex', 'ok', { ...target }));
    expect(operatorRequestFingerprint('reindex', 'ok', target))
      .not.toBe(operatorRequestFingerprint('reindex', 'más', target));
  });

  it('parses bounded opaque quarantine cursors', () => {
    const cursor = Buffer.from(JSON.stringify({ v: 1, beforeSequence: 42 })).toString('base64url');
    expect(parseQuarantineListQuery(new URLSearchParams({ limit: '25', cursor }))).toEqual({
      limit: 25, beforeSequence: 42,
    });
    expect(() => parseQuarantineListQuery(new URLSearchParams({ limit: '101' })))
      .toThrow(expect.objectContaining({ code: 'validation_failed' }));
  });

  it('never projects the database confirmation target into the action view', () => {
    const now = new Date('2026-09-17T10:00:00.000Z');
    const action: OperatorActionRecord = {
      id: ACTION_ID,
      kind: 'reindex',
      state: 'queued',
      requestFingerprint: 'a'.repeat(64),
      requestedBy: 'operator-1',
      requestedRoles: ['publisher'],
      correlationId: 'phase5-test',
      reason: 'Karbantartási újraépítés',
      target: { index: 'a', allowSearchOutage: true, confirmationTarget: 'secret_db_name' },
      result: null,
      errorCode: null,
      createdAt: now,
      startedAt: null,
      heartbeatAt: null,
      completedAt: null,
    };
    const view = toOperatorActionView(action);
    expect(view.target).toEqual({ index: 'a', allowSearchOutage: true });
    expect(JSON.stringify(view)).not.toContain('secret_db_name');
    expect(operatorActionViewSchema.safeParse(view).success).toBe(true);
  });
});

describe('operator services', () => {
  it('repairs both indexes from the current database projection', async () => {
    const row = {
      id: CONTENT_ID,
      title: 'Cím', summary: 'Összefoglaló', category: 'film', tags: ['minta'],
      status: 'published', version: 4,
    };
    const submitA = vi.fn(async () => 11);
    const submitB = vi.fn(async () => 12);
    const service = new ContentRepairService(
      { db: {} } as never,
      { findById: vi.fn(async () => row) } as never,
      { adapter: (alias: string) => ({
        submitUpsert: alias === 'a' ? submitA : submitB,
        awaitTask: async (uid: number) => ({ uid, status: 'succeeded', errorCode: null }),
      }) } as never,
    );
    await expect(service.repair(CONTENT_ID, 'both')).resolves.toEqual({
      contentId: CONTENT_ID,
      tasks: [{ alias: 'a', taskUid: 11 }, { alias: 'b', taskUid: 12 }],
    });
    expect(submitA).toHaveBeenCalledOnce();
    expect(submitB).toHaveBeenCalledOnce();
  });

  it('turns a partial both-index repair failure into a stable failed-action code', async () => {
    const row = {
      id: CONTENT_ID,
      title: 'Cím', summary: 'Összefoglaló', category: 'film', tags: ['minta'],
      status: 'published', version: 4,
    };
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const service = new ContentRepairService(
      { db: {} } as never,
      { findById: vi.fn(async () => row) } as never,
      { adapter: (alias: string) => ({
        submitUpsert: async () => alias === 'a' ? 11 : 12,
        awaitTask: async (uid: number) => ({
          uid, status: alias === 'a' ? 'succeeded' : 'failed', errorCode: alias === 'a' ? null : 'index_write_failed',
        }),
      }) } as never,
    );
    await expect(service.repair(CONTENT_ID, 'both'))
      .rejects.toMatchObject({ code: 'repair_task_failed' });
    expect(stderr).toHaveBeenCalledWith(expect.not.stringContaining('Összefoglaló'));
    stderr.mockRestore();
  });

  it('lists newest-first quarantine metadata, keeps invalid records visible and omits payloads', async () => {
    const valid = new TextEncoder().encode(JSON.stringify({
      quarantineId: ACTION_ID,
      schemaVersion: 1,
      failedAt: '2026-09-17T10:00:00.000Z',
      errorCode: 'projection_rejected',
      originalEventId: CONTENT_ID,
      originalStream: 'CONTENT',
      originalStreamSequence: 7,
      originalSubject: 'poc.content.changed.v1',
      durable: 'search-a-v1',
    }));
    const broker = {
      names: { quarantineStream: 'CONTENT_DLQ' },
      streamBounds: async () => ({ firstSequence: 8, lastSequence: 10, messages: 2 }),
      storedMessage: async (_stream: string, sequence: number) => {
        if (sequence === 10) return { subject: 'x', sequence, data: valid };
        if (sequence === 9) return null;
        return { subject: 'x', sequence, data: new TextEncoder().encode('{broken') };
      },
    } as unknown as JetStreamAdapter;
    const service = new QuarantineService(broker, {} as never, {} as never);
    const result = await service.list({ beforeSequence: null, limit: 10 });
    expect(result.items.map(item => [item.sequence, item.schemaValid])).toEqual([[10, true], [8, false]]);
    expect(JSON.stringify(result)).not.toContain('payload');
    expect(quarantineListViewSchema.safeParse({ items: result.items, nextCursor: null }).success).toBe(true);
  });

  it('replays from the original stream with broker deduplication and never returns the payload', async () => {
    const quarantine = new TextEncoder().encode(JSON.stringify({
      quarantineId: ACTION_ID,
      schemaVersion: 1,
      failedAt: '2026-09-17T10:00:00.000Z',
      errorCode: 'projection_rejected',
      originalEventId: CONTENT_ID,
      originalStream: 'CONTENT',
      originalStreamSequence: 7,
      originalSubject: 'poc.content.changed.v1',
      durable: 'search-a-v1',
    }));
    const original = new TextEncoder().encode(JSON.stringify({
      eventId: ACTION_ID,
      schemaVersion: 1,
      eventType: 'content.published',
      aggregateId: CONTENT_ID,
      aggregateVersion: 4,
      occurredAt: '2026-09-17T09:59:00.000Z',
      correlationId: 'phase-5-replay',
      payload: { status: 'published' },
    }));
    const publishTo = vi.fn(async () => ({ streamSeq: 9, duplicate: true }));
    const broker = {
      names: { quarantineStream: 'CONTENT_DLQ', subject: 'poc.content.changed.v1' },
      storedMessage: async (stream: string, sequence: number) => {
        if (stream === 'CONTENT_DLQ' && sequence === 41) return { subject: 'dlq', sequence, data: quarantine };
        if (stream === 'CONTENT' && sequence === 7) return { subject: 'source', sequence, data: original };
        return null;
      },
      publishTo,
    } as unknown as JetStreamAdapter;
    const service = new QuarantineService(
      broker,
      { db: {} } as never,
      { findById: vi.fn(async () => ({ id: CONTENT_ID })) } as never,
    );
    const result = await service.replay(41, 'Újrapróbálás', ACTION_ID);
    expect(result).toEqual({
      sequence: 41, quarantineId: ACTION_ID, originalSequence: 7, replaySequence: 9, duplicate: true,
    });
    expect(publishTo).toHaveBeenCalledWith('poc.content.changed.v1', original, `replay:${ACTION_ID}`);
    expect(JSON.stringify(result)).not.toContain('payload');
  });
});
