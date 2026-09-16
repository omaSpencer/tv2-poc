import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Meilisearch } from 'meilisearch';
import { MeiliIndexAdapter } from '../src/search/meili.adapter.js';
import { OutboxRelay } from '../src/messaging/relay.js';
import { RelayState } from '../src/messaging/relay.state.js';
import { OutboxWake } from '../src/outbox/outbox.wake.js';
import { ProcessingStatusController } from '../src/ops/processing-status.controller.js';
import { processingStatusViewSchema } from '../src/contracts/openapi.js';
import { SearchState } from '../src/search/worker.state.js';
import { TokenVerifier } from '../src/identity/token-verifier.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('F-04 quotes filter values at the adapter boundary', async () => {
  const search = vi.fn(async () => ({ hits: [], estimatedTotalHits: 0 }));
  vi.spyOn(Meilisearch.prototype, 'index').mockReturnValue({ search } as never);
  const adapter = new MeiliIndexAdapter({ alias: 'a', url: 'http://localhost:7700', apiKey: 'test', durable: 'a' }, {
    indexUid: 'contents', searchTimeoutMs: 1000, taskTimeoutMs: 1000, taskPollMs: 10,
  });
  const category = 'film" OR category != "x\\y';
  await adapter.search('test', { category, limit: 10, offset: 0 });
  expect(search).toHaveBeenCalledWith('test', { filter: 'category = "film\\" OR category != \\"x\\\\y"', limit: 10, offset: 0 });
});

it('F-05 keeps the relay disabled even when the raw environment says on', () => {
  vi.stubEnv('FEATURE_OUTBOX_RELAY', 'on');
  const wake = new OutboxWake();
  const resume = vi.spyOn(wake, 'resume');
  const state = new RelayState();
  const relay = new OutboxRelay(new ConfigService({ LOG_LEVEL: 'silent', FEATURE_OUTBOX_RELAY: 'off' }),
    {} as never, {} as never, {} as never, wake, state);
  relay.start();
  expect(resume).not.toHaveBeenCalled();
  expect(state.enabled).toBe(false);
});

it('F-02 validates the actual paused status and complete consumer progress', async () => {
  const state = new SearchState();
  state.get('a').setState('paused');
  const controller = new ProcessingStatusController(
    new ConfigService({ FEATURE_OUTBOX_RELAY: 'on' }), { db: {} } as never,
    { pendingStats: async () => ({ pending: 0, oldestOccurredAt: null }) } as never,
    { snapshot: async () => ({ connected: true, streamPresent: true, quarantinePending: 0,
      consumers: [{ name: 'a', pending: 1, ackPending: 1, ackFloorStreamSequence: 2, oldestUnfinishedAt: new Date().toISOString() }],
    }) } as never, new RelayState(), { enabled: true, probeReachability: async () => {} } as never, state,
    { all: async () => [{ indexAlias: 'a', phase: 'importing', desiredWorkerState: 'paused', importedDocuments: 0 }] } as never,
  );
  const status = await controller.status();
  expect(processingStatusViewSchema.safeParse(status).success).toBe(true);
  expect(status.indexes?.a.routeEligible).toBe(false);
  expect(status.indexes?.a.state).toBe('paused');
});

it('F-10 never treats an arbitrary error message as an identity outage', () => {
  const verifier = new TokenVerifier(new ConfigService({ LOG_LEVEL: 'silent' }), {} as never);
  const classify = (error: unknown) => (verifier as unknown as { mapJoseError(error: unknown): never }).mapJoseError(error);
  expect(() => classify(new Error('invalid token mentioning timeout or network'))).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
  expect(() => classify(new TypeError('fetch failed'))).toThrow(expect.objectContaining({ code: 'dependency_unavailable' }));
});
