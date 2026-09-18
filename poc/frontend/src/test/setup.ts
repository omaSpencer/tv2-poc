import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setApiAccessToken, setAuthRecoveryHandler } from '../api/client';
import { server } from './server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
  setApiAccessToken(null);
  setAuthRecoveryHandler(null);
  server.resetHandlers();
});

afterAll(() => server.close());
