import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { apiRequest } from '../api/client';
import type { AuthContextValue, AuthState } from '../auth/authTypes';
import { AuthContext } from '../auth/authContext';
import { HEALTH_POLL_SUCCESS_MS } from '../lib/healthPollInterval';
import { server } from '../test/server';

const healthMocks = vi.hoisted(() => ({
  fetchLive: vi.fn(),
  fetchReady: vi.fn(),
}));

vi.mock('../api/health', () => healthMocks);
vi.mock('../lib/healthPollInterval', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/healthPollInterval')>();
  return {
    ...actual,
    healthPollInterval: (input: import('../lib/healthPollInterval').HealthPollIntervalInput) =>
      actual.healthPollInterval({ ...input, jitter: () => 0 }),
  };
});

import { StatusBar } from './StatusBar';

function healthOk(correlationId: string) {
  return {
    status: 200,
    correlationId,
    data: { status: 'ok' as const, info: {}, error: {}, details: {} },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

function authValue(state: AuthState): AuthContextValue {
  return {
    state,
    me: state.kind === 'authenticated' ? state.me : null,
    isAuthenticated: state.kind === 'authenticated',
    manualTokenAllowed: false,
    login: vi.fn(async () => undefined),
    completeCallback: vi.fn(async () => '/'),
    logout: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    setManualToken: vi.fn(async () => undefined),
  };
}

function renderStatusBar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue({ kind: 'anonymous' })}>
        <MemoryRouter>
          <StatusBar />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

async function flushFakeQueryUpdates() {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('StatusBar health polling and ready correlationId', () => {
  beforeEach(() => {
    vi.useRealTimers();
    healthMocks.fetchLive.mockReset();
    healthMocks.fetchReady.mockReset();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('shows an em dash until a successful ready response owns the correlation id', async () => {
    const live = deferred<ReturnType<typeof healthOk>>();
    const ready = deferred<ReturnType<typeof healthOk>>();
    healthMocks.fetchLive.mockImplementation(() => live.promise);
    healthMocks.fetchReady.mockImplementation(() => ready.promise);
    renderStatusBar();

    expect(screen.getByText('ready correlationId')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();

    await act(async () => {
      live.resolve(healthOk('live-first'));
      await live.promise;
    });
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('live-first')).toBeNull();

    await act(async () => {
      ready.resolve(healthOk('ready-owns-this'));
      await ready.promise;
    });
    expect(await screen.findByText('ready-owns-this')).toBeTruthy();
    expect(screen.queryByText('live-first')).toBeNull();
  });

  it('does not take a later non-health or live correlation id after ready succeeded', async () => {
    const live = deferred<ReturnType<typeof healthOk>>();
    const ready = deferred<ReturnType<typeof healthOk>>();
    healthMocks.fetchLive.mockImplementation(() => live.promise);
    healthMocks.fetchReady.mockImplementation(() => ready.promise);
    server.use(
      http.get('*/api/admin/contents', () => HttpResponse.json(
        { items: [], nextCursor: null },
        { headers: { 'X-Correlation-Id': 'contents-later' } },
      )),
    );
    renderStatusBar();

    await act(async () => {
      ready.resolve(healthOk('ready-stable'));
      await ready.promise;
    });
    expect(await screen.findByText('ready-stable')).toBeTruthy();

    await expect(apiRequest('/admin/contents')).resolves.toMatchObject({ correlationId: 'contents-later' });

    await act(async () => {
      live.resolve(healthOk('live-after-contents'));
      await live.promise;
    });
    expect(screen.getByText('ready-stable')).toBeTruthy();
    expect(screen.queryByText('contents-later')).toBeNull();
    expect(screen.queryByText('live-after-contents')).toBeNull();
  });

  it('keeps the ready id when a non-health request finishes first and live/ready reverse-complete', async () => {
    const live = deferred<ReturnType<typeof healthOk>>();
    const ready = deferred<ReturnType<typeof healthOk>>();
    healthMocks.fetchLive.mockImplementation(() => live.promise);
    healthMocks.fetchReady.mockImplementation(() => ready.promise);
    const contents = deferred<Response>();
    server.use(http.get('*/api/admin/contents', () => contents.promise));
    renderStatusBar();

    const pendingContents = apiRequest('/admin/contents');
    await act(async () => {
      contents.resolve(HttpResponse.json(
        { items: [], nextCursor: null },
        { headers: { 'X-Correlation-Id': 'contents-first' } },
      ));
      await pendingContents;
    });
    expect(screen.getByText('—')).toBeTruthy();

    await act(async () => {
      live.resolve(healthOk('live-second'));
      await live.promise;
    });
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('contents-first')).toBeNull();
    expect(screen.queryByText('live-second')).toBeNull();

    await act(async () => {
      ready.resolve(healthOk('ready-last'));
      await ready.promise;
    });
    expect(await screen.findByText('ready-last')).toBeTruthy();
  });

  it('polls live and ready on the 10s success beat and pauses while hidden', async () => {
    vi.useFakeTimers();
    healthMocks.fetchLive.mockResolvedValue(healthOk('live-ok'));
    healthMocks.fetchReady.mockResolvedValue(healthOk('ready-ok'));
    renderStatusBar();
    await act(async () => { await Promise.resolve(); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(1);
    expect(healthMocks.fetchReady).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_SUCCESS_MS); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(2);
    expect(healthMocks.fetchReady).toHaveBeenCalledTimes(2);

    act(() => setVisibility('hidden'));
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_SUCCESS_MS * 6); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(2);
    expect(healthMocks.fetchReady).toHaveBeenCalledTimes(2);

    act(() => setVisibility('visible'));
    await act(async () => { await Promise.resolve(); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(3);
    expect(healthMocks.fetchReady).toHaveBeenCalledTimes(3);
  });

  it('backs off live polls exponentially and resets to 10s after the first success', async () => {
    vi.useFakeTimers();
    healthMocks.fetchReady.mockResolvedValue(healthOk('ready-ok'));
    healthMocks.fetchLive
      .mockRejectedValueOnce(new Error('down-1'))
      .mockRejectedValueOnce(new Error('down-2'))
      .mockResolvedValue(healthOk('live-recovered'));
    renderStatusBar();
    await act(async () => { await Promise.resolve(); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_SUCCESS_MS); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_SUCCESS_MS); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(40_000 - 1); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(3);

    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_SUCCESS_MS - 1); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(4);
  });

  it('does not start a second live request while one is in flight, including on visibility', async () => {
    vi.useFakeTimers();
    const live = deferred<ReturnType<typeof healthOk>>();
    healthMocks.fetchLive.mockImplementation(() => live.promise);
    healthMocks.fetchReady.mockResolvedValue(healthOk('ready-ok'));
    renderStatusBar();
    await act(async () => { await Promise.resolve(); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(1);

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_SUCCESS_MS * 3); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(1);

    await act(async () => {
      live.resolve(healthOk('live-inflight'));
      await live.promise;
    });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(1);
  });

  it('keeps live and ready to a single in-flight request each', async () => {
    vi.useFakeTimers();
    const live = deferred<ReturnType<typeof healthOk>>();
    const ready = deferred<ReturnType<typeof healthOk>>();
    healthMocks.fetchLive.mockImplementation(() => live.promise);
    healthMocks.fetchReady.mockImplementation(() => ready.promise);
    renderStatusBar();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_SUCCESS_MS * 3); });
    expect(healthMocks.fetchLive).toHaveBeenCalledTimes(1);
    expect(healthMocks.fetchReady).toHaveBeenCalledTimes(1);

    await act(async () => {
      live.resolve(healthOk('live-ok'));
      ready.resolve(healthOk('ready-ok'));
      await Promise.all([live.promise, ready.promise]);
    });
    await flushFakeQueryUpdates();
    expect(screen.getByText('ready-ok')).toBeTruthy();
  });
});
