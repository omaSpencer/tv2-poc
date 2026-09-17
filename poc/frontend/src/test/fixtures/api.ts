import type {
  MeResponse, ProblemDocument, ProcessingStatus, SearchResponse,
} from '../../api/types';

export const publisherFixture = {
  sub: 'test-publisher',
  roles: ['publisher'],
  permissions: ['content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write'],
  expiresAt: '2030-01-01T00:00:00.000Z',
} satisfies MeResponse;

export const emptySearchFixture = {
  items: [], offset: 0, limit: 20, returned: 0, estimatedTotalHits: 0,
} satisfies SearchResponse;

export const processingFixture = {
  outbox: { pending: 0, oldestOccurredAt: null, oldestAgeMs: null },
  relay: { enabled: true, state: 'idle', lastDeliveredAt: null, lastErrorCode: null },
  broker: { connected: true, streamPresent: true },
  consumers: [], quarantine: { pending: 0 }, consumersUnavailable: false,
  indexes: {
    a: {
      state: 'idle', durable: 'search-a-v1', inFlightEventId: null, inFlightTaskUid: null,
      lastAckedAt: null, lastErrorCode: null, reachable: true, phase: 'ready',
      desiredWorkerState: 'running', runId: null, snapshotStreamSequence: null,
      outboxHighWater: null, catchUpStreamSequence: null, importedDocuments: 0,
      expectedDocuments: null, startedAt: null, updatedAt: null, completedAt: null,
      routeEligible: true,
    },
    b: {
      state: 'idle', durable: 'search-b-v1', inFlightEventId: null, inFlightTaskUid: null,
      lastAckedAt: null, lastErrorCode: null, reachable: true, phase: 'ready',
      desiredWorkerState: 'running', runId: null, snapshotStreamSequence: null,
      outboxHighWater: null, catchUpStreamSequence: null, importedDocuments: 0,
      expectedDocuments: null, startedAt: null, updatedAt: null, completedAt: null,
      routeEligible: true,
    },
  },
} satisfies ProcessingStatus;

export function problemFixture(
  status: ProblemDocument['status'],
  code: ProblemDocument['code'],
  fields?: string[],
): ProblemDocument {
  return {
    type: `urn:indaplay:poc:error:${code}`,
    title: code,
    status,
    code,
    detail: 'Teszt problem válasz.',
    instance: '/test',
    correlationId: `test-${code}`,
    ...(fields ? { fields } : {}),
  };
}
