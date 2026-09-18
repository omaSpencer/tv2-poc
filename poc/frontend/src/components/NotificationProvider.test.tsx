import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotifications } from './notificationContext';
import {
  NotificationProvider,
  SUCCESS_TOAST_TIMEOUT_MS,
  TOAST_CLOSE_LABEL,
} from './NotificationProvider';

function Trigger({
  message,
  tone = 'success',
}: {
  message: string;
  tone?: 'success' | 'error';
}) {
  const { notify } = useNotifications();
  return (
    <>
      <input aria-label="Cím" />
      <button type="button" onClick={() => notify(message, tone)}>Küldés</button>
    </>
  );
}

function renderToast(message: string, tone: 'success' | 'error' = 'success') {
  return render(
    <NotificationProvider>
      <Trigger message={message} tone={tone} />
    </NotificationProvider>,
  );
}

describe('NotificationProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-dismisses a success toast after 5s and preserves the remaining time across hover pause', () => {
    renderToast('A piszkozat létrejött.');
    fireEvent.click(screen.getByRole('button', { name: 'Küldés' }));
    const toast = screen.getByText('A piszkozat létrejött.').closest('.toast');
    expect(toast).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    fireEvent.mouseEnter(toast!);
    act(() => {
      vi.advanceTimersByTime(SUCCESS_TOAST_TIMEOUT_MS);
    });
    expect(screen.getByText('A piszkozat létrejött.')).toBeTruthy();

    fireEvent.mouseLeave(toast!);
    act(() => {
      vi.advanceTimersByTime(SUCCESS_TOAST_TIMEOUT_MS - 2_001);
    });
    expect(screen.getByText('A piszkozat létrejött.')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('A piszkozat létrejött.')).toBeNull();
  });

  it('pauses the success countdown while the close button has keyboard focus and resumes the remainder', () => {
    renderToast('A piszkozat létrejött.');
    fireEvent.click(screen.getByRole('button', { name: 'Küldés' }));
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    const close = screen.getByRole('button', { name: TOAST_CLOSE_LABEL });
    close.focus();
    act(() => {
      vi.advanceTimersByTime(SUCCESS_TOAST_TIMEOUT_MS);
    });
    expect(screen.getByText('A piszkozat létrejött.')).toBeTruthy();

    close.blur();
    act(() => {
      vi.advanceTimersByTime(SUCCESS_TOAST_TIMEOUT_MS - 1_501);
    });
    expect(screen.getByText('A piszkozat létrejött.')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('A piszkozat létrejött.')).toBeNull();
  });

  it('keeps error toasts until they are dismissed by mouse or keyboard', () => {
    renderToast('A mentés nem sikerült.', 'error');
    fireEvent.click(screen.getByRole('button', { name: 'Küldés' }));
    expect(screen.getByRole('alert').textContent).toContain('A mentés nem sikerült.');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('alert')).toBeTruthy();

    const close = screen.getByRole('button', { name: TOAST_CLOSE_LABEL });
    close.focus();
    fireEvent.click(close);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not steal focus on appear, announces without duplicating the close control, and cleans timers on unmount', () => {
    const view = renderToast('A piszkozat létrejött.');
    const field = screen.getByLabelText('Cím');
    field.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Küldés' }));
    expect(document.activeElement).toBe(field);

    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('aria-atomic')).toBe('true');
    expect(live.contains(screen.getByRole('button', { name: TOAST_CLOSE_LABEL }))).toBe(false);

    view.unmount();
    act(() => {
      vi.advanceTimersByTime(SUCCESS_TOAST_TIMEOUT_MS);
    });
  });
});
