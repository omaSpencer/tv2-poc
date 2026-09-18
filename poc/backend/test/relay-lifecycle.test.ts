import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { OutboxRelay } from '../src/messaging/relay.js';
import { RelayState } from '../src/messaging/relay.state.js';
import type { DatabaseService } from '../src/database.js';
import type { OutboxRepository } from '../src/outbox/outbox.repository.js';
import type { OutboxWake } from '../src/outbox/outbox.wake.js';
import type { JetStreamAdapter } from '../src/messaging/jetstream.adapter.js';

afterEach(() => vi.useRealTimers());

describe('relay orphan lifecycle guard', () => {
  it('defers broker close and refuses restart until the timed-out loop settles', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const pendingLoop = new Promise<void>(resolve => { release = resolve; });
    const broker = {
      abort: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const wake = { interrupt: vi.fn(), resume: vi.fn() };
    const status = new RelayState();
    status.setEnabled(true);
    const relay = new OutboxRelay(
      new ConfigService({ FEATURE_OUTBOX_RELAY: 'on', LOG_LEVEL: 'silent' }),
      {} as DatabaseService,
      {} as OutboxRepository,
      broker as unknown as JetStreamAdapter,
      wake as unknown as OutboxWake,
      status,
    );
    Object.assign(relay as unknown as Record<string, unknown>, {
      running: true,
      loop: pendingLoop,
    });

    const firstStop = relay.stop(0);
    await vi.advanceTimersByTimeAsync(500);
    await firstStop;
    expect(relay.hasOrphanedLoop).toBe(true);
    expect(broker.abort).toHaveBeenCalledOnce();
    expect(broker.close).not.toHaveBeenCalled();
    expect(status.state).not.toBe('off');

    relay.start();
    await relay.stop(0);
    expect(broker.close).not.toHaveBeenCalled();

    release();
    await vi.runAllTimersAsync();
    await vi.waitFor(() => expect(relay.hasOrphanedLoop).toBe(false));
    expect(broker.close).toHaveBeenCalledOnce();
    expect(status.state).toBe('off');

    const restarted = vi.fn(async () => undefined);
    Object.assign(relay as unknown as Record<string, unknown>, { runLoop: restarted });
    relay.start();
    expect(restarted).toHaveBeenCalledOnce();
  });
});
