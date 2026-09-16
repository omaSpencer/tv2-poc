import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProcessingStatus } from '../../../api/types';
import { RELAY_LABELS } from '../viewModel';
import { ServiceCards } from './ServiceCards';

function makeStatus(overrides: Partial<ProcessingStatus> = {}): ProcessingStatus {
  return {
    outbox: { pending: 0, oldestOccurredAt: null, oldestAgeMs: null },
    relay: { enabled: true, state: 'idle', lastDeliveredAt: null, lastErrorCode: null },
    broker: { connected: true, streamPresent: true },
    quarantine: { pending: 0 },
    ...overrides,
  };
}

describe('ServiceCards', () => {
  it.each(Object.entries(RELAY_LABELS) as [ProcessingStatus['relay']['state'], string][])('renders relay state %s', (state, label) => {
    render(<ServiceCards status={makeStatus({
      relay: { enabled: true, state, lastDeliveredAt: null, lastErrorCode: null },
    })} />);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('treats a disabled relay as off rather than an automatic error', () => {
    const { container } = render(<ServiceCards status={makeStatus({
      relay: { enabled: false, state: 'halted', lastDeliveredAt: null, lastErrorCode: 'relay_halted' },
    })} />);
    expect(screen.getByText('Kikapcsolva')).toBeTruthy();
    expect(screen.getByText('Leállt')).toBeTruthy();
    expect(container.querySelector('.operations-service-card .ops-status-neutral')).toBeTruthy();
  });

  it('keeps an unknown broker stream and an empty quarantine explicit', () => {
    render(<ServiceCards status={makeStatus({
      broker: { connected: false, streamPresent: null }, quarantine: { pending: 0 },
    })} />);
    expect(screen.getByText('Még nem ismert')).toBeTruthy();
    expect(screen.getByText('Nincs kapcsolat')).toBeTruthy();
    expect(screen.getByText('Nincs jelentett karanténelem.')).toBeTruthy();
  });
});
