import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthPage } from '../pages/AuthPage';
import { AuthCallbackPage } from '../pages/AuthCallbackPage';
import type { AuthContextValue, AuthState } from './authTypes';
import { AuthContext } from './authContext';
import { RequireAuth } from './RequireAuth';

function authValue(state: AuthState, overrides: Partial<AuthContextValue> = {}): AuthContextValue {
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
    ...overrides,
  };
}

function LoginProbe() {
  const location = useLocation();
  return <p>Login {location.search}</p>;
}

function renderProtected(value: AuthContextValue, path = '/operations') {
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route path="*" element={<RequireAuth><p>Protected content</p></RequireAuth>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('auth route UX', () => {
  it('does not flash protected content while bootstrapping', () => {
    renderProtected(authValue({ kind: 'bootstrapping' }));
    expect(screen.getByRole('status').textContent).toContain('Munkamenet ellenőrzése');
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('redirects anonymous users and preserves the complete internal return route', () => {
    renderProtected(authValue({ kind: 'anonymous' }), '/operations?view=all#queue');
    expect(screen.getByText(/Login/).textContent).toContain(
      'returnTo=%2Foperations%3Fview%3Dall%23queue',
    );
  });

  it('keeps an identity outage on the protected route without a login loop', () => {
    const retry = vi.fn(async () => undefined);
    renderProtected(authValue(
      { kind: 'identity_unavailable', message: 'Az identity átmenetileg nem válaszol.', me: null },
      { retry },
    ));
    expect(screen.getByRole('alert').textContent).toContain('átmenetileg nem válaszol');
    fireEvent.click(screen.getByRole('button', { name: 'Újrapróbálás' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Login/)).toBeNull();
  });

  it('does not render a manual token control in a normal build context', () => {
    render(
      <AuthContext.Provider value={authValue({ kind: 'anonymous' })}>
        <MemoryRouter><AuthPage /></MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.queryByLabelText(/Access token/)).toBeNull();
  });

  it('renders the manual token control only when the explicit flag is enabled', () => {
    render(
      <AuthContext.Provider value={authValue({ kind: 'anonymous' }, { manualTokenAllowed: true })}>
        <MemoryRouter><AuthPage /></MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.getByLabelText(/Access token/)).toBeTruthy();
  });

  it('replaces the callback URL with the validated internal return route', async () => {
    const completeCallback = vi.fn(async () => '/contents/one');
    render(
      <AuthContext.Provider value={authValue({ kind: 'authenticating' }, { completeCallback })}>
        <MemoryRouter initialEntries={['/auth/callback?code=secret-code']}>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/contents/one" element={<p>Content destination</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText('Content destination')).toBeTruthy();
    expect(completeCallback).toHaveBeenCalledTimes(1);
  });

  it('shows a generic callback failure without rendering the provider error', async () => {
    const completeCallback = vi.fn(async () => {
      throw new Error('secret provider response');
    });
    render(
      <AuthContext.Provider value={authValue({ kind: 'authenticating' }, { completeCallback })}>
        <MemoryRouter><AuthCallbackPage /></MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText(/callback feldolgozása sikertelen/)).toBeTruthy();
    expect(screen.queryByText(/secret provider response/)).toBeNull();
  });
});
