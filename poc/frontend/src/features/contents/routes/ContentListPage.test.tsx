import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../../../api/types';
import type { AuthContextValue } from '../../../auth/authTypes';
import { AuthContext } from '../../../auth/authContext';

const mocks = vi.hoisted(() => ({ listAdminContents: vi.fn() }));
vi.mock('../api', () => ({ listAdminContents: mocks.listAdminContents }));

import { ContentListPage } from './ContentListPage';

const me: MeResponse = {
  sub: 'publisher', roles: ['publisher'],
  permissions: ['content:read', 'content:write', 'content:publish', 'ops:read'],
  expiresAt: '2030-01-01T00:00:00.000Z',
};
const auth: AuthContextValue = {
  state: { kind: 'authenticated', me }, me, isAuthenticated: true, manualTokenAllowed: false,
  login: vi.fn(async () => undefined), completeCallback: vi.fn(async () => '/'),
  logout: vi.fn(async () => undefined), retry: vi.fn(async () => undefined),
  setManualToken: vi.fn(async () => undefined),
};

function response(nextCursor: string | null) {
  return {
    status: 200, correlationId: 'corr',
    data: {
      items: [{
        id: '00000000-0000-4000-8000-000000000001', title: 'Alma film', slug: 'alma-film',
        category: 'film', status: 'draft', version: 1, updatedAt: '2026-09-16T10:00:00.000Z',
        updatedBy: 'editor', publishedAt: null,
      }],
      nextCursor,
    },
  };
}

function renderPage(initial = '/contents?q=alma&status=draft') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[initial]}>
          <Routes><Route path="/contents" element={<ContentListPage />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('ContentListPage', () => {
  beforeEach(() => {
    mocks.listAdminContents.mockReset();
    mocks.listAdminContents.mockImplementation(async params => response(params.cursor ? null : 'cursor-two'));
  });

  it('round-trips URL filters and exposes create for a writer', async () => {
    renderPage();
    expect((await screen.findAllByText('Alma film')).length).toBeGreaterThan(0);
    await waitFor(() => expect(mocks.listAdminContents).toHaveBeenCalledWith(expect.objectContaining({
      q: 'alma', status: 'draft', cursor: null,
    })));
    expect(screen.getByRole('link', { name: 'Új tartalom' }).getAttribute('href')).toBe('/contents/new');
  });

  it('uses cursor history and resets it when a filter changes', async () => {
    renderPage();
    await screen.findAllByText('Alma film');
    fireEvent.click(screen.getByRole('button', { name: 'Következő' }));
    await waitFor(() => expect(mocks.listAdminContents).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'cursor-two' })));
    fireEvent.change(screen.getByLabelText('Státusz'), { target: { value: 'published' } });
    await waitFor(() => expect(mocks.listAdminContents).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'published', cursor: null,
    })));
    expect(screen.getByRole('button', { name: 'Előző' }).hasAttribute('disabled')).toBe(true);
  });
});
