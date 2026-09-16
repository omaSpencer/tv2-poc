import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { AuthSessionContext } from './sessionContext';

const TOKEN_KEY = 'indaplay.poc.accessToken';

function readStoredToken(): string | null {
  try {
    const value = sessionStorage.getItem(TOKEN_KEY);
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessTokenState] = useState<string | null>(() => readStoredToken());

  const setAccessToken = useCallback((token: string | null) => {
    const next = token && token.trim().length > 0 ? token.trim() : null;
    setAccessTokenState(next);
    try {
      if (next) sessionStorage.setItem(TOKEN_KEY, next);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const clearSession = useCallback(() => setAccessToken(null), [setAccessToken]);

  const value = useMemo(
    () => ({ accessToken, setAccessToken, clearSession }),
    [accessToken, setAccessToken, clearSession],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}
