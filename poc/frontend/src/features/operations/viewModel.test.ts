import { describe, expect, it } from 'vitest';
import { ApiProblemError, type ProcessingStatus } from '../../api/types';
import {
  isProcessingActive,
  processingPollInterval,
  searchAvailability,
} from './viewModel';

function index(overrides: Partial<NonNullable<ProcessingStatus['indexes']>['a']> = {}) {
  return {
    state: 'idle' as const,
    durable: 'search-a',
    inFlightEventId: null,
    inFlightTaskUid: null,
    lastAckedAt: null,
    lastErrorCode: null,
    reachable: true,
    phase: 'ready' as const,
    desiredWorkerState: 'running' as const,
    runId: null,
    snapshotStreamSequence: null,
    outboxHighWater: null,
    catchUpStreamSequence: null,
    importedDocuments: 10,
    expectedDocuments: 10,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    routeEligible: true,
    ...overrides,
  };
}

function status(a = true, b = true): ProcessingStatus {
  return {
    outbox: { pending: 0, oldestOccurredAt: null, oldestAgeMs: null },
    relay: { enabled: true, state: 'idle', lastDeliveredAt: null, lastErrorCode: null },
    broker: { connected: true, streamPresent: true },
    indexes: { a: index({ routeEligible: a }), b: index({ routeEligible: b, durable: 'search-b' }) },
  };
}

function authError(statusCode: 401 | 403) {
  return new ApiProblemError({
    type: 'about:blank', title: 'Auth', status: statusCode, detail: 'Denied',
    instance: '/admin/processing-status', code: statusCode === 401 ? 'unauthenticated' : 'forbidden',
    correlationId: 'corr-auth', fields: [],
  }, 'corr-auth');
}

describe('operations view model', () => {
  it.each([
    [true, true, 'full'],
    [true, false, 'fallback'],
    [false, true, 'fallback'],
    [false, false, 'unavailable'],
  ] as const)('maps route eligibility %s/%s to %s', (a, b, kind) => {
    expect(searchAvailability(status(a, b)).kind).toBe(kind);
  });

  it('reports missing indexes as unknown and ignores other index diagnostics for aggregation', () => {
    const withoutIndexes = status();
    delete withoutIndexes.indexes;
    expect(searchAvailability(withoutIndexes).kind).toBe('unknown');

    const contradictory = status(true, true);
    contradictory.indexes = {
      a: index({ state: 'halted', phase: 'failed', reachable: false, routeEligible: true }),
      b: index({ state: 'off', phase: null, reachable: null, routeEligible: true }),
    };
    expect(searchAvailability(contradictory).kind).toBe('full');
  });

  it('detects the documented active relay, runtime and durable phases', () => {
    const publishing = status();
    publishing.relay.state = 'publishing';
    expect(isProcessingActive(publishing)).toBe(true);

    const processing = status();
    processing.indexes!.a.state = 'processing';
    expect(isProcessingActive(processing)).toBe(true);

    const importing = status();
    importing.indexes!.b.phase = 'importing';
    expect(isProcessingActive(importing)).toBe(true);
    expect(isProcessingActive(status())).toBe(false);
  });

  it('selects normal, active, hidden, auth-stop and bounded backoff intervals', () => {
    expect(processingPollInterval({ status: status(), error: null, failureCount: 0, visibilityState: 'visible' })).toBe(10_000);
    const active = status();
    active.relay.state = 'retrying';
    expect(processingPollInterval({ status: active, error: null, failureCount: 0, visibilityState: 'visible' })).toBe(2_000);
    expect(processingPollInterval({ status: status(), error: null, failureCount: 0, visibilityState: 'hidden' })).toBe(false);
    expect(processingPollInterval({ error: authError(401), failureCount: 1, visibilityState: 'visible' })).toBe(false);
    expect(processingPollInterval({ error: authError(403), failureCount: 1, visibilityState: 'visible' })).toBe(false);
    expect(processingPollInterval({ error: new TypeError('network'), failureCount: 1, visibilityState: 'visible' })).toBe(2_000);
    expect(processingPollInterval({ error: new TypeError('network'), failureCount: 2, visibilityState: 'visible' })).toBe(4_000);
    expect(processingPollInterval({ error: new TypeError('network'), failureCount: 8, visibilityState: 'visible' })).toBe(30_000);
  });
});
