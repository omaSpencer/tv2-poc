import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblemError } from '../../api/types';

const mocks = vi.hoisted(() => ({ fetchPublishedContent: vi.fn() }));
vi.mock('../../api/catalog', () => ({ fetchPublishedContent: mocks.fetchPublishedContent }));

import { CATALOG_POLL_BUDGET_MS, useCatalogVisibilityPolling } from './useCatalogVisibilityPolling';

const id = '00000000-0000-4000-8000-000000000001';
const notFound = () => new ApiProblemError({
  type: 'about:blank', title: 'Not found', status: 404, code: 'content_not_found',
  detail: 'Not found', instance: `/catalog/contents/${id}`, correlationId: 'corr', fields: [],
}, 'corr');

function Harness() {
  const polling = useCatalogVisibilityPolling();
  return (
    <div>
      <output>{polling.phase}:{polling.target ?? 'none'}</output>
      <button type="button" onClick={() => polling.start(id, 'visible')}>Publikálás figyelése</button>
      <button type="button" onClick={() => polling.start(id, 'hidden')}>Visszavonás figyelése</button>
    </div>
  );
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useCatalogVisibilityPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchPublishedContent.mockReset();
    setVisibility('visible');
  });

  it('uses the 1s → 2s cadence and succeeds when a publish becomes public', async () => {
    mocks.fetchPublishedContent.mockRejectedValueOnce(notFound()).mockResolvedValueOnce({ data: {}, status: 200 });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Publikálás figyelése' }));

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.fetchPublishedContent).toHaveBeenCalledTimes(1);
    expect(screen.getByText('waiting:visible')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.fetchPublishedContent).toHaveBeenCalledTimes(2);
    expect(screen.getByText('success:visible')).toBeTruthy();
  });

  it('treats a 404 as successful withdrawal visibility', async () => {
    mocks.fetchPublishedContent.mockRejectedValue(notFound());
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Visszavonás figyelése' }));

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText('success:hidden')).toBeTruthy();
  });

  it('pauses the active budget and requests while the tab is hidden', async () => {
    mocks.fetchPublishedContent.mockRejectedValue(notFound());
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Publikálás figyelése' }));
    await act(() => vi.advanceTimersByTimeAsync(500));
    act(() => setVisibility('hidden'));

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.fetchPublishedContent).not.toHaveBeenCalled();
    expect(screen.getByText('paused:visible')).toBeTruthy();

    act(() => setVisibility('visible'));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(mocks.fetchPublishedContent).toHaveBeenCalledTimes(1);
  });

  it('times out without turning a successful publish into an error', async () => {
    mocks.fetchPublishedContent.mockRejectedValue(notFound());
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Publikálás figyelése' }));

    await act(() => vi.advanceTimersByTimeAsync(CATALOG_POLL_BUDGET_MS));
    expect(screen.getByText('timeout:visible')).toBeTruthy();
  });
});
