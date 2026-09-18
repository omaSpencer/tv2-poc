import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ApiProblemError, type ProcessingStatus } from '../../../api/types';

const mocks = vi.hoisted(() => ({ fetchProcessingStatus: vi.fn() }));
vi.mock('../../../api/processing', () => ({ fetchProcessingStatus: mocks.fetchProcessingStatus }));
vi.mock('../../../auth/authContext', () => ({ useAuth: () => ({ me: { permissions: ['ops:read', 'ops:write'] } }) }));

import { OperationsPage } from './OperationsPage';

configure({ asyncUtilTimeout: 5_000 });

type Index = NonNullable<ProcessingStatus['indexes']>['a'];

function makeIndex(alias: 'a' | 'b', overrides: Partial<Index> = {}): Index {
  return {
    state: 'idle', durable: `search-index-${alias}`, inFlightEventId: null, inFlightTaskUid: null,
    lastAckedAt: '2026-09-16T10:00:00.000Z', lastErrorCode: null, reachable: true,
    phase: 'ready', desiredWorkerState: 'running', runId: null, snapshotStreamSequence: 100,
    outboxHighWater: 120, catchUpStreamSequence: 120, importedDocuments: 200,
    expectedDocuments: 200, startedAt: '2026-09-16T09:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z', completedAt: '2026-09-16T10:00:00.000Z',
    routeEligible: true, ...overrides,
  };
}

function makeStatus(overrides: Partial<ProcessingStatus> = {}): ProcessingStatus {
  return {
    outbox: { pending: 3, oldestOccurredAt: '2026-09-16T09:59:30.000Z', oldestAgeMs: 30_000 },
    relay: { enabled: true, state: 'idle', lastDeliveredAt: '2026-09-16T10:00:00.000Z', lastErrorCode: null },
    broker: { connected: true, streamPresent: true },
    consumers: [{
      name: 'search-index-a', pending: 4, ackPending: 2, ackFloorStreamSequence: 116,
      oldestUnfinishedAt: '2026-09-16T09:59:00.000Z', oldestUnfinishedAgeMs: 60_000,
    }],
    quarantine: { pending: 1 }, consumersUnavailable: false,
    indexes: { a: makeIndex('a'), b: makeIndex('b') },
    ...overrides,
  };
}

function response(status = makeStatus()) {
  return { status: 200, correlationId: 'corr-operations', data: status };
}

function problem(status: 401 | 403 | 503) {
  const code = status === 401
    ? 'unauthenticated' as const
    : status === 403 ? 'forbidden' as const : 'dependency_unavailable' as const;
  return new ApiProblemError({
    type: 'about:blank', title: 'Request failed', status, detail: 'Processing unavailable',
    instance: '/admin/processing-status', code, correlationId: 'corr-error', fields: [],
  }, 'corr-error');
}

function renderOperations() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/operations']}>
        <OperationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('OperationsPage', () => {
  beforeEach(() => {
    mocks.fetchProcessingStatus.mockReset();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('renders the full overview, service, consumer and A/B index snapshot', async () => {
    mocks.fetchProcessingStatus.mockResolvedValue(response());
    const { container } = renderOperations();

    expect(await screen.findByRole('heading', { name: 'Teljes A/B rendelkezésre állás' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Outbox' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Relay' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Broker' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Karantén' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tartós fogyasztók' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Index A' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Index B' })).toBeTruthy();
    expect(screen.getAllByText('search-index-a').length).toBeGreaterThan(0);
    expect(screen.getByText('Technikai részletek és nyers válasz')).toBeTruthy();
    expect(container.querySelector<HTMLDetailsElement>('.operations-technical details')?.open).toBe(false);
  });

  it('keeps optional absence, unavailable consumers and unknown search status distinct', async () => {
    mocks.fetchProcessingStatus.mockResolvedValue(response(makeStatus({
      consumers: undefined, consumersUnavailable: true, quarantine: undefined, indexes: undefined,
    })));
    renderOperations();

    expect(await screen.findByRole('heading', { name: 'Keresési állapot nem elérhető' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'A fogyasztói adatok nem kérhetők le' })).toBeTruthy();
    expect(screen.getByText('Ez a konfiguráció nem jelent karanténadatot.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'A/B indexállapot nem elérhető' })).toBeTruthy();
  });

  it('shows an empty consumer list without claiming that the system is healthy', async () => {
    mocks.fetchProcessingStatus.mockResolvedValue(response(makeStatus({ consumers: [] })));
    renderOperations();

    expect(await screen.findByText('Nincs jelentett tartós fogyasztó. Ez önmagában nem jelent egészséges állapotot.')).toBeTruthy();
  });

  it('retains the latest successful snapshot and marks it stale after a refresh failure', async () => {
    mocks.fetchProcessingStatus.mockResolvedValueOnce(response()).mockRejectedValueOnce(problem(503));
    renderOperations();
    await screen.findByRole('heading', { name: 'Teljes A/B rendelkezésre állás' });

    fireEvent.click(screen.getByRole('button', { name: 'Frissítés most' }));
    expect(await screen.findByRole('heading', { name: 'Elavult adatok' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Index A' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Újrapróbálás' })).toBeTruthy();
  });

  it('shows a retryable full-page 503', async () => {
    mocks.fetchProcessingStatus.mockRejectedValueOnce(problem(503));
    renderOperations();
    expect(await screen.findByRole('heading', { name: 'Egy háttérszolgáltatás nem elérhető' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Újrapróbálás' })).toBeTruthy();
  });

  it.each([
    [401, 'A munkamenet érvénytelen'],
    [403, 'Nincs jogosultság'],
  ] as const)('stops polling and disables manual refresh after HTTP %s', async (status, heading) => {
    mocks.fetchProcessingStatus.mockRejectedValueOnce(problem(status));
    renderOperations();
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Újrapróbálás' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Frissítés most' }).hasAttribute('disabled')).toBe(true);
  });

  it('refetches immediately when a hidden tab becomes visible again', async () => {
    mocks.fetchProcessingStatus.mockResolvedValue(response());
    renderOperations();
    await screen.findByRole('heading', { name: 'Teljes A/B rendelkezésre állás' });
    expect(mocks.fetchProcessingStatus).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    expect(mocks.fetchProcessingStatus).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await waitFor(() => expect(mocks.fetchProcessingStatus).toHaveBeenCalledTimes(2));
  });

  it('uses the normal timer without stacking a new request over an in-flight poll', async () => {
    vi.useFakeTimers();
    let resolveSecond!: (value: ReturnType<typeof response>) => void;
    mocks.fetchProcessingStatus
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    renderOperations();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.fetchProcessingStatus).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.fetchProcessingStatus).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.fetchProcessingStatus).toHaveBeenCalledTimes(2);

    resolveSecond(response());
    await act(async () => { await Promise.resolve(); });
  });
});
