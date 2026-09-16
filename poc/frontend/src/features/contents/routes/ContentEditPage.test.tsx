import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblemError, type AdminContentView, type ProblemDocument } from '../../../api/types';
import { NotificationProvider } from '../../../components/NotificationProvider';

const mocks = vi.hoisted(() => ({ getAdminContent: vi.fn(), patchContent: vi.fn() }));
vi.mock('../api', () => mocks);

import { ContentEditPage } from './ContentEditPage';

const content: AdminContentView = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Téli Őrség', slug: null,
  summary: 'Eredeti összefoglaló', category: 'film', mediaAssetId: 'VOD-1', tags: ['tél'],
  status: 'draft', version: 1, createdAt: '2026-09-16T09:00:00.000Z',
  updatedAt: '2026-09-16T10:00:00.000Z', publishedAt: null, withdrawnAt: null,
  createdBy: 'editor', updatedBy: 'editor',
};

function response(data: AdminContentView) {
  return { data, status: 200, correlationId: 'corr' };
}

function renderEdit() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/contents/:id/edit', element: <ContentEditPage /> },
    { path: '/contents/:id', element: <p>Detail route</p> },
  ], { initialEntries: [`/contents/${content.id}/edit`] });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <RouterProvider router={router} />
      </NotificationProvider>
    </QueryClientProvider>,
  );
}

describe('ContentEditPage', () => {
  beforeEach(() => {
    mocks.getAdminContent.mockReset().mockResolvedValue(response(content));
    mocks.patchContent.mockReset();
  });

  it('does not send a no-op PATCH or claim a version increase', async () => {
    renderEdit();
    fireEvent.click(await screen.findByRole('button', { name: 'Módosítások mentése' }));
    expect(mocks.patchContent).not.toHaveBeenCalled();
    expect(await screen.findByText('Nincs mentendő változás.')).toBeTruthy();
  });

  it('sends only normalized dirty fields with the current expected version', async () => {
    mocks.patchContent.mockResolvedValue(response({ ...content, summary: 'Új összefoglaló', version: 2 }));
    renderEdit();
    fireEvent.change(await screen.findByLabelText(/Összefoglaló/), { target: { value: '  Új összefoglaló  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Módosítások mentése' }));
    await waitFor(() => expect(mocks.patchContent).toHaveBeenCalledWith(content.id, {
      expectedVersion: 1,
      summary: 'Új összefoglaló',
    }));
  });

  it('keeps the local draft through a version conflict and never retries automatically', async () => {
    const problem: ProblemDocument = {
      type: 'urn:indaplay:poc:error:version_conflict', title: 'Conflict', status: 409,
      code: 'version_conflict', detail: 'Conflict', instance: '/admin/contents/id',
      correlationId: 'conflict', expectedVersion: 1, actualVersion: 2,
    };
    const server = { ...content, title: 'Szervercím', version: 2 };
    mocks.patchContent.mockRejectedValueOnce(new ApiProblemError(problem, 'conflict'));
    mocks.getAdminContent.mockResolvedValueOnce(response(content)).mockResolvedValueOnce(response(server));
    renderEdit();
    fireEvent.change(await screen.findByLabelText(/Összefoglaló/), { target: { value: 'Helyi szöveg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Módosítások mentése' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(mocks.patchContent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Saját módosítások megtartása' }));
    expect((screen.getByLabelText(/Összefoglaló/) as HTMLTextAreaElement).value).toBe('Helyi szöveg');
    expect((screen.getByLabelText(/Cím/) as HTMLInputElement).value).toBe('Szervercím');
    expect(mocks.patchContent).toHaveBeenCalledTimes(1);
  });
});
