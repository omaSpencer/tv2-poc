import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

const mocks = vi.hoisted(() => ({
  fetchOperatorAction: vi.fn(),
  fetchQuarantineItem: vi.fn(),
  fetchQuarantineList: vi.fn(),
  fetchReindexPreflight: vi.fn(),
  fetchReindexRun: vi.fn(),
  replayQuarantine: vi.fn(),
  startContentRepair: vi.fn(),
  startReindex: vi.fn(),
}));

vi.mock('../../../api/operations', () => mocks);
vi.mock('../../../auth/authContext', () => ({
  useAuth: () => ({ me: { permissions: ['ops:read', 'ops:write'] } }),
}));

import { QuarantinePage } from './QuarantinePage';
import { ReindexPage } from './ReindexPage';
import { ReindexProgressPage } from './ReindexProgressPage';
import { RepairPage } from './RepairPage';

const ACTION_ID = '123e4567-e89b-42d3-a456-426614174000';
const CONTENT_ID = '123e4567-e89b-42d3-a456-426614174001';
const CONTENT_ID_V7 = '018f1e2c-8b7a-7d3e-9c4b-1a2b3c4d5e6f';

function response<T>(data: T) {
  return { status: 200, correlationId: 'phase-5-test', data };
}

function renderPage(element: React.ReactNode, path = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function action(kind: 'quarantine_replay' | 'content_repair') {
  return {
    id: ACTION_ID,
    kind,
    state: 'succeeded',
    requestedBy: 'publisher-1',
    requestedRoles: ['publisher'],
    reason: 'Operátori indoklás',
    target: kind === 'content_repair' ? { contentId: CONTENT_ID, target: 'both' } : { sequence: 41 },
    result: kind === 'content_repair' ? { contentId: CONTENT_ID, tasks: [] } : {
      sequence: 41, quarantineId: ACTION_ID, originalSequence: 7, replaySequence: 9, duplicate: false,
    },
    correlationId: 'phase-5-test',
    errorCode: null,
    createdAt: '2026-09-17T10:00:00.000Z',
    startedAt: '2026-09-17T10:00:01.000Z',
    heartbeatAt: '2026-09-17T10:00:02.000Z',
    completedAt: '2026-09-17T10:00:03.000Z',
  };
}

describe('Phase 5 operator pages', () => {
  beforeEach(() => {
    sessionStorage.clear();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.fetchReindexPreflight.mockImplementation(async (_index: 'a' | 'b', outage: boolean) => response({
      index: 'a', otherIndex: 'b', otherIndexReady: !outage, otherIndexReachable: !outage,
      activeRunId: null, canStartNormally: !outage, confirmationRequired: outage,
      confirmationTarget: outage ? 'poc_test' : null,
      blockers: outage ? ['other_index_unavailable'] : [],
    }));
  });

  it('requires the exact outage target and submits one durable reindex request', async () => {
    mocks.startReindex.mockResolvedValue(response({ id: ACTION_ID }));
    renderPage(
      <Routes>
        <Route path="/operations/reindex" element={<ReindexPage />} />
        <Route path="/operations/reindex/:runId" element={<h1>Futás megnyitva</h1>} />
      </Routes>,
      '/operations/reindex',
    );

    await screen.findByText('Blokkolók: nincs');
    fireEvent.click(screen.getByRole('checkbox'));
    const confirmation = await screen.findByLabelText(/Pontos adatbázisnév megerősítése/);
    fireEvent.change(screen.getByLabelText('Indoklás'), { target: { value: 'Tervezett karbantartás' } });
    fireEvent.change(confirmation, { target: { value: 'rossz' } });
    expect(screen.getByRole('button', { name: 'Teljes reindex indítása' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(confirmation, { target: { value: 'poc_test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Teljes reindex indítása' }));

    expect(await screen.findByRole('heading', { name: 'Futás megnyitva' })).toBeTruthy();
    expect(mocks.startReindex).toHaveBeenCalledTimes(1);
    expect(mocks.startReindex.mock.calls[0]?.[0]).toEqual({
      index: 'a', reason: 'Tervezett karbantartás', allowSearchOutage: true, confirmTarget: 'poc_test',
    });
    expect(mocks.startReindex.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionStorage.getItem('poc:operator-action:reindex')).toBe(ACTION_ID);
  });

  it('restores a failed reindex by URL without offering cancel or resume', async () => {
    mocks.fetchReindexRun.mockResolvedValue(response({
      ...action('content_repair'), id: ACTION_ID, kind: 'reindex', state: 'failed',
      target: { index: 'a', allowSearchOutage: false }, result: null, errorCode: 'aborted', progress: null,
    }));
    renderPage(
      <Routes><Route path="/operations/reindex/:runId" element={<ReindexProgressPage />} /></Routes>,
      `/operations/reindex/${ACTION_ID}`,
    );

    expect(await screen.findByText('aborted')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Új teljes futás' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /megszakítás|folytatás/i })).toBeNull();
  });

  it('inspects quarantine metadata and starts a reason-bound replay without payload', async () => {
    mocks.fetchQuarantineList.mockResolvedValue(response({
      items: [{
        sequence: 41, schemaValid: true, quarantineId: ACTION_ID,
        failedAt: '2026-09-17T09:00:00.000Z', errorCode: 'projection_rejected',
        originalEventId: CONTENT_ID, originalStream: 'CONTENT', originalSequence: 7,
        subject: 'poc.content.changed.v1', durable: 'search-a-v1',
      }],
      nextCursor: null,
    }));
    mocks.fetchQuarantineItem.mockResolvedValue(response({
      sequence: 41, schemaValid: true, quarantineId: ACTION_ID,
      failedAt: '2026-09-17T09:00:00.000Z', errorCode: 'projection_rejected',
      originalEventId: CONTENT_ID, originalStream: 'CONTENT', originalSequence: 7,
      subject: 'poc.content.changed.v1', durable: 'search-a-v1',
    }));
    mocks.replayQuarantine.mockResolvedValue(response({ id: ACTION_ID }));
    mocks.fetchOperatorAction.mockResolvedValue(response(action('quarantine_replay')));
    const { container } = renderPage(<QuarantinePage />, '/operations/quarantine');

    fireEvent.click(await screen.findByRole('button', { name: /#41/ }));
    await screen.findByRole('heading', { name: 'Karantén #41' });
    fireEvent.change(screen.getByLabelText('Indoklás'), { target: { value: 'Projection újrapróbálás' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replay indítása' }));

    expect(await screen.findByRole('heading', { name: 'Replay állapota' })).toBeTruthy();
    expect(mocks.replayQuarantine).toHaveBeenCalledWith(41, { reason: 'Projection újrapróbálás' }, expect.any(String));
    expect(container.textContent).not.toContain('event payload');
  });

  it('submits a both-index repair and restores its terminal action panel', async () => {
    mocks.startContentRepair.mockResolvedValue(response({ id: ACTION_ID }));
    mocks.fetchOperatorAction.mockResolvedValue(response(action('content_repair')));
    renderPage(<RepairPage />, '/operations/repair');

    fireEvent.change(screen.getByLabelText('Tartalom UUID'), { target: { value: CONTENT_ID_V7 } });
    fireEvent.change(screen.getByLabelText('Indoklás'), { target: { value: 'Keresőprojekció javítása' } });
    fireEvent.click(screen.getByRole('button', { name: 'Javítás indítása' }));

    await waitFor(() => expect(mocks.startContentRepair).toHaveBeenCalledTimes(1));
    expect(mocks.startContentRepair.mock.calls[0]?.[0]).toEqual({
      contentId: CONTENT_ID_V7, target: 'both', reason: 'Keresőprojekció javítása',
    });
    expect(await screen.findByRole('heading', { name: 'Javítás állapota' })).toBeTruthy();
  });

  it('accepts a UUID v7 repair target and rejects nil or malformed ids', () => {
    renderPage(<RepairPage />, '/operations/repair');
    fireEvent.change(screen.getByLabelText('Indoklás'), { target: { value: 'Keresőprojekció javítása' } });
    const submit = () => screen.getByRole('button', { name: 'Javítás indítása' });
    fireEvent.change(screen.getByLabelText('Tartalom UUID'), { target: { value: 'not-a-uuid' } });
    expect(submit().hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Tartalom UUID'), { target: { value: '00000000-0000-0000-0000-000000000000' } });
    expect(submit().hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Tartalom UUID'), { target: { value: CONTENT_ID_V7 } });
    expect(submit().hasAttribute('disabled')).toBe(false);
  });
});
