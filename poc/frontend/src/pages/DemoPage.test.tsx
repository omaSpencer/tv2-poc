import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/authContext';
import type { AuthContextValue } from '../auth/authTypes';
import { DemoPage } from './DemoPage';
import type { MeResponse } from '../api/types';

vi.mock('../features/demo/persistence', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../features/demo/persistence')>();
  return {
    ...original,
    fingerprintSubject: vi.fn(async () => 'a'.repeat(64)),
    loadPersistedRun: vi.fn(() => null),
    persistRun: vi.fn(),
  };
});

const me: MeResponse = {
  sub: 'publisher-1', roles: ['publisher'],
  permissions: ['content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write'],
  expiresAt: '2030-01-01T00:00:00.000Z',
};

const auth: AuthContextValue = {
  state: { kind: 'authenticated', me }, me, isAuthenticated: true, manualTokenAllowed: true,
  login: vi.fn(), completeCallback: vi.fn(), logout: vi.fn(), retry: vi.fn(), setManualToken: vi.fn(),
};

describe('DemoPage Phase 6 workspace', () => {
  it('renders all five declarative scenarios without request editors', () => {
    render(
      <MemoryRouter>
        <AuthContext value={auth}><DemoPage /></AuthContext>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /Scenario runner és evidence workspace/i })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('button', { name: /S01 · Publisher életciklus/i }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
