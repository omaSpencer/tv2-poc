import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProcessingStatus } from '../../../api/types';
import { INDEX_STATE_LABELS, PHASE_LABELS } from '../viewModel';
import { IndexStatusCard } from './IndexStatusCard';

type Index = NonNullable<ProcessingStatus['indexes']>['a'];

function makeIndex(overrides: Partial<Index> = {}): Index {
  return {
    state: 'idle', durable: 'search-index-a', inFlightEventId: '00000000-0000-4000-8000-000000000001',
    inFlightTaskUid: 42, lastAckedAt: '2026-09-16T10:00:00.000Z', lastErrorCode: 'index_retry',
    reachable: true, phase: 'ready', desiredWorkerState: 'running',
    runId: '00000000-0000-4000-8000-000000000002', snapshotStreamSequence: 100,
    outboxHighWater: 120, catchUpStreamSequence: 118, importedDocuments: 75,
    expectedDocuments: 100, startedAt: '2026-09-16T09:00:00.000Z',
    updatedAt: '2026-09-16T10:00:00.000Z', completedAt: null, routeEligible: true,
    ...overrides,
  };
}

describe('IndexStatusCard', () => {
  it('shows runtime, progress and every technical boundary in one reusable card', () => {
    const { container } = render(<IndexStatusCard alias="a" index={makeIndex()} />);

    expect(screen.getByRole('heading', { name: 'Index A' })).toBeTruthy();
    expect(screen.getByText('Routolható')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('index_retry')).toBeTruthy();
    expect(screen.getByText('Technikai futásrészletek')).toBeTruthy();
    expect(container.querySelector('details')?.open).toBe(false);
  });

  it.each(Object.entries(INDEX_STATE_LABELS) as [Index['state'], string][])('renders runtime state %s', (state, label) => {
    render(<IndexStatusCard alias="a" index={makeIndex({ state })} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it.each(Object.entries(PHASE_LABELS) as [NonNullable<Index['phase']>, string][])('renders durable phase %s', (phase, label) => {
    render(<IndexStatusCard alias="b" index={makeIndex({ phase })} />);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('does not invent a percentage when the expected document count is unknown', () => {
    render(<IndexStatusCard alias="a" index={makeIndex({ expectedDocuments: null })} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/Százalék nem számítható/)).toBeTruthy();
  });
});
