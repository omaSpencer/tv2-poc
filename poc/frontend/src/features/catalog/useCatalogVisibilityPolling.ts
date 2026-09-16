import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { fetchPublishedContent } from '../../api/catalog';
import { isApiProblemError } from '../../api/types';

export type CatalogVisibilityTarget = 'visible' | 'hidden';
export type CatalogPollingPhase = 'idle' | 'waiting' | 'paused' | 'success' | 'timeout';

export type CatalogPollingState = {
  phase: CatalogPollingPhase;
  target: CatalogVisibilityTarget | null;
};

export type CatalogPollingResult = {
  phase: 'success' | 'timeout';
  target: CatalogVisibilityTarget;
};

type PollRequest = {
  runId: number;
  contentId: string;
  target: CatalogVisibilityTarget;
};

const POLL_DELAYS_MS = [1000, 2000, 3000] as const;
export const CATALOG_POLL_BUDGET_MS = 30_000;

export function useCatalogVisibilityPolling(onResult?: (result: CatalogPollingResult) => void) {
  const runCounter = useRef(0);
  const reportResult = useEffectEvent((result: CatalogPollingResult) => onResult?.(result));
  const [request, setRequest] = useState<PollRequest | null>(null);
  const [state, setState] = useState<CatalogPollingState>({ phase: 'idle', target: null });

  useEffect(() => {
    if (!request) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timerStartedAt = 0;
    let activeElapsedMs = 0;
    let delayIndex = 0;
    let remainingDelayMs: number = POLL_DELAYS_MS[0];

    const finish = (phase: 'success' | 'timeout') => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = null;
      setState({ phase, target: request.target });
      reportResult({ phase, target: request.target });
    };

    const schedule = () => {
      if (cancelled) return;
      if (activeElapsedMs >= CATALOG_POLL_BUDGET_MS) {
        finish('timeout');
        return;
      }
      if (document.visibilityState === 'hidden') {
        setState({ phase: 'paused', target: request.target });
        return;
      }

      setState({ phase: 'waiting', target: request.target });
      timerStartedAt = Date.now();
      timer = setTimeout(() => {
        timer = null;
        activeElapsedMs += remainingDelayMs;
        remainingDelayMs = 0;
        void probe();
      }, remainingDelayMs);
    };

    const probe = async () => {
      let isPublic = false;
      try {
        await fetchPublishedContent(request.contentId);
        isPublic = true;
      } catch (error) {
        if (!(isApiProblemError(error) && error.problem.status === 404)) {
          isPublic = request.target === 'hidden';
        }
      }

      if (cancelled) return;
      if ((request.target === 'visible' && isPublic) || (request.target === 'hidden' && !isPublic)) {
        finish('success');
        return;
      }
      if (activeElapsedMs >= CATALOG_POLL_BUDGET_MS) {
        finish('timeout');
        return;
      }

      delayIndex = Math.min(delayIndex + 1, POLL_DELAYS_MS.length - 1);
      remainingDelayMs = Math.min(
        POLL_DELAYS_MS[delayIndex],
        CATALOG_POLL_BUDGET_MS - activeElapsedMs,
      );
      schedule();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (timer) {
          const elapsed = Math.min(Date.now() - timerStartedAt, remainingDelayMs);
          activeElapsedMs += elapsed;
          remainingDelayMs -= elapsed;
          clearTimeout(timer);
          timer = null;
        }
        setState({ phase: 'paused', target: request.target });
      } else if (!timer) {
        schedule();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [request]);

  return {
    ...state,
    start(contentId: string, target: CatalogVisibilityTarget) {
      runCounter.current += 1;
      setRequest({ runId: runCounter.current, contentId, target });
      setState({ phase: document.visibilityState === 'hidden' ? 'paused' : 'waiting', target });
    },
    reset() {
      setRequest(null);
      setState({ phase: 'idle', target: null });
    },
  };
}
