import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import adapterSource from './useDirtyNavigationGuard.ts?raw';
import { DIRTY_LEAVE_MESSAGE, useDirtyNavigationGuard } from './useDirtyNavigationGuard';

function GuardedPage({ dirty, saveThenLeave = false }: { dirty: boolean; saveThenLeave?: boolean }) {
  const navigate = useNavigate();
  useDirtyNavigationGuard(dirty);
  return (
    <section>
      <h1>Szerkesztő</h1>
      <Link to="/other">Tovább</Link>
      <button type="button" onClick={() => navigate('/other')}>Mégse</button>
      {saveThenLeave ? (
        <button type="button" onClick={() => navigate('/other', { replace: true })}>Mentés után</button>
      ) : null}
    </section>
  );
}

function renderGuard(options: {
  dirty: boolean;
  initialEntries?: string[];
  initialIndex?: number;
  saveThenLeave?: boolean;
}) {
  const router = createMemoryRouter([
    { path: '/', element: <h1>Kezdőlap</h1> },
    { path: '/edit', element: <GuardedPage dirty={options.dirty} saveThenLeave={options.saveThenLeave} /> },
    { path: '/other', element: <h1>Másik oldal</h1> },
  ], {
    initialEntries: options.initialEntries ?? ['/edit'],
    initialIndex: options.initialIndex,
  });
  const view = render(<RouterProvider router={router} />);
  return { router, view };
}

function dispatchBeforeUnload(): BeforeUnloadEvent {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  Object.defineProperty(event, 'returnValue', { configurable: true, writable: true, value: undefined });
  window.dispatchEvent(event);
  return event;
}

describe('useDirtyNavigationGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not import the unstable prompt API', () => {
    expect(adapterSource).not.toContain('unstable_usePrompt');
    expect(adapterSource).toContain('useBlocker');
  });

  it('lets a clean in-app transition through without a confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { router, view } = renderGuard({ dirty: false });
    fireEvent.click(screen.getByRole('link', { name: 'Tovább' }));
    expect(await screen.findByRole('heading', { name: 'Másik oldal' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/other');
    expect(confirm).not.toHaveBeenCalled();
    view.unmount();
  });

  it('blocks an internal link, stays on cancel, and proceeds once on confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const { router, view } = renderGuard({ dirty: true });
    fireEvent.click(screen.getByRole('link', { name: 'Tovább' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(DIRTY_LEAVE_MESSAGE);
    expect(router.state.location.pathname).toBe('/edit');
    expect(screen.getByRole('heading', { name: 'Szerkesztő' })).toBeTruthy();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('link', { name: 'Tovább' }));
    expect(await screen.findByRole('heading', { name: 'Másik oldal' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/other');
    expect(confirm).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('uses the same single confirm for the page Mégse action', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const { router, view } = renderGuard({ dirty: true });
    fireEvent.click(screen.getByRole('button', { name: 'Mégse' }));
    expect(await screen.findByRole('heading', { name: 'Másik oldal' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/other');
    expect(confirm).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('blocks browser back while dirty and restores the page on cancel', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const { router, view } = renderGuard({ dirty: true, initialEntries: ['/', '/edit'], initialIndex: 1 });
    void router.navigate(-1);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(router.state.location.pathname).toBe('/edit');

    confirm.mockReturnValueOnce(true);
    void router.navigate(-1);
    expect(await screen.findByRole('heading', { name: 'Kezdőlap' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
    expect(confirm).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('does not prompt when a save redirect runs with a clean form', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { router, view } = renderGuard({ dirty: false, saveThenLeave: true });
    fireEvent.click(screen.getByRole('button', { name: 'Mentés után' }));
    expect(await screen.findByRole('heading', { name: 'Másik oldal' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/other');
    expect(confirm).not.toHaveBeenCalled();
    view.unmount();
  });

  it('attaches beforeunload only while dirty and asks for the native prompt', () => {
    const dirty = renderGuard({ dirty: true });
    const blocked = dispatchBeforeUnload();
    expect(blocked.defaultPrevented).toBe(true);
    expect(blocked.returnValue).toBe('');
    dirty.view.unmount();

    const clean = renderGuard({ dirty: false });
    const allowed = dispatchBeforeUnload();
    expect(allowed.defaultPrevented).toBe(false);
    clean.view.unmount();
  });
});
