import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_REQUEST_TIMEOUT_MS, apiRequest, setApiAccessToken, setAuthRecoveryHandler } from './client';
import { ApiTimeoutError, isApiTimeoutError } from './types';

const problem = {
  type: 'urn:indaplay:poc:error:unauthenticated',
  title: 'Unauthenticated',
  status: 401,
  code: 'unauthenticated',
  detail: 'Authentication is required.',
  instance: '/admin/example',
  correlationId: 'test-correlation',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'X-Correlation-Id': 'test-correlation' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('api auth recovery', () => {
  it('sends an idempotency key without exposing it in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 202));
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('/admin/search/repairs', {
      method: 'POST',
      body: { contentId: 'id' },
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect((request.headers as Headers).get('Idempotency-Key')).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(request.body).toBe('{"contentId":"id"}');
  });

  it('renews once and retries an idempotent GET', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(problem, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);
    setApiAccessToken('old-token');
    setAuthRecoveryHandler(async () => {
      setApiAccessToken('new-token');
      return true;
    });

    await expect(apiRequest<{ ok: boolean }>('/admin/example')).resolves.toMatchObject({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0][1] as RequestInit;
    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect((firstRequest.headers as Headers).get('Authorization')).toBe('Bearer old-token');
    expect((secondRequest.headers as Headers).get('Authorization')).toBe('Bearer new-token');
  });

  it('recovers the session but never resubmits a mutation automatically', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(problem, 401));
    const recover = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('fetch', fetchMock);
    setApiAccessToken('old-token');
    setAuthRecoveryHandler(recover);

    await expect(apiRequest('/admin/example', { method: 'POST', body: { title: 'x' } })).rejects.toMatchObject({
      problem: { code: 'unauthenticated' },
    });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after the single GET retry when the renewed session is also rejected', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(problem, 401));
    const recover = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('fetch', fetchMock);
    setApiAccessToken('old-token');
    setAuthRecoveryHandler(recover);

    await expect(apiRequest('/admin/example')).rejects.toMatchObject({
      problem: { code: 'unauthenticated' },
    });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not renew or clear a valid session for a permission denial', async () => {
    const forbidden = { ...problem, status: 403, code: 'forbidden', title: 'Forbidden' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(forbidden, 403));
    const recover = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('fetch', fetchMock);
    setApiAccessToken('valid-token');
    setAuthRecoveryHandler(recover);

    await expect(apiRequest('/admin/example')).rejects.toMatchObject({
      problem: { code: 'forbidden' },
    });
    expect(recover).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  }));
}

describe('api request timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out with a stable request_timeout error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const pending = apiRequest('/admin/example');
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'ApiTimeoutError',
      code: 'request_timeout',
    });
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await rejection;
  });

  it('propagates a caller abort instead of a timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const pending = apiRequest('/admin/example', { signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
  });

  it('resolves when the response arrives before the timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const pending = apiRequest<{ ok: boolean }>('/admin/example');
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS - 1);
    await expect(pending).resolves.toMatchObject({ data: { ok: true } });
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up timeout timers and caller listeners across an auth retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(problem, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);
    setApiAccessToken('old-token');
    setAuthRecoveryHandler(async () => {
      setApiAccessToken('new-token');
      return true;
    });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(apiRequest<{ ok: boolean }>('/admin/example', { signal: controller.signal }))
      .resolves.toMatchObject({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(add.mock.calls.length).toBeGreaterThan(0);
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('exposes a UI-recognizable timeout type', () => {
    expect(isApiTimeoutError(new ApiTimeoutError())).toBe(true);
    expect(isApiTimeoutError(new Error('aborted'))).toBe(false);
  });
});
