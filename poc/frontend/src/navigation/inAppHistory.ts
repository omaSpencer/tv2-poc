type HistoryStateWithIndex = { idx?: unknown };

function historyIndex(historyState: unknown): number | null {
  if (!historyState || typeof historyState !== 'object') return null;
  const idx = (historyState as HistoryStateWithIndex).idx;
  return typeof idx === 'number' ? idx : null;
}

/**
 * A SPA history előző bejegyzése csak akkor biztonságos visszalépés, ha a
 * React Router saját `idx` értéke 0-nál nagyobb. Közvetlen deep linknél az
 * `idx` 0, a böngésző előző, idegen originű bejegyzése pedig nem használható.
 * Memory-router tesztekben az `idx` hiányozhat; ott a nem `default` location
 * key jelzi, hogy már volt alkalmazáson belüli belépés.
 */
export function hasSafeInAppHistoryPredecessor(
  historyState: unknown = typeof window === 'undefined' ? null : window.history.state,
  locationKey?: string,
): boolean {
  const idx = historyIndex(historyState);
  if (idx !== null) return idx > 0;
  return Boolean(locationKey) && locationKey !== 'default';
}
