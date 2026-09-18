import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ReindexPreflightView } from '../../../api/types';
import { REINDEX_PREFLIGHT_POLL_MS } from '../reindexPreflightPoll';
import { ReindexPage } from './ReindexPage';

const mocks = vi.hoisted(() => ({
  fetchReindexPreflight: vi.fn(),
  startReindex: vi.fn(),
}));

vi.mock('../../../api/operations', () => ({
  fetchReindexPreflight: mocks.fetchReindexPreflight,
  startReindex: mocks.startReindex,
}));
vi.mock('../../../auth/authContext', () => ({
  useAuth: () => ({ me: { permissions: ['ops:read', 'ops:write'] } }),
}));

const ACTION_ID = '123e4567-e89b-42d3-a456-426614174000';

function response(data: ReindexPreflightView) {
  return { status: 200, correlationId: 'preflight-test', data };
}

function preflight(overrides: Partial<ReindexPreflightView> = {}): ReindexPreflightView {
  return {
    index: 'a',
    otherIndex: 'b',
    otherIndexReady: true,
    otherIndexReachable: true,
    activeRunId: null,
    canStartNormally: true,
    confirmationRequired: false,
    confirmationTarget: null,
    blockers: [],
    ...overrides,
  };
}

function renderReindex() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/operations/reindex']}>
        <Routes>
          <Route path="/operations/reindex" element={<ReindexPage />} />
          <Route path="/operations/reindex/:runId" element={<h1>Futás megnyitva</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function flushFakeQueryUpdates() {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('reindex preflight freshness', () => {
  beforeEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    mocks.fetchReindexPreflight.mockReset();
    mocks.startReindex.mockReset();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    setVisibility('visible');
  });

  it('refetches the same preflight query on the 8s beat', async () => {
    vi.useFakeTimers();
    mocks.fetchReindexPreflight.mockResolvedValue(response(preflight()));
    renderReindex();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(REINDEX_PREFLIGHT_POLL_MS - 1); });
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(2);
    expect(mocks.fetchReindexPreflight.mock.calls[1]?.[0]).toBe('a');
    expect(mocks.fetchReindexPreflight.mock.calls[1]?.[1]).toBe(false);
  });

  it('stops polling while hidden and refetches immediately when visible again', async () => {
    vi.useFakeTimers();
    mocks.fetchReindexPreflight.mockResolvedValue(response(preflight()));
    renderReindex();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(1);

    act(() => setVisibility('hidden'));
    await act(async () => { await vi.advanceTimersByTimeAsync(REINDEX_PREFLIGHT_POLL_MS * 4); });
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(1);

    act(() => setVisibility('visible'));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(2);
  });

  it('does not start a second preflight while one is in flight across visibility', async () => {
    vi.useFakeTimers();
    const pending = deferred<ReturnType<typeof response>>();
    mocks.fetchReindexPreflight.mockReturnValueOnce(pending.promise);
    renderReindex();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(1);

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await act(async () => { await vi.advanceTimersByTimeAsync(REINDEX_PREFLIGHT_POLL_MS * 3); });
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(response(preflight()));
      await pending.promise;
    });
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(1);
  });

  it('disables submit after a live preflight reports a blocker', async () => {
    vi.useFakeTimers();
    let current = response(preflight());
    mocks.fetchReindexPreflight.mockImplementation(async () => current);
    renderReindex();
    await flushFakeQueryUpdates();
    expect(screen.getByText('Blokkolók: nincs')).toBeTruthy();

    current = response(preflight({
      canStartNormally: false,
      blockers: ['active_run'],
      activeRunId: ACTION_ID,
    }));
    // Observer updates can restart the 8s interval; wait three beats for the new payload.
    await act(async () => { await vi.advanceTimersByTimeAsync(REINDEX_PREFLIGHT_POLL_MS * 3); });
    await flushFakeQueryUpdates();
    expect(screen.getByText('Blokkolók: active_run')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Indoklás'), { target: { value: 'Tervezett karbantartás' } });
    expect(screen.getByRole('button', { name: 'Teljes reindex indítása' }).hasAttribute('disabled')).toBe(true);
  });

  it('disables submit while a refresh is pending and keeps it disabled after refresh failure', async () => {
    vi.useFakeTimers();
    const refresh = deferred<ReturnType<typeof response>>();
    mocks.fetchReindexPreflight
      .mockResolvedValueOnce(response(preflight()))
      .mockReturnValueOnce(refresh.promise);
    renderReindex();
    await flushFakeQueryUpdates();
    fireEvent.change(screen.getByLabelText('Indoklás'), { target: { value: 'Tervezett karbantartás' } });
    const submit = screen.getByRole('button', { name: 'Teljes reindex indítása' });
    expect(submit.hasAttribute('disabled')).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(REINDEX_PREFLIGHT_POLL_MS * 3); });
    await flushFakeQueryUpdates();
    expect(mocks.fetchReindexPreflight).toHaveBeenCalledTimes(2);
    expect(submit.hasAttribute('disabled')).toBe(true);
    await act(async () => {
      refresh.reject(new Error('preflight unavailable'));
      try {
        await refresh.promise;
      } catch {
        // React Query exposes the refresh failure through query state.
      }
    });
    await flushFakeQueryUpdates();
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('A reindex előellenőrzése sikertelen')).toBeTruthy();
  });

  it('submits the confirmation target from the currently displayed preflight', async () => {
    vi.useFakeTimers();
    let current = response(preflight({
      confirmationRequired: true,
      confirmationTarget: 'poc_stale',
    }));
    mocks.fetchReindexPreflight.mockImplementation(async () => current);
    mocks.startReindex.mockResolvedValue({ status: 200, correlationId: 'start', data: { id: ACTION_ID } });
    renderReindex();
    await flushFakeQueryUpdates();

    fireEvent.change(screen.getByLabelText('Indoklás'), { target: { value: 'Tervezett karbantartás' } });
    fireEvent.change(screen.getByLabelText(/Pontos adatbázisnév megerősítése/), { target: { value: 'poc_stale' } });
    expect(screen.getByRole('button', { name: 'Teljes reindex indítása' }).hasAttribute('disabled')).toBe(false);

    current = response(preflight({
      confirmationRequired: true,
      confirmationTarget: 'poc_fresh',
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(REINDEX_PREFLIGHT_POLL_MS * 3); });
    await flushFakeQueryUpdates();
    expect(screen.getByText('poc_fresh')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Teljes reindex indítása' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText(/Pontos adatbázisnév megerősítése/), { target: { value: 'poc_fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Teljes reindex indítása' }));

    await flushFakeQueryUpdates();
    expect(screen.getByRole('heading', { name: 'Futás megnyitva' })).toBeTruthy();
    expect(mocks.startReindex.mock.calls[0]?.[0]).toEqual({
      index: 'a',
      reason: 'Tervezett karbantartás',
      allowSearchOutage: false,
      confirmTarget: 'poc_fresh',
    });
  });

  it('issues a new query when the index or outage flag changes', async () => {
    mocks.fetchReindexPreflight.mockImplementation(async (index: 'a' | 'b', outage: boolean) =>
      response(preflight({
        index,
        otherIndex: index === 'a' ? 'b' : 'a',
        confirmationRequired: outage,
        confirmationTarget: outage ? 'poc_test' : null,
        blockers: outage ? ['other_index_unavailable'] : [],
        otherIndexReady: !outage,
        otherIndexReachable: !outage,
        canStartNormally: !outage,
      })),
    );
    renderReindex();
    await screen.findByText('Blokkolók: nincs');
    fireEvent.click(screen.getByRole('radio', { name: 'Index B' }));
    await waitFor(() => expect(mocks.fetchReindexPreflight).toHaveBeenCalledWith('b', false));
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(mocks.fetchReindexPreflight).toHaveBeenCalledWith('b', true));
  });
});
