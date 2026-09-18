import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { appRoutes } from './appRoutes';
import { AuthContext } from './auth/authContext';
import type { AuthContextValue, AuthState } from './auth/authTypes';
import { publisherFixture } from './test/fixtures/api';
import { server } from './test/server';

vi.mock('./components/StatusBar', () => ({
  StatusBar: () => <header>status</header>,
}));

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

function renderApp(path: string, auth: AuthContextValue) {
  server.use(
    http.get('*/api/admin/contents', () => HttpResponse.json(
      { items: [], nextCursor: null },
      { headers: { 'X-Correlation-Id': 'test-contents' } },
    )),
  );
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

describe('app compatibility routes', () => {
  it('redirects /editorial to /contents for an authenticated reader', async () => {
    const router = renderApp('/editorial', authValue({ kind: 'authenticated', me: publisherFixture }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/contents'));
    expect(screen.getByRole('link', { name: 'Tartalmak' }).getAttribute('aria-current')).toBe('page');
  });

  it('preserves /contents as the /editorial bookmark target for anonymous users', async () => {
    const router = renderApp('/editorial', authValue({ kind: 'anonymous' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.search).toBe('?returnTo=%2Fcontents');
    });
  });
});
