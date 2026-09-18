import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorResponse, type User } from 'oidc-client-ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const removeListener = vi.fn();
const listeners: {
  loaded: Array<(user: User) => void>;
  unloaded: Array<() => void>;
  expiring: Array<() => void>;
  expired: Array<() => void>;
  renewError: Array<(error: unknown) => void>;
} = {
  loaded: [],
  unloaded: [],
  expiring: [],
  expired: [],
  renewError: [],
};

const mocks = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  setApiAccessToken: vi.fn(),
  setAuthRecoveryHandler: vi.fn(),
  manager: {
    getUser: vi.fn(),
    signinSilent: vi.fn(),
    signinRedirect: vi.fn(),
    signinRedirectCallback: vi.fn(),
    signoutRedirect: vi.fn(),
    removeUser: vi.fn(),
    startSilentRenew: vi.fn(),
    stopSilentRenew: vi.fn(),
    events: {
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
      addAccessTokenExpiring: vi.fn(),
      addAccessTokenExpired: vi.fn(),
      addSilentRenewError: vi.fn(),
    },
  },
}));

vi.mock('../config/env', () => ({
  frontendConfig: {
    oidc: {
      kind: 'configured',
      issuerUrl: 'https://identity.example/application/o/poc-backend/',
      clientId: 'poc-backend',
      redirectUri: 'http://127.0.0.1:5173/auth/callback',
      postLogoutRedirectUri: 'http://127.0.0.1:5173/login',
      silentRedirectUri: 'http://127.0.0.1:5173/auth/silent-callback',
    },
    allowManualToken: false,
    apiBase: '/api',
  },
}));

vi.mock('../api/me', () => ({
  fetchMe: (...args: unknown[]) => mocks.fetchMe(...args),
}));
vi.mock('../api/client', () => ({
  setApiAccessToken: (...args: unknown[]) => mocks.setApiAccessToken(...args),
  setAuthRecoveryHandler: (...args: unknown[]) => mocks.setAuthRecoveryHandler(...args),
}));
vi.mock('./oidc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oidc')>();
  return { ...actual, createOidcManager: () => mocks.manager };
});

import { AuthProvider } from './AuthProvider';
import { useAuth } from './authContext';

function meResponse(sub = 'editor-user') {
  return {
    data: {
      sub,
      roles: ['editor'],
      permissions: ['content:read', 'content:write'],
      expiresAt: '2030-01-01T00:00:00.000Z',
    },
    status: 200,
    correlationId: 'correlation-1',
  };
}

function oidcUser(overrides: Partial<User> = {}): User {
  return {
    access_token: 'opaque-secret-token',
    id_token: 'id-token',
    refresh_token: 'refresh-secret',
    expired: false,
    ...overrides,
  } as User;
}

function Probe() {
  const { state, login, logout, completeCallback } = useAuth();
  return (
    <div>
      <p>{state.kind}</p>
      <button type="button" onClick={() => void login('/contents')}>Login</button>
      <button type="button" onClick={() => void logout()}>Logout</button>
      <button type="button" onClick={() => void completeCallback().catch(() => undefined)}>Callback</button>
    </div>
  );
}

