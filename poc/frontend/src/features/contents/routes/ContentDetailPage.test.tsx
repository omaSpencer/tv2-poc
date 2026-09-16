import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminContentView, AppRole, MeResponse } from '../../../api/types';
import type { AuthContextValue } from '../../../auth/authTypes';
import { AuthContext } from '../../../auth/authContext';
import { NotificationProvider } from '../../../components/NotificationProvider';

const mocks = vi.hoisted(() => ({
  getAdminContent: vi.fn(), listContentAudit: vi.fn(), publishContent: vi.fn(), withdrawContent: vi.fn(),
}));
vi.mock('../api', () => mocks);

import { ContentDetailPage } from './ContentDetailPage';

const baseContent: AdminContentView = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Téli Őrség', slug: null,
  summary: 'Összefoglaló', category: 'film', mediaAssetId: 'VOD-1', tags: ['tél'],
  status: 'draft', version: 1, createdAt: '2026-09-16T09:00:00.000Z',
  updatedAt: '2026-09-16T10:00:00.000Z', publishedAt: null, withdrawnAt: null,
  createdBy: 'editor', updatedBy: 'editor',
};

function authFor(role: AppRole): AuthContextValue {
  const permissions: MeResponse['permissions'] = role === 'publisher'
    ? ['content:read', 'content:write', 'content:publish', 'ops:read']
    : ['content:read', 'content:write'];
  const me: MeResponse = { sub: role, roles: [role], permissions, expiresAt: '2030-01-01T00:00:00.000Z' };
  return {
    state: { kind: 'authenticated', me }, me, isAuthenticated: true, manualTokenAllowed: false,
    login: vi.fn(async () => undefined), completeCallback: vi.fn(async () => '/'),
    logout: vi.fn(async () => undefined), retry: vi.fn(async () => undefined),
    setManualToken: vi.fn(async () => undefined),
  };
}

function renderDetail(role: AppRole, content: AdminContentView) {
  mocks.getAdminContent.mockResolvedValue({ data: content, status: 200, correlationId: 'corr' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authFor(role)}>
        <NotificationProvider>
          <MemoryRouter initialEntries={[`/contents/${content.id}`]}>
            <Routes><Route path="/contents/:id" element={<ContentDetailPage />} /></Routes>
          </MemoryRouter>
        </NotificationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('content detail action matrix', () => {
  beforeEach(() => {
    mocks.getAdminContent.mockReset();
    mocks.listContentAudit.mockResolvedValue({ data: { items: [], nextCursor: null }, status: 200, correlationId: 'audit' });
  });

  it('lets an editor edit a draft but keeps publish visibly disabled', async () => {
    renderDetail('editor', baseContent);
    expect(await screen.findByRole('link', { name: 'Szerkesztés' })).toBeTruthy();
    const publish = screen.getByRole('button', { name: 'Publikálás' });
    expect(publish.hasAttribute('disabled')).toBe(true);
    expect(publish.getAttribute('title')).toContain('content:publish');
  });

  it('lets a publisher publish a ready draft', async () => {
    renderDetail('publisher', baseContent);
    const publish = await screen.findByRole('button', { name: 'Publikálás' });
    expect(publish.hasAttribute('disabled')).toBe(false);
  });

  it('keeps published content read-only and offers withdraw only to publisher', async () => {
    renderDetail('publisher', { ...baseContent, status: 'published', slug: 'teli-orseg', version: 2, publishedAt: '2026-09-16T11:00:00.000Z' });
    expect(await screen.findByRole('button', { name: 'Visszavonás' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Szerkesztés' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Publikus nézet megnyitása' })).toBeTruthy();
  });
});
