import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setApiAccessToken, setAuthRecoveryHandler } from '../api/client';
import { server } from './server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  setApiAccessToken(null);
  setAuthRecoveryHandler(null);
  server.resetHandlers();
});

afterAll(() => server.close());
