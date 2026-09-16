import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblemError } from '../../../api/types';

const mocks = vi.hoisted(() => ({
  searchCatalog: vi.fn(),
  fetchPublishedContent: vi.fn(),
}));

vi.mock('../../../api/search', () => ({ searchCatalog: mocks.searchCatalog }));
vi.mock('../../../api/catalog', () => ({ fetchPublishedContent: mocks.fetchPublishedContent }));

import { CatalogDetailPage } from './CatalogDetailPage';
import { CatalogSearchPage } from './CatalogSearchPage';

const publicContent = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Őrségi történetek',
  slug: 'orsegi-tortenetek',
  summary: 'Egy publikus összefoglaló.',
  category: 'film' as const,
  tags: ['őrség', 'természet'],
  publishedAt: '2026-09-16T10:00:00.000Z',
};

function response(offset: number, returned = 1, estimatedTotalHits = 41) {
  return {
    status: 200,
    correlationId: 'corr-public',
    data: {
      items: returned ? [publicContent] : [],
      offset,
      limit: 20,
      returned,
      estimatedTotalHits,
    },
  };
}

function LocationEcho() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderCatalog(initial = '/catalog/search?q=%C5%91rs%C3%A9g&limit=20&offset=0') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initial]}>
        <LocationEcho />
        <Routes>
          <Route path="/catalog/search" element={<CatalogSearchPage />} />
          <Route path="/catalog/:id" element={<CatalogDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CatalogSearchPage', () => {
  beforeEach(() => {
    mocks.searchCatalog.mockReset();
    mocks.fetchPublishedContent.mockReset();
    mocks.searchCatalog.mockImplementation(async (_query, opts) => response(opts.offset));
    mocks.fetchPublishedContent.mockResolvedValue({ status: 200, correlationId: 'detail', data: publicContent });
  });

  it('canonicalizes URL state and keeps query, category, limit and offset bookmarkable', async () => {
    renderCatalog('/catalog/search?offset=bad&limit=999&category=secret&q=%20%C5%91rs%C3%A9g%20&junk=x');

    expect((await screen.findAllByText('Őrségi történetek')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(
      '/catalog/search?q=%C5%91rs%C3%A9g&limit=20&offset=0',
    ));
    expect(mocks.searchCatalog).toHaveBeenCalledWith('őrség', expect.objectContaining({
      category: null, limit: 20, offset: 0,
    }));
  });

  it('separates returned results from the index estimate and explains a short page', async () => {
    mocks.searchCatalog.mockResolvedValue(response(0, 1, 12));
    renderCatalog();

    expect(await screen.findByText('Az index becslése: 12')).toBeTruthy();
    expect(screen.getByText('Ezen az oldalon: 1')).toBeTruthy();
    expect(screen.getByText(/időközben visszavont vagy elavult/)).toBeTruthy();
  });

  it('resets the offset for filters and focuses results after paging', async () => {
    renderCatalog('/catalog/search?q=%C5%91rs%C3%A9g&limit=20&offset=20');
    await screen.findAllByText('Őrségi történetek');

    fireEvent.change(screen.getByLabelText('Kategória'), { target: { value: 'film' } });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('category=film&limit=20&offset=0'));

    const nextButton = screen.getByRole('button', { name: 'Következő oldal' });
    await waitFor(() => expect(nextButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(nextButton);
    await waitFor(() => expect(mocks.searchCatalog).toHaveBeenLastCalledWith('őrség', expect.objectContaining({
      category: 'film', offset: 20,
    })));
    await waitFor(() => expect(screen.getByRole('heading', { name: '„őrség”' })).toBe(document.activeElement));
  });

  it.each([
    ['search_unavailable', 'A keresés átmenetileg nem elérhető'],
    ['dependency_unavailable', 'Egy háttérszolgáltatás nem elérhető'],
  ] as const)('shows a retryable %s state', async (code, heading) => {
    mocks.searchCatalog.mockRejectedValue(new ApiProblemError({
      type: 'about:blank', title: 'Unavailable', status: 503,
      detail: 'Unavailable', instance: '/catalog/search', code,
      correlationId: 'corr', fields: [],
    }, 'corr'));
    renderCatalog();

    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Újrapróbálás' })).toBeTruthy();
  });

  it('offers canonical URL recovery for a backend 422', async () => {
    mocks.searchCatalog.mockRejectedValue(new ApiProblemError({
      type: 'about:blank', title: 'Validation failed', status: 422,
      detail: 'Validation failed', instance: '/catalog/search', code: 'validation_failed',
      correlationId: 'corr', fields: ['q', 'offset'],
    }, 'corr'));
    renderCatalog();

    expect(await screen.findByRole('heading', { name: 'A keresési URL hibás' })).toBeTruthy();
    expect(screen.getByText(/q, offset/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Szűrők alaphelyzetbe állítása' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/catalog/search?limit=20&offset=0'));
  });

  it('shows a retryable network state and enforces the offset ceiling', async () => {
    mocks.searchCatalog.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderCatalog('/catalog/search?q=%C5%91rs%C3%A9g&limit=20&offset=1000');

    expect(await screen.findByRole('heading', { name: 'Kapcsolati hiba' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Újrapróbálás' })).toBeTruthy();

    mocks.searchCatalog.mockResolvedValue(response(1000, 1, 5000));
    fireEvent.click(screen.getByRole('button', { name: 'Újrapróbálás' }));
    await screen.findAllByText('Őrségi történetek');
    expect(screen.getByRole('button', { name: 'Következő oldal' }).hasAttribute('disabled')).toBe(true);
  });

  it('completes anonymous search → filter → next → detail → back without exposing admin fields', async () => {
    mocks.fetchPublishedContent.mockResolvedValue({
      status: 200,
      correlationId: 'detail',
      data: { ...publicContent, mediaAssetId: 'secret-media', updatedBy: 'actor-secret', version: 99 },
    });
    renderCatalog();
    await screen.findAllByText('Őrségi történetek');

    fireEvent.change(screen.getByLabelText('Kategória'), { target: { value: 'film' } });
    await waitFor(() => expect(mocks.searchCatalog).toHaveBeenLastCalledWith('őrség', expect.objectContaining({ category: 'film' })));
    const nextButton = screen.getByRole('button', { name: 'Következő oldal' });
    await waitFor(() => expect(nextButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(nextButton);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('offset=20'));
    fireEvent.click(screen.getByRole('link', { name: 'Őrségi történetek' }));

    expect(await screen.findByRole('heading', { name: 'Őrségi történetek' })).toBeTruthy();
    expect(screen.queryByText('secret-media')).toBeNull();
    expect(screen.queryByText('actor-secret')).toBeNull();
    expect(screen.queryByText('99')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Vissza a kereséshez' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('category=film&limit=20&offset=20'));
  });
});
