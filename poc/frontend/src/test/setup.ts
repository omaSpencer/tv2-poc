import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { setApiAccessToken, setAuthRecoveryHandler } from '../api/client';
import { resetManualAccessTokenForTests } from '../auth/manualToken';
import { server } from './server';

configure({ asyncUtilTimeout: 4_000 });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
  resetManualAccessTokenForTests();
  setApiAccessToken(null);
  setAuthRecoveryHandler(null);
  server.resetHandlers();
});

afterAll(() => server.close());
