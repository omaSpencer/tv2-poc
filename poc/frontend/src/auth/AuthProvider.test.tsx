import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from 'oidc-client-ts';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const removeListener = vi.fn();
  return {
    fetchMe: vi.fn(),
    setApiAccessToken: vi.fn(),
    setAuthRecoveryHandler: vi.fn(),
    manager: {
      getUser: vi.fn(),
      signinSilent: vi.fn(),
      signinRedirect: vi.fn(),
      signoutRedirect: vi.fn(),
      removeUser: vi.fn(),
      stopSilentRenew: vi.fn(),
      events: {
        addUserLoaded: vi.fn(() => removeListener),
        addUserUnloaded: vi.fn(() => removeListener),
        addAccessTokenExpiring: vi.fn(() => removeListener),
        addAccessTokenExpired: vi.fn(() => removeListener),
        addSilentRenewError: vi.fn(() => removeListener),
      },
    },
  };
});

vi.mock('../config/env', () => ({
  frontendConfig: {
    oidc: {
      kind: 'configured',
      issuerUrl: 'https://identity.example/application/o/poc-backend/',
      clientId: 'poc-backend',
      redirectUri: 'http://127.0.0.1:5173/auth/callback',
      postLogoutRedirectUri: 'http://127.0.0.1:5173/login',
    },
    allowManualToken: false,
  },
}));

vi.mock('../api/me', () => ({ fetchMe: mocks.fetchMe }));
vi.mock('../api/client', () => ({
  setApiAccessToken: mocks.setApiAccessToken,
  setAuthRecoveryHandler: mocks.setAuthRecoveryHandler,
}));
vi.mock('./oidc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oidc')>();
  return { ...actual, createOidcManager: () => mocks.manager };
});

import { AuthProvider } from './AuthProvider';
import { useAuth } from './authContext';

function Probe() {
  const { state, logout } = useAuth();
  return (
    <div>
      <p>{state.kind}</p>
      <button type="button" onClick={() => void logout()}>Logout</button>
    </div>
  );
}

describe('AuthProvider', () => {
  it('validates a restored OIDC user through /me and clears user cache on logout', async () => {
    const oidcUser = {
      access_token: 'opaque-secret-token',
      id_token: 'id-token',
      expired: false,
    } as User;
    mocks.manager.getUser.mockResolvedValue(oidcUser);
    mocks.manager.removeUser.mockResolvedValue(undefined);
    mocks.manager.signoutRedirect.mockResolvedValue(undefined);
    mocks.fetchMe.mockResolvedValue({
      data: {
        sub: 'editor-user',
        roles: ['editor'],
        permissions: ['content:read', 'content:write'],
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
      status: 200,
      correlationId: 'correlation-1',
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['private', 'editor-user'], { secret: false });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><Probe /></AuthProvider>
      </QueryClientProvider>,
    );

    await screen.findByText('authenticated');
    expect(mocks.setApiAccessToken).toHaveBeenCalledWith('opaque-secret-token');
    expect(mocks.fetchMe).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('opaque-secret-token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(mocks.manager.removeUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.getQueryData(['private', 'editor-user'])).toBeUndefined());
    expect(mocks.setApiAccessToken).toHaveBeenCalledWith(null);
  });
});
