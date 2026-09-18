import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { NotFoundPage } from './NotFoundPage';

function renderNotFound(initialEntries: string[], initialIndex?: number) {
  const router = createMemoryRouter([
    { path: '/', element: <h1>Kezdőlap</h1> },
    { path: '/contents', element: <><h1>Tartalmak</h1><Link to="/nincs-ilyen">Törött link</Link></> },
    { path: '*', element: <NotFoundPage /> },
  ], { initialEntries, initialIndex });
  render(<RouterProvider router={router} />);
  return router;
}

describe('NotFoundPage', () => {
  it('renders a Hungarian heading, home link and back button without echoing the path', () => {
    renderNotFound(['/titkos-utvonal']);
    expect(screen.getByRole('heading', { name: 'Az oldal nem található' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Főoldal' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('button', { name: 'Vissza' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('titkos-utvonal');
  });

  it('falls back to the home page on a direct deep link back action', async () => {
    const router = renderNotFound(['/nincs-ilyen']);
    fireEvent.click(screen.getByRole('button', { name: 'Vissza' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('returns to the previous in-app page when history exists', async () => {
    const router = renderNotFound(['/contents', '/nincs-ilyen'], 1);
    fireEvent.click(screen.getByRole('button', { name: 'Vissza' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/contents'));
  });
});
