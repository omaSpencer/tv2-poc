import { lazy, Suspense, type ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootErrorPage } from './RootErrorPage';

function renderError(element: ReactElement, reload: () => void, initial = '/contents') {
  const router = createMemoryRouter([
    {
      path: '*',
      element,
      errorElement: <RootErrorPage reload={reload} buildId="test-build" />,
    },
  ], { initialEntries: [initial] });
  return render(<RouterProvider router={router} />);
}

describe('RootErrorPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('shows a Hungarian recovery page without stack, query, token or raw exception text', async () => {
    const reload = vi.fn();
    function Boom(): ReactElement {
      throw new Error('secret-token authorization code=stolen stack at App.tsx:1 ?code=leak');
    }
    renderError(<Boom />, reload, '/auth/callback?code=stolen&token=abc');

    expect(screen.getByRole('heading', { name: 'Az oldal nem tölthető be' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Oldal újratöltése' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Vissza a kezdőlapra' }).getAttribute('href')).toBe('/');
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('stolen');
    expect(text).not.toContain('code=');
    expect(text).not.toContain('App.tsx');
    expect(text).not.toContain('token=abc');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once for a recognized lazy-chunk error and then shows the page', async () => {
    const reload = vi.fn();
    function ChunkBoom(): ReactElement {
      throw new TypeError('Failed to fetch dynamically imported module: /assets/Page-abc.js');
    }
    const first = renderError(<ChunkBoom />, reload, '/contents');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    first.unmount();
    reload.mockClear();
    renderError(<ChunkBoom />, reload, '/contents');
    expect(await screen.findByRole('heading', { name: 'Az oldal nem tölthető be' })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not auto-reload a generic Failed to fetch render error', async () => {
    const reload = vi.fn();
    function NetworkBoom(): ReactElement {
      throw new TypeError('Failed to fetch');
    }
    renderError(<NetworkBoom />, reload, '/contents');
    expect(await screen.findByRole('heading', { name: 'Az oldal nem tölthető be' })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('catches a rejected lazy import through Suspense on the data router', async () => {
    const reload = vi.fn();
    const Broken = lazy(() => Promise.reject(
      new TypeError('Failed to fetch dynamically imported module: /assets/Broken.js'),
    ));
    const router = createMemoryRouter([
      {
        path: '/',
        element: <Outlet />,
        errorElement: <RootErrorPage reload={reload} buildId="lazy-build" />,
        children: [{
          path: '/',
          element: (
            <Suspense fallback={<p>Oldal betöltése…</p>}>
              <Broken />
            </Suspense>
          ),
        }],
      },
    ]);
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
