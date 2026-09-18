import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, setApiAccessToken, setAuthRecoveryHandler } from './client';
import { fetchLive, fetchReady } from './health';

const unauthenticated = {
  type: 'urn:indaplay:poc:error:unauthenticated',
  title: 'Unauthenticated',
  status: 401,
  code: 'unauthenticated',
  detail: 'Authentication is required.',
  instance: '/health/live',
  correlationId: 'health-401',
};

function jsonResponse(body: unknown, status: number, correlationId = 'health-corr'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'X-Correlation-Id': correlationId },
  });
}

function authorization(init: RequestInit | undefined): string | null {
  return (init?.headers as Headers | undefined)?.get('Authorization') ?? null;
}

afterEach(() => vi.unstubAllGlobals());

describe('anonymous health requests', () => {
  it('omits Authorization on live and ready even when a session token is active', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', info: {}, error: {}, details: {} }, 200, 'live-corr'))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', info: {}, error: {}, details: {} }, 200, 'ready-corr'));
    vi.stubGlobal('fetch', fetchMock);
    setApiAccessToken('active-access-token');
    setAuthRecoveryHandler(async () => true);

    await expect(fetchLive()).resolves.toMatchObject({ correlationId: 'live-corr', status: 200 });
    await expect(fetchReady()).resolves.toMatchObject({ correlationId: 'ready-corr', status: 200 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/health\/live$/);
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/health\/ready$/);
    expect(authorization(fetchMock.mock.calls[0]?.[1] as RequestInit)).toBeNull();
    expect(authorization(fetchMock.mock.calls[1]?.[1] as RequestInit)).toBeNull();
  });

  it('does not start auth recovery when live or ready returns 401', async () => {
    const recover = vi.fn().mockResolvedValue(true);
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse(unauthenticated, 401, 'health-401'));
    vi.stubGlobal('fetch', fetchMock);
    setApiAccessToken('active-access-token');
    setAuthRecoveryHandler(recover);

    await expect(fetchLive()).rejects.toMatchObject({ problem: { status: 401, code: 'unauthenticated' } });
    await expect(fetchReady()).resolves.toMatchObject({ status: 401, correlationId: 'health-401' });
    expect(recover).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authorization(fetchMock.mock.calls[0]?.[1] as RequestInit)).toBeNull();
    expect(authorization(fetchMock.mock.calls[1]?.[1] as RequestInit)).toBeNull();
  });

  it('keeps auth as an explicit option rather than a /health URL exception', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', info: {}, error: {}, details: {} }, 200));
    vi.stubGlobal('fetch', fetchMock);
    setApiAccessToken('active-access-token');

    await apiRequest('/health/live');
    expect(authorization(fetchMock.mock.calls[0]?.[1] as RequestInit)).toBe('Bearer active-access-token');
  });
});
