import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const CONTENT_ID_KEY = 'indaplay.poc.activeContentId';

type ActiveContentValue = {
  contentId: string;
  setContentId: (id: string) => void;
};

const ActiveContentContext = createContext<ActiveContentValue | null>(null);

function readStoredId(): string {
  try {
    return sessionStorage.getItem(CONTENT_ID_KEY) ?? '';
  } catch {
    return '';
  }
}

export function ActiveContentProvider({ children }: { children: ReactNode }) {
  const [contentId, setContentIdState] = useState(() => readStoredId());

  const setContentId = useCallback((id: string) => {
    const next = id.trim();
    setContentIdState(next);
    try {
      if (next) sessionStorage.setItem(CONTENT_ID_KEY, next);
      else sessionStorage.removeItem(CONTENT_ID_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ contentId, setContentId }), [contentId, setContentId]);

  return <ActiveContentContext.Provider value={value}>{children}</ActiveContentContext.Provider>;
}

export function useActiveContent(): ActiveContentValue {
  const ctx = useContext(ActiveContentContext);
  if (!ctx) throw new Error('useActiveContent requires ActiveContentProvider');
  return ctx;
}
