import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  JetStreamAdapter,
  streamStateHasSequenceRange,
  type SequenceRangeState,
} from '../src/messaging/jetstream.adapter.js';

const complete = (overrides: Partial<SequenceRangeState> = {}): SequenceRangeState => ({
  messages: 10,
  first_seq: 11,
  last_seq: 20,
  num_deleted: 0,
  deleted: [],
  lost: { msgs: null, bytes: 0 },
  ...overrides,
});

describe('JetStream sequence-range retention proof', () => {
  it('accepts empty and fully retained ranges', () => {
    expect(streamStateHasSequenceRange(complete(), 20, 19)).toBe(true);
    expect(streamStateHasSequenceRange(complete(), 11, 20)).toBe(true);
    expect(streamStateHasSequenceRange(complete(), 13, 18)).toBe(true);
  });

  it('rejects an empty stream and ranges outside retained bounds', () => {
    expect(streamStateHasSequenceRange(complete({ messages: 0, first_seq: 0, last_seq: 0 }), 1, 1)).toBe(false);
    expect(streamStateHasSequenceRange(complete(), 10, 12)).toBe(false);
    expect(streamStateHasSequenceRange(complete(), 19, 21)).toBe(false);
  });

  it('rejects deleted or lost messages inside the requested interval', () => {
    const deleted = complete({ messages: 9, num_deleted: 1, deleted: [15] });
    expect(streamStateHasSequenceRange(deleted, 11, 14)).toBe(true);
    expect(streamStateHasSequenceRange(deleted, 14, 16)).toBe(false);

    const lost = complete({ messages: 9, lost: { msgs: [18], bytes: 120 } });
    expect(streamStateHasSequenceRange(lost, 11, 17)).toBe(true);
    expect(streamStateHasSequenceRange(lost, 17, 19)).toBe(false);
  });

  it('fails closed for truncated delete/loss metadata and inconsistent state', () => {
    expect(streamStateHasSequenceRange(complete({ num_deleted: 2, deleted: [14] }), 11, 13)).toBe(false);
    expect(streamStateHasSequenceRange(complete({ lost: { msgs: null, bytes: 1 } }), 11, 13)).toBe(false);
    expect(streamStateHasSequenceRange(complete({ messages: 9 }), 11, 13)).toBe(false);
  });

  it('uses one detailed stream-info call for a very large logical range', async () => {
    const adapter = new JetStreamAdapter(new ConfigService({
      NATS_URL: 'nats://127.0.0.1:4222',
      NATS_PUBLISH_ACK_TIMEOUT_MS: 1000,
    }));
    const info = vi.fn(async () => ({ state: complete({
      messages: 100_000,
      first_seq: 1,
      last_seq: 100_000,
    }) }));
    Object.assign(adapter as unknown as Record<string, unknown>, {
      ensureConnected: vi.fn(async () => undefined),
      jsm: { streams: { info, getMessage: vi.fn() } },
    });

    await expect(adapter.hasSequenceRange(1, 100_000)).resolves.toBe(true);
    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(adapter.names.stream, { deleted_details: true });
  });
});
