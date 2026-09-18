import { useEffect } from 'react';

type VisibleRefetch = (options?: { cancelRefetch?: boolean }) => unknown;

/**
 * Refetch when the tab becomes visible again, without starting a second
 * request over an in-flight fetch (`cancelRefetch: false` joins it).
 */
export function useVisibleRefetch(refetch: VisibleRefetch, isFetching: boolean, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || isFetching) return;
      void refetch({ cancelRefetch: false });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled, isFetching, refetch]);
}
