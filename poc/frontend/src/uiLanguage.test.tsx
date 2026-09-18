import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import { AuthContext } from './auth/authContext';
import type { AuthContextValue } from './auth/authTypes';
import { AppNav } from './components/AppNav';
import { PermissionHints } from './components/PermissionHints';
import { publisherFixture } from './test/fixtures/api';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { DemoPage } from './pages/DemoPage';

vi.mock('./features/demo/persistence', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('./features/demo/persistence')>();
  return {
    ...original,
    fingerprintSubject: vi.fn(async () => 'a'.repeat(64)),
    loadPersistedRun: vi.fn(() => null),
    persistRun: vi.fn(),
  };
});

const ENGLISH_PRODUCT_COPY = [
  'Demo playground',
  'API playground',
  'Page not found',
  'Go home',
  'not configured',
  'not ready',
  'Scenario runner',
  'Permissionök',
];

const publisherAuth: AuthContextValue = {
  state: { kind: 'authenticated', me: publisherFixture },
  me: publisherFixture,
  isAuthenticated: true,
  manualTokenAllowed: false,
  login: vi.fn(),
  completeCallback: vi.fn(),
  logout: vi.fn(),
  retry: vi.fn(),
  setManualToken: vi.fn(),
};

function assertNoEnglishProductCopy(root: HTMLElement = document.body) {
  const text = root.textContent ?? '';
  for (const phrase of ENGLISH_PRODUCT_COPY) {
    expect(text).not.toContain(phrase);
  }
}

describe('Hungarian-only UI', () => {
  it('keeps html lang=hu and Hungarian copy on critical routes', () => {
    expect(indexHtml).toContain('<html lang="hu">');
    expect(indexHtml).not.toContain('playground');

    const home = render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Demófelület' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Operáció' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Demó' })).toBeTruthy();
    assertNoEnglishProductCopy();
    home.unmount();

    const missing = render(<MemoryRouter><NotFoundPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Az oldal nem található' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Főoldal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vissza' })).toBeTruthy();
    assertNoEnglishProductCopy();
    missing.unmount();

    const nav = render(
      <MemoryRouter>
        <AuthContext.Provider value={publisherAuth}>
          <AppNav />
          <PermissionHints me={publisherFixture} />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Operáció' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Demó' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Jogosultságok' })).toBeTruthy();
    expect(screen.getByRole('row', { name: /Megtekintő/ })).toBeTruthy();
    assertNoEnglishProductCopy();
    nav.unmount();

    render(
      <MemoryRouter>
        <AuthContext.Provider value={publisherAuth}>
          <DemoPage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Forgatókönyv-futtató és bizonyítéktér' })).toBeTruthy();
    assertNoEnglishProductCopy();
  });
});