function renderAuth() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><Probe /></AuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.fetchMe.mockResolvedValue(meResponse());
    mocks.manager.events.addUserLoaded.mockImplementation((cb: (user: User) => void) => {
      listeners.loaded.push(cb);
      return removeListener;
    });
    mocks.manager.events.addUserUnloaded.mockImplementation((cb: () => void) => {
      listeners.unloaded.push(cb);
      return removeListener;
    });
    mocks.manager.events.addAccessTokenExpiring.mockImplementation((cb: () => void) => {
      listeners.expiring.push(cb);
      return removeListener;
    });
    mocks.manager.events.addAccessTokenExpired.mockImplementation((cb: () => void) => {
      listeners.expired.push(cb);
      return removeListener;
    });
    mocks.manager.events.addSilentRenewError.mockImplementation((cb: (error: unknown) => void) => {
      listeners.renewError.push(cb);
      return removeListener;
    });
    mocks.manager.removeUser.mockResolvedValue(undefined);
    mocks.manager.signoutRedirect.mockResolvedValue(undefined);
    mocks.manager.signinRedirect.mockResolvedValue(undefined);
    mocks.manager.signinRedirectCallback.mockReset();
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
    listeners.loaded.length = 0;
    listeners.unloaded.length = 0;
    listeners.expiring.length = 0;
    listeners.expired.length = 0;
    listeners.renewError.length = 0;
  });

  it('validates a restored OIDC user through /me and clears user cache on logout', async () => {
    mocks.manager.getUser.mockResolvedValue(oidcUser());
    mocks.manager.removeUser.mockResolvedValue(undefined);
    mocks.manager.signoutRedirect.mockResolvedValue(undefined);
    mocks.fetchMe.mockResolvedValue(meResponse());
    const queryClient = renderAuth();
    queryClient.setQueryData(['private', 'editor-user'], { secret: false });

    await screen.findByText('authenticated');
    expect(mocks.setApiAccessToken).toHaveBeenCalledWith('opaque-secret-token');
    expect(mocks.fetchMe).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('opaque-secret-token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(mocks.manager.removeUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.getQueryData(['private', 'editor-user'])).toBeUndefined());
    expect(mocks.setApiAccessToken).toHaveBeenCalledWith(null);
    expect(sessionStorage.getItem('indaplay.poc.silentRestoreSuppressed')).toBe('1');
  });

  it('does not silently restore after an explicit logout intent', async () => {
    sessionStorage.setItem('indaplay.poc.silentRestoreSuppressed', '1');
    mocks.manager.getUser.mockResolvedValue(null);
    renderAuth();
    await screen.findByText('anonymous');
    expect(mocks.manager.getUser).not.toHaveBeenCalled();
    expect(mocks.manager.signinSilent).not.toHaveBeenCalled();
    expect(mocks.manager.removeUser).toHaveBeenCalled();
  });

  it('restores a missing memory user through silent prompt=none', async () => {
    mocks.manager.getUser.mockResolvedValue(null);
    mocks.manager.signinSilent.mockResolvedValue(oidcUser({ access_token: 'silent-access' }));
    mocks.fetchMe.mockResolvedValue(meResponse());
    renderAuth();
    await screen.findByText('authenticated');
    expect(mocks.manager.signinSilent).toHaveBeenCalledTimes(1);
    expect(mocks.setApiAccessToken).toHaveBeenCalledWith('silent-access');
    expect(mocks.manager.startSilentRenew).toHaveBeenCalled();
  });

  it('treats login_required as anonymous and does not start an interactive redirect', async () => {
    window.history.pushState({}, '', '/login');
    mocks.manager.getUser.mockResolvedValue(null);
    mocks.manager.signinSilent.mockRejectedValue(new ErrorResponse({ error: 'login_required' }));
    renderAuth();
    await screen.findByText('anonymous');
    expect(mocks.manager.signinRedirect).not.toHaveBeenCalled();
    expect(mocks.setApiAccessToken).toHaveBeenCalledWith(null);
  });

  it('keeps identity_unavailable on a dependency error without a login loop', async () => {
    mocks.manager.getUser.mockResolvedValue(null);
    mocks.manager.signinSilent.mockRejectedValue(new TypeError('Failed to fetch'));
    renderAuth();
    await screen.findByText('identity_unavailable');
    expect(mocks.manager.signinRedirect).not.toHaveBeenCalled();
    expect(mocks.setApiAccessToken).toHaveBeenCalledWith(null);
  });

  it('does not start silent restore on the interactive callback route', async () => {
    window.history.pushState({}, '', '/auth/callback?code=one');
    mocks.manager.getUser.mockResolvedValue(null);
    renderAuth();
    await waitFor(() => expect(mocks.manager.getUser).toHaveBeenCalled());
    expect(mocks.manager.signinSilent).not.toHaveBeenCalled();
    expect(screen.getByText('bootstrapping')).toBeTruthy();
  });

  it('completes the interactive callback and accepts the access token', async () => {
    window.history.pushState({}, '', '/auth/callback?code=one');
    mocks.manager.getUser.mockResolvedValue(null);
    mocks.manager.signinRedirectCallback.mockResolvedValue(oidcUser({ access_token: 'callback-access' }));
    renderAuth();
    await waitFor(() => expect(mocks.manager.getUser).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Callback' }));
    await screen.findByText('authenticated');
    expect(mocks.manager.signinRedirectCallback).toHaveBeenCalled();
    expect(mocks.setApiAccessToken).toHaveBeenCalledWith('callback-access');
  });

  it('keeps logout suppression when callback validation fails', async () => {
    sessionStorage.setItem('indaplay.poc.silentRestoreSuppressed', '1');
    window.history.pushState({}, '', '/auth/callback?code=stale');
    mocks.manager.signinRedirectCallback.mockRejectedValue(new ErrorResponse({ error: 'invalid_request' }));
    renderAuth();
    await screen.findByText('anonymous');
    fireEvent.click(screen.getByRole('button', { name: 'Callback' }));
    await screen.findByText('identity_unavailable');
    expect(sessionStorage.getItem('indaplay.poc.silentRestoreSuppressed')).toBe('1');
  });

  it('shares a single in-flight 401 recovery', async () => {
    mocks.manager.getUser.mockResolvedValue(oidcUser());
    mocks.fetchMe.mockResolvedValue(meResponse());
    let resolveSilent!: (user: User) => void;
    mocks.manager.signinSilent.mockImplementation(() => new Promise<User>(resolve => {
      resolveSilent = resolve;
    }));
    renderAuth();
    await screen.findByText('authenticated');
    const recover = mocks.setAuthRecoveryHandler.mock.calls.at(-1)?.[0] as () => Promise<boolean>;
    const first = recover();
    const second = recover();
    expect(mocks.manager.signinSilent).toHaveBeenCalledTimes(1);
    resolveSilent(oidcUser({ access_token: 'renewed-token' }));
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(mocks.manager.signinSilent).toHaveBeenCalledTimes(1);
    expect(mocks.setApiAccessToken).toHaveBeenCalledWith('renewed-token');
  });

  it('drops a stale Bearer token when silent renew fails', async () => {
    mocks.manager.getUser.mockResolvedValue(oidcUser());
    mocks.fetchMe.mockResolvedValue(meResponse());
    mocks.manager.removeUser.mockResolvedValue(undefined);
    renderAuth();
    await screen.findByText('authenticated');
    mocks.setApiAccessToken.mockClear();
    listeners.renewError[0]?.(new TypeError('Failed to fetch'));
    await waitFor(() => expect(mocks.setApiAccessToken).toHaveBeenCalledWith(null));
    await waitFor(() => expect(mocks.manager.removeUser).toHaveBeenCalled());
    await screen.findByText('identity_unavailable');
  });

  it('starts login only from an explicit user action', async () => {
    sessionStorage.setItem('indaplay.poc.silentRestoreSuppressed', '1');
    mocks.manager.getUser.mockResolvedValue(null);
    mocks.manager.signinSilent.mockRejectedValue(new ErrorResponse({ error: 'login_required' }));
    mocks.manager.signinRedirect.mockResolvedValue(undefined);
    renderAuth();
    await screen.findByText('anonymous');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await waitFor(() => expect(mocks.manager.signinRedirect).toHaveBeenCalledTimes(1));
    expect(mocks.manager.signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/contents' } });
    expect(sessionStorage.getItem('indaplay.poc.silentRestoreSuppressed')).toBeNull();
  });
});
