import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setApiAccessToken, setAuthRecoveryHandler } from '../api/client';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  setApiAccessToken(null);
  setAuthRecoveryHandler(null);
});

