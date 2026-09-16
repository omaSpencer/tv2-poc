import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../api/types';
import type { AuthContextValue } from './authTypes';
import { AuthContext } from './authContext';
import { RequirePermission } from './RequirePermission';

const base = {
  manualTokenAllowed: false,
  login: vi.fn(), completeCallback: vi.fn(), logout: vi.fn(), retry: vi.fn(), setManualToken: vi.fn(),
};

function renderWithAuth(value: AuthContextValue) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={value}>
        <RequirePermission permission="ops:read"><p>Operations content</p></RequirePermission>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('RequirePermission', () => {
  it('shows content for an authenticated user with the permission', () => {
    const me: MeResponse = { sub: 'one', roles: ['publisher'], permissions: ['ops:read'], expiresAt: '2030-01-01T00:00:00.000Z' };
    renderWithAuth({ ...base, state: { kind: 'authenticated', me }, me, isAuthenticated: true });
    expect(screen.getByText('Operations content')).toBeTruthy();
  });

  it('keeps the session and shows a permission explanation on 403-style access', () => {
    const me: MeResponse = { sub: 'one', roles: ['editor'], permissions: ['content:read', 'content:write'], expiresAt: '2030-01-01T00:00:00.000Z' };
    renderWithAuth({ ...base, state: { kind: 'authenticated', me }, me, isAuthenticated: true });
    expect(screen.getByRole('alert').textContent).toContain('ops:read');
    expect(screen.queryByText('Operations content')).toBeNull();
  });
});
