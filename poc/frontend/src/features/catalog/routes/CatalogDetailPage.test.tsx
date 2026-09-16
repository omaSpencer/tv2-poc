import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchPublishedContent: vi.fn() }));
vi.mock('../../../api/catalog', () => ({ fetchPublishedContent: mocks.fetchPublishedContent }));

import { CatalogDetailError, CatalogDetailPage } from './CatalogDetailPage';

const id = '00000000-0000-4000-8000-000000000001';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/catalog/${id}`]}>
        <Routes><Route path="/catalog/:id" element={<CatalogDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CatalogDetailPage', () => {
  beforeEach(() => mocks.fetchPublishedContent.mockReset());

  it('renders only the public contract fields', async () => {
    mocks.fetchPublishedContent.mockResolvedValue({
      status: 200,
      correlationId: 'corr',
      data: {
        id, title: 'Publikus film', slug: 'publikus-film', summary: 'Publikus leírás',
        category: 'film', tags: ['publikus'], publishedAt: '2026-09-16T10:00:00.000Z',
        mediaAssetId: 'private-media', updatedBy: 'private-actor', version: 22,
      },
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Publikus film' })).toBeTruthy();
    expect(screen.getByText('Publikus leírás')).toBeTruthy();
    expect(screen.queryByText('private-media')).toBeNull();
    expect(screen.queryByText('private-actor')).toBeNull();
    expect(screen.queryByText('22')).toBeNull();
  });

  it('uses a dedicated public 404 state', () => {
    const error = {
      name: 'ApiProblemError',
      problem: {
        type: 'about:blank', title: 'Not found', status: 404, detail: 'Not found',
        instance: `/catalog/contents/${id}`, code: 'content_not_found', correlationId: 'corr', fields: [],
      },
      correlationId: 'corr',
    };
    render(<MemoryRouter><CatalogDetailError error={error} backToSearch="/catalog/search" /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Nem található vagy már nem publikus' })).toBeTruthy();
    expect(screen.queryByText('content_not_found')).toBeNull();
  });
});
